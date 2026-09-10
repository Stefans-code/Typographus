/* =========================================================================
   Typographus — application controller.
   ========================================================================= */

import BRAND_ICON from "../icon.png";
import { supabase } from "./supabase";
import {
  ACCENTS,
  Store,
  applyPrefs,
  defaultMeta,
  defaultSettings,
  deleteFromLibrary,
  getFromLibrary,
  listLibrary,
  loadPrefs,
  newId,
  PAGE_PRESETS,
  savePrefs,
  STATUS_LABELS,
  type AccentKey,
  type AppPrefs,
  type DocState,
  type EditorialMeta,
  type EditorialStatus,
  type RailTool,
  type Reference,
  type Screen,
  type Settings,
  type ViewMode,
} from "./state";
import { SAMPLE_FRONT, SAMPLE_MD, SAMPLE_TITLE } from "./sample";
import { TEMPLATES, type Template, getCommunityTemplates, saveCommunityTemplate, deleteCommunityTemplate, type CommunityTemplate } from "./templates";
import { COMPANY, COPYRIGHT, EULA_SECTIONS } from "./legal";
import { compile, toPlainText } from "./typography";
import { checkOriginality, detectAI, rewrite, type RewriteMode } from "./aitools";
import { paraphrase } from "./paraphraser";
import { analyze, estimateExtent, type Analysis } from "./metrics";
import { lint } from "./linter";
import { importFile } from "./importers";
import { buildStandaloneHtml, buildToc, downloadBlob, exportEpub, printDocument } from "./exporters";
import { toLatex, toTypst, slugForExport } from "./latex";
import JSZip from "jszip";
import { FONT_OPTIONS, FONT_STACKS, pageDims, renderGalley, renderPaged } from "./paginate";
import {
  debounce,
  escapeHtml,
  fieldNumber,
  fieldSelect,
  fieldText,
  gaugeSvg,
  icon,
  segmented,
  sliderRow,
  snackbar,
  switchRow,
} from "./ui";

const MM_TO_PX = 96 / 25.4;

interface LicenseStatus {
  valid: boolean;
  message: string;
  hwid: string;
  plan?: string;
  exp?: string;
}
interface DesktopBridge {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  license?: {
    status(): Promise<LicenseStatus>;
    hwid(): Promise<string>;
    activate(token: string): Promise<LicenseStatus>;
    deactivate(): Promise<LicenseStatus>;
  };
  typst?: {
    status(): Promise<{ installed: boolean; downloadable?: boolean; path?: string; system?: boolean }>;
    download(): Promise<{ ok: boolean; path?: string; error?: string }>;
    compile(source: string): Promise<{ ok: boolean; pdfBase64?: string; error?: string; notInstalled?: boolean }>;
  };
  wordpress?: {
    hasCredentials(): Promise<{ has: boolean }>;
    saveCredentials(site: string, user: string, pw: string): Promise<{ ok: boolean }>;
    removeCredentials(): Promise<{ ok: boolean }>;
    checkSite(): Promise<{ ok: boolean; siteName?: string; error?: string }>;
    publish(title: string, html: string, status: string): Promise<{ ok: boolean; link?: string; error?: string }>;
  };
}
const desktop: DesktopBridge | undefined = (window as unknown as { typographus?: DesktopBridge }).typographus;
const IS_ELECTRON = !!desktop;

const RAIL: { id: RailTool; icon: string; label: string }[] = [
  { id: "document", icon: "article", label: "Documento" },
  { id: "layout", icon: "grid_on", label: "Layout" },
  { id: "typography", icon: "text_fields", label: "Tipografia" },
  { id: "editoria", icon: "auto_stories", label: "Editoria" },
  { id: "review", icon: "fact_check", label: "Revisione" },
  { id: "ai", icon: "smart_toy", label: "AI" },
  { id: "export", icon: "ios_share", label: "Esporta" },
];

class App {
  store: Store;
  prefs: AppPrefs;
  screen: Screen = "home";
  homeTab: string = "registi";
  lastSelection = { start: 0, end: 0 };
  originalBlockText = "";
  facing = false;
  undoStack: string[] = [];
  redoStack: string[] = [];
  settingsCat = "aspetto";
  tool: RailTool = "document";
  view: ViewMode = "galley";
  zoom = 0.62;
  sourceOpen = true;
  inspectorOpen = true;
  sourceW = 360;
  inspectorW = 360;
  lastCompiled = { html: "", footnoteCount: 0, imageCount: 0, citationCount: 0 };
  licenseStatus: LicenseStatus | null = null;
  supabaseUser: any = null;
  supabaseProfile: any = null;
  onlineTemplates: CommunityTemplate[] = [];

  // refs
  root: HTMLElement;
  screenRoot!: HTMLElement;
  stage!: HTMLElement;
  previewScroll!: HTMLElement;
  inspectorBody!: HTMLElement;
  inspectorTitle!: HTMLElement;
  inspectorIcon!: HTMLElement;
  pageCounter!: HTMLElement;
  fileInput!: HTMLInputElement;

  globalKeys = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        this.store.persistForce();
        snackbar("Documento salvato con successo!");
        const label = document.getElementById("saveLabel");
        const t = new Date().toLocaleTimeString("it", { hour: "2-digit", minute: "2-digit" });
        if (label) label.textContent = `Salvato ${t}`;
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (this.view !== "paged") {
          this.view = "paged";
          bindSegmentedActive("viewSeg", "paged");
          this.renderPreview().then(() => {
            setTimeout(() => printDocument(), 400);
          });
        } else {
          printDocument();
        }
      } else if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        this.undo();
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        this.redo();
      }
    }
  };

  schedulePreview = debounce(() => this.renderPreview(), 160);
  schedulePaged = debounce(() => this.renderPreview(), 420);

  constructor(root: HTMLElement) {
    this.root = root;
    this.prefs = loadPrefs();
    applyPrefs(this.prefs);
    const seed: DocState = {
      id: "sample-typographus",
      title: SAMPLE_TITLE,
      source: SAMPLE_MD,
      front: { ...SAMPLE_FRONT },
      settings: { ...defaultSettings },
      status: "review",
      meta: { ...defaultMeta },
      references: [],
    };
    this.store = new Store(Store.initial(seed));
    this.boot();
  }

  /* Licensing gate (Electron only) — verify offline before showing the app. */
  async loadOnlineTemplates() {
    try {
      const { data, error } = await supabase
        .from("community_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && data) {
        this.onlineTemplates = data;
      }
    } catch (e) {
      console.error("Errore caricamento modelli online:", e);
    }
  }

  async boot() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        this.supabaseUser = session.user;
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();
        this.supabaseProfile = profile;
      }
    } catch (e) {
      console.error("Errore autenticazione Supabase:", e);
    }

    await this.loadOnlineTemplates();

    if (desktop?.license) {
      try {
        const st = await desktop.license.status();
        this.licenseStatus = st;
        if (!st.valid) {
          this.renderLicenseGate(st);
          return;
        }
      } catch {
        /* if the check itself fails, fail open to avoid locking the user out */
      }
    }
    this.mount();
  }

  renderLicenseGate(st: LicenseStatus) {
    this.root.setAttribute("data-screen", "license");
    document.body.setAttribute("data-screen", "license");
    this.root.innerHTML = `
      <header class="titlebar">
        <div class="tb-brand">
          <span class="logo" style="width:26px;height:26px;border-radius:7px;display:grid;place-items:center;background:#07070a">
            <img src="${BRAND_ICON}" alt="" style="width:20px;height:20px">
          </span>
          <span class="name">Typographus</span><span class="ver">v0.1</span>
        </div>
        <div class="tb-center"></div>
        <div class="tb-right">
          ${
            IS_ELECTRON
              ? `<div class="win-ctrls"><button data-win="min">${icon("remove")}</button><button data-win="max">${icon("crop_square")}</button><button data-win="close">${icon("close")}</button></div>`
              : ""
          }
        </div>
      </header>
      <main class="license-gate">
        <div class="lg-card">
          <div class="vendor-logo"><span class="msi">lock</span></div>
          <h1>Attiva Typographus</h1>
          <p class="lg-sub">Questo prodotto Nexflamma richiede una licenza valida per essere utilizzato. L'attivazione è <b>offline</b> e legata a questo dispositivo.</p>
          <div class="lg-hwid">
            <div><span>ID dispositivo (HWID)</span><b id="lgHwid">${escapeHtml(st.hwid || "—")}</b></div>
            <button class="btn btn--text btn--sm" id="lgCopyHwid">${icon("content_copy", "sm")}Copia</button>
          </div>
          <label class="lg-label">Chiave di licenza</label>
          <textarea id="lgKey" rows="4" spellcheck="false" placeholder="Incolla qui la chiave di licenza ricevuta da Nexflamma…"></textarea>
          <div class="lg-msg" id="lgMsg">${st.message ? escapeHtml(st.message) : ""}</div>
          <button class="btn btn--filled" id="lgActivate" style="width:100%">${icon("key")}Attiva licenza</button>
          <p class="lg-foot">Per ottenere una chiave comunica il tuo HWID a <b>${COMPANY.email}</b>. ${COPYRIGHT}.</p>
        </div>
      </main>`;

    if (desktop) {
      this.root.querySelectorAll<HTMLElement>(".win-ctrls button").forEach((b) => {
        b.onclick = () => {
          const a = b.dataset.win;
          if (a === "min") desktop.minimize();
          else if (a === "max") desktop.toggleMaximize();
          else desktop.close();
        };
      });
    }
    byId("lgCopyHwid").onclick = async () => {
      try {
        await navigator.clipboard.writeText(st.hwid);
        snackbar("HWID copiato.");
      } catch {
        /* ignore */
      }
    };
    byId("lgActivate").onclick = async () => {
      const token = byId<HTMLTextAreaElement>("lgKey").value.trim();
      const msg = byId("lgMsg");
      if (!token) {
        msg.textContent = "Inserisci una chiave di licenza.";
        msg.className = "lg-msg err";
        return;
      }
      const res = await desktop!.license!.activate(token);
      if (res.valid) {
        snackbar("Licenza attivata. Benvenuto in Typographus.");
        this.mount();
      } else {
        msg.textContent = res.message;
        msg.className = "lg-msg err";
      }
    };
  }

  get s(): Settings {
    return this.store.state.settings;
  }

  /* --------------------------- shell --------------------------- */
  mount() {
    this.root.innerHTML = `
      ${this.titlebar()}
      <main id="screenRoot" class="screen-root"></main>
      <input type="file" id="fileInput" accept=".md,.markdown,.txt,.docx,.pdf" style="display:none">
    `;
    this.screenRoot = byId("screenRoot");
    this.fileInput = byId("fileInput");
    this.bindTitlebar();
    this.bindFileInput();
    
    document.addEventListener("blur", (e) => {
      const target = e.target as HTMLElement;
      if (target && target.hasAttribute("data-field")) {
        const field = target.getAttribute("data-field") as keyof FrontMatter;
        let val = target.innerText.trim();
        const defaultPlaceholders = ["Occhiello", "Titolo principale", "Sommario dell'articolo", "Nome dell'autore"];
        if (defaultPlaceholders.includes(val)) {
          val = "";
        }
        this.store.setFront(field, val);
        if (field === "headline" && this.store.state.title === "Senza titolo") {
          this.store.set({ title: val || "Senza titolo" });
          const titleInput = byId<HTMLInputElement>("docTitle");
          if (titleInput) titleInput.value = val || "Senza titolo";
        }
        const inputId = `fm${field.charAt(0).toUpperCase() + field.slice(1)}`;
        const sidebarInput = document.getElementById(inputId) as HTMLInputElement | null;
        if (sidebarInput) sidebarInput.value = val;
        this.renderPreview();
      }
    }, true);

    document.addEventListener("focusin", (e) => {
      const target = e.target as HTMLElement;
      if (target && target.getAttribute("data-body-block") === "true") {
        this.originalBlockText = getBlockMd(target.tagName, target.innerHTML);
      }
    });

    document.addEventListener("focusout", (e) => {
      const target = e.target as HTMLElement;
      if (target && target.getAttribute("data-body-block") === "true") {
        const oldMd = this.originalBlockText.trim();
        const newMd = getBlockMd(target.tagName, target.innerHTML).trim();
        
        if (oldMd !== newMd && this.store.state.source.includes(oldMd)) {
          this.pushState(this.store.state.source);
          const updatedSource = this.store.state.source.replace(oldMd, newMd);
          this.store.set({ source: updatedSource });
          const ed = byId<HTMLTextAreaElement>("editor");
          if (ed) ed.value = updatedSource;
          this.renderPreview();
        }
      }
    });

    document.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement;
      if (target && (target.hasAttribute("data-field") || target.getAttribute("data-body-block") === "true") && e.key === "Enter") {
        e.preventDefault();
        target.blur();
      }
    });

    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        let node: Node | null = range.startContainer;
        let isBodyBlock = false;
        while (node) {
          if (node instanceof HTMLElement && node.getAttribute("data-body-block") === "true") {
            isBodyBlock = true;
            break;
          }
          node = node.parentNode;
        }
        
        if (isBodyBlock) {
          const rects = range.getClientRects();
          if (rects.length > 0) {
            this.showFloatingFormatBar(rects[0], range);
            return;
          }
        }
      }
      
      const activeEl = document.activeElement;
      if (activeEl && activeEl.closest("#floatingFormatBar")) {
        return;
      }
      this.hideFloatingFormatBar();
    });
    
    document.removeEventListener("keydown", this.globalKeys);
    document.addEventListener("keydown", this.globalKeys);

    this.goScreen(this.screen);
    this.pushState(this.store.state.source);
    // visible autosave confirmation (the store persists on every change)
    this.store.subscribe(() => this.flashSaved());
  }

  private savedTimer?: number;
  flashSaved() {
    const dot = document.getElementById("saveDot");
    const label = document.getElementById("saveLabel");
    if (!dot || !label) return;
    dot.classList.add("saving");
    label.textContent = "Salvataggio…";
    clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => {
      dot.classList.remove("saving");
      const t = new Date().toLocaleTimeString("it", { hour: "2-digit", minute: "2-digit" });
      label.textContent = `Salvato ${t}`;
    }, 250);
  }

  goScreen(s: Screen) {
    this.screen = s;
    this.root.setAttribute("data-screen", s);
    document.body.setAttribute("data-screen", s);
    this.updateTitlebar();
    if (s === "home") {
      this.screenRoot.innerHTML = this.homeScreen();
      this.bindHome();
    } else if (s === "settings") {
      this.screenRoot.innerHTML = this.settingsScreen();
      this.bindSettings();
    } else {
      this.mountEditor();
    }
  }

  mountEditor() {
    this.screenRoot.innerHTML = `
      <div class="workspace" id="workspace">
        ${this.rail()}
        <section class="pane source-pane" id="sourcePane">${this.sourcePane()}
          <div class="col-resizer" data-resize="source" style="right:-4px" data-tip="Trascina per ridimensionare"></div>
        </section>
        <section class="pane preview-pane">
          ${this.previewHead()}
          <div class="preview-scroll" id="previewScroll"><div class="preview-stage" id="stage"></div></div>
        </section>
        <aside class="inspector" id="inspector">
          <div class="col-resizer" data-resize="inspector" style="left:-4px"></div>
          <div class="inspector-head">${icon("tune")}<h2 id="inspTitle">Documento</h2></div>
          <div class="inspector-body" id="inspBody"></div>
        </aside>
      </div>`;

    this.stage = byId("stage");
    this.previewScroll = byId("previewScroll");
    this.inspectorBody = byId("inspBody");
    this.inspectorTitle = byId("inspTitle");
    this.inspectorIcon = this.screenRoot.querySelector(".inspector-head .msi")!;
    this.pageCounter = byId("pageCounter");

    this.bindRail();
    this.bindSource();
    this.bindPreviewHead();
    this.bindDnd();
    this.bindResizers();

    this.zoom = this.fitZoomValue();
    this.renderInspector();
    this.renderPreview();
  }

  bindResizers() {
    const ws = byId("workspace");
    this.screenRoot.querySelectorAll<HTMLElement>(".col-resizer").forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const which = handle.dataset.resize as "source" | "inspector";
        const startX = e.clientX;
        const startW = which === "source" ? this.sourceW : this.inspectorW;
        handle.classList.add("dragging");
        ws.classList.add("resizing"); // disable grid transition while dragging
        document.body.classList.add("resizing-active");
        document.body.style.cursor = "col-resize";
        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          const w = Math.max(220, Math.min(620, which === "source" ? startW + dx : startW - dx));
          if (which === "source") {
            this.sourceW = w;
            ws.style.setProperty("--source-w", `${w}px`);
          } else {
            this.inspectorW = w;
            ws.style.setProperty("--inspector-w", `${w}px`);
          }
        };
        const onUp = () => {
          handle.classList.remove("dragging");
          ws.classList.remove("resizing");
          document.body.classList.remove("resizing-active");
          document.body.style.cursor = "";
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.applyZoom();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
    // disable the grid width transition while dragging feels instant
    ws.style.setProperty("--source-w", `${this.sourceW}px`);
    ws.style.setProperty("--inspector-w", `${this.inspectorW}px`);
  }

  titlebar(): string {
    return `<header class="titlebar">
      <div class="tb-brand">
        <button class="brand-btn" id="brandHome" data-tip="Home">
          <span class="logo"><img src="${BRAND_ICON}" alt="Typographus"></span>
          <span class="name">Typographus</span>
          <span class="ver">v0.1</span>
        </button>
        <div class="tb-menu">
          <button class="menu-btn" id="navHome">Home</button>
          <button class="menu-btn" id="importBtn">Importa</button>
          <button class="menu-btn editor-only" id="exportBtn">Esporta</button>
        </div>
      </div>
      <div class="tb-center">
        <span class="status-chip editor-only" id="statusChip"></span>
        <div class="doc-title editor-only" id="docTitleWrap">
          <span class="dot" id="saveDot" data-tip="Stato salvataggio"></span>
          <span class="save-label" id="saveLabel">Salvato</span>
          <input id="docTitle" type="text" value="${escapeHtml(this.store.state.title)}" spellcheck="false">
          ${!this.prefs.autosave ? `<button class="btn btn--filled btn--sm" id="manualSaveBtn" style="margin-left:10px;padding:0 8px;height:24px;font-size:11px;border-radius:4px">${icon("save", "sm")}Salva</button>` : ""}
        </div>
        <div class="screen-label off-editor" id="screenLabel"></div>
      </div>
      <div class="tb-right">
        <button class="icon-btn editor-only" id="toggleInspector" data-tip="Mostra/nascondi barra laterale">${icon(this.inspectorOpen ? "right_panel_close" : "right_panel_open")}</button>
        <button class="icon-btn" id="settingsBtn" data-tip="Impostazioni">${icon("settings")}</button>
        <button class="icon-btn" id="themeBtn" data-tip="Tema chiaro/scuro">${icon("dark_mode")}</button>
        ${
          IS_ELECTRON
            ? `<div class="win-ctrls" id="winCtrls">
                <button data-win="min" data-tip="Riduci">${icon("remove")}</button>
                <button data-win="max" data-tip="Ingrandisci">${icon("crop_square")}</button>
                <button data-win="close" data-tip="Chiudi">${icon("close")}</button>
              </div>`
            : ""
        }
      </div>
    </header>`;
  }

  updateTitlebar() {
    const label = document.getElementById("screenLabel");
    if (label) label.textContent = this.screen === "settings" ? "Impostazioni" : "Home";
    const ti = document.getElementById("docTitle") as HTMLInputElement | null;
    if (ti) ti.value = this.store.state.title;
    const themeIcon = document.querySelector("#themeBtn .msi");
    if (themeIcon) themeIcon.textContent = this.prefs.theme === "dark" ? "light_mode" : "dark_mode";
    
    const rightPanelBtn = document.querySelector("#toggleInspector .msi");
    if (rightPanelBtn) {
      rightPanelBtn.textContent = this.inspectorOpen ? "right_panel_close" : "right_panel_open";
    }
    this.updateStatusChip();
  }

  updateStatusChip() {
    const chip = document.getElementById("statusChip");
    if (!chip) return;
    const st = this.store.state.status;
    chip.textContent = STATUS_LABELS[st];
    chip.setAttribute("data-status", st);
  }

  rail(): string {
    return `<nav class="rail">
      <button class="rail-fab" id="railImport" data-tip="Importa documento">${icon("upload_file")}</button>
      ${RAIL.map(
        (r) => `<button class="rail-item ${r.id === this.tool ? "is-active" : ""}" data-tool="${r.id}">
          <span class="ind">${icon(r.icon)}</span><span>${r.label}</span></button>`
      ).join("")}
    </nav>`;
  }

  sourcePane(): string {
    return `
      <div class="pane-head">
        <span class="pane-title">${icon("edit_document", "sm")} Sorgente</span>
        <span class="spacer"></span>
        <button class="icon-btn" id="mdHelpBtn" data-tip="Guida alla scrittura">${icon("help_outline", "sm")}</button>
      </div>
      <div class="md-toolbar" id="mdToolbar">
        <button class="icon-btn" data-md="format_bold" data-tip="Grassetto (Ctrl+B)">${icon("format_bold", "sm")}</button>
        <button class="icon-btn" data-md="format_italic" data-tip="Corsivo (Ctrl+I)">${icon("format_italic", "sm")}</button>
        <span class="sep"></span>
        <button class="icon-btn" data-md="title" data-tip="Titolo di sezione">${icon("title", "sm")}</button>
        <button class="icon-btn" data-md="format_quote" data-tip="Citazione">${icon("format_quote", "sm")}</button>
        <button class="icon-btn" data-md="format_size" data-tip="Pull quote">${icon("format_size", "sm")}</button>
        <span class="sep"></span>
        
        <!-- Dropdown Colore -->
        <div class="toolbar-dropdown" id="tbColorDropdown">
          <button class="icon-btn" id="tbColorTrigger" data-tip="Colora testo">${icon("palette", "sm")}</button>
          <div class="dropdown-menu color-grid-menu" id="tbColorMenu" style="display:none;">
            ${["#18181a", "#000000", "#555555", "#991b1b", "#ea580c", "#d97706", "#14532d", "#0f766e", "#1e3a8a", "#4f46e5", "#7c3aed", "#c026d3", "#db2777", "#854d0e"]
              .map((c) => `<button class="color-menu-sw" data-col="${c}" style="background:${c}"></button>`)
              .join("")}
          </div>
        </div>

        <!-- Dropdown Font -->
        <div class="toolbar-dropdown" id="tbFontDropdown">
          <button class="icon-btn" id="tbFontTrigger" data-tip="Font in linea">${icon("font_download", "sm")}</button>
          <div class="dropdown-menu font-list-menu" id="tbFontMenu" style="display:none;">
            ${FONT_OPTIONS.map(([val, label]) => `<button class="font-menu-item" data-font="${val}">${label}</button>`).join("")}
          </div>
        </div>

        <span class="sep"></span>
        <button class="icon-btn" data-md="image" data-tip="Carica immagine">${icon("image", "sm")}</button>
        <button class="icon-btn" data-md="superscript" data-tip="Nota a piè pagina">${icon("superscript", "sm")}</button>
        <button class="icon-btn" data-md="link" data-tip="Link internet (Ctrl+K)">${icon("link", "sm")}</button>
        <button class="icon-btn" data-md="format_list_bulleted" data-tip="Elenco">${icon("format_list_bulleted", "sm")}</button>
      </div>
      
      <div class="find-replace-panel" id="findReplacePanel" style="display:none; padding: 6px 12px; background: var(--md-surface-container-high); border-bottom: 1px solid var(--hairline); align-items: center; gap: 8px;">
        <div style="display:flex; gap:6px; align-items:center; width:100%;">
          <input type="text" id="findInput" placeholder="Trova…" style="flex:1; background:var(--md-surface-container-highest); color:var(--md-on-surface); border:1px solid var(--hairline); border-radius:4px; padding:4px 8px; font-size:12px;">
          <input type="text" id="replaceInput" placeholder="Sostituisci…" style="flex:1; background:var(--md-surface-container-highest); color:var(--md-on-surface); border:1px solid var(--hairline); border-radius:4px; padding:4px 8px; font-size:12px;">
          <button class="btn btn--tonal btn--sm" id="btnReplace" style="height:26px; padding:0 8px; font-size:11px;">Sostituisci</button>
          <button class="btn btn--tonal btn--sm" id="btnReplaceAll" style="height:26px; padding:0 8px; font-size:11px;">Tutti</button>
          <button class="icon-btn" id="btnCloseFind" style="width:26px; height:26px;">${icon("close", "xs")}</button>
        </div>
      </div>

      <textarea class="editor" id="editor" spellcheck="false" placeholder="Scrivi o incolla il tuo testo in Markdown…" style="flex:1; min-height:0;">${escapeHtml(
        this.store.state.source
      )}</textarea>
      
      <div class="editor-status-bar" id="editorStatus">
        <span class="status-item" id="statusCount" style="margin-right:12px;">0 parole</span>
        <span class="status-item" id="statusChars" style="margin-right:12px;">0 caratteri</span>
        <span class="status-item" id="statusSel" style="display:none; color:var(--accent); font-weight:600;"></span>
        <span class="spacer" style="flex:1;"></span>
        <span class="status-item" style="opacity:0.8; font-size:9.5px; text-transform:uppercase; letter-spacing:0.4px;">Ctrl+F Trova · Ctrl+S Salva · Ctrl+P Stampa</span>
      </div>`;
  }

  previewHead(): string {
    return `<div class="preview-head">
      ${segmented("viewSeg", [["galley", "Bozza", "notes"], ["paged", "Impaginato", "menu_book"]], this.view)}
      <span class="page-counter" id="pageCounter">—</span>
      <div class="spacer"></div>
      <button class="icon-btn" id="zoomOut" data-tip="Riduci">${icon("zoom_out")}</button>
      <span class="zoom-val" id="zoomVal">${Math.round(this.zoom * 100)}%</span>
      <button class="icon-btn" id="zoomIn" data-tip="Ingrandisci">${icon("zoom_in")}</button>
      <button class="icon-btn" id="zoomFit" data-tip="Adatta">${icon("fit_screen")}</button>
      <div class="vsep"></div>
      <button class="icon-btn ${this.facing ? "is-active" : ""}" id="facingQuick" data-tip="Pagine affiancate (Spread)" style="display:${this.view === 'paged' ? 'inline-flex' : 'none'};">${icon("chrome_reader_mode")}</button>
      <button class="icon-btn ${this.s.showColumns || this.s.showMargins ? "is-active" : ""}" id="gridQuick" data-tip="Mostra griglia e margini">${icon("grid_4x4")}</button>
      <button class="btn btn--filled btn--sm" id="saveQuick" style="height:28px;padding:0 10px;gap:4px;font-size:11.5px" data-tip="Salva modifiche (floppy)">${icon("save", "xs")} Salva</button>
    </div>`;
  }

  /* --------------------------- bindings --------------------------- */
  bindTitlebar() {
    byId("brandHome").onclick = () => this.goScreen("home");
    byId("navHome").onclick = () => this.goScreen("home");
    byId("settingsBtn").onclick = () => this.goScreen("settings");
    byId<HTMLInputElement>("docTitle").addEventListener("input", (e) => {
      this.store.set({ title: (e.target as HTMLInputElement).value });
    });
    byId("toggleInspector").onclick = () => {
      if (this.screen !== "editor") return;
      this.inspectorOpen = !this.inspectorOpen;
      const ws = byId("workspace");
      ws.classList.toggle("inspector-collapsed", !this.inspectorOpen);
      ws.style.setProperty("--inspector-w", this.inspectorOpen ? `${this.inspectorW}px` : "0px");
      
      const rightPanelBtn = document.querySelector("#toggleInspector .msi");
      if (rightPanelBtn) {
        rightPanelBtn.textContent = this.inspectorOpen ? "right_panel_close" : "right_panel_open";
      }
      
      this.root.querySelectorAll<HTMLElement>(".rail-item").forEach((b) =>
        b.classList.toggle("is-active", this.inspectorOpen && b.dataset.tool === this.tool)
      );

      setTimeout(() => this.applyZoom(), 260);
    };

    const manualSave = document.getElementById("manualSaveBtn");
    if (manualSave) {
      manualSave.onclick = () => {
        this.store.persistForce();
        snackbar("Documento salvato con successo!");
        const label = document.getElementById("saveLabel");
        const t = new Date().toLocaleTimeString("it", { hour: "2-digit", minute: "2-digit" });
        if (label) label.textContent = `Salvato ${t}`;
      };
    }

    byId("themeBtn").onclick = () => this.toggleTheme();
    byId("importBtn").onclick = () => this.fileInput.click();
    byId("exportBtn").onclick = () => {
      if (this.screen !== "editor") this.goScreen("editor");
      this.switchTool("export");
    };
    if (desktop) {
      this.root.querySelectorAll<HTMLElement>(".win-ctrls button").forEach((b) => {
        b.onclick = () => {
          const a = b.dataset.win;
          if (a === "min") desktop.minimize();
          else if (a === "max") desktop.toggleMaximize();
          else desktop.close();
        };
      });
    }
  }

  bindRail() {
    byId("railImport").onclick = () => this.fileInput.click();
    this.root.querySelectorAll<HTMLElement>(".rail-item").forEach((b) => {
      b.onclick = () => this.switchTool(b.dataset.tool as RailTool);
    });
  }

  bindSource() {
    const ed = byId<HTMLTextAreaElement>("editor");
    
    this.updateEditorStatus();

    ed.addEventListener("input", () => {
      this.store.set({ source: ed.value });
      this.schedule();
      this.updateReviewReadouts();
      this.updateEditorStatus();
      this.pushStateDebounced();
      if (this.tool === "typography") {
        this.updateSelectionFormattingPanel();
      }
    });

    const updateSel = () => {
      this.lastSelection = { start: ed.selectionStart, end: ed.selectionEnd };
      this.updateEditorStatus();
      if (this.tool === "typography") {
        this.updateSelectionFormattingPanel();
      }
    };
    ed.addEventListener("select", updateSel);
    ed.addEventListener("keyup", updateSel);
    ed.addEventListener("mousedown", () => setTimeout(updateSel, 0));
    ed.addEventListener("click", updateSel);

    ed.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          this.applyMd("format_bold", ed);
        } else if (e.key === "i" || e.key === "I") {
          e.preventDefault();
          this.applyMd("format_italic", ed);
        } else if (e.key === "k" || e.key === "K") {
          e.preventDefault();
          this.applyMd("link", ed);
        } else if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          const fr = byId("findReplacePanel");
          if (fr) {
            const isHidden = fr.style.display === "none";
            fr.style.display = isHidden ? "flex" : "none";
            if (isHidden) {
              const findIn = byId<HTMLInputElement>("findInput");
              if (findIn) {
                findIn.focus();
                findIn.select();
              }
            }
          }
        }
      }
    });

    const btnReplace = byId("btnReplace");
    const btnReplaceAll = byId("btnReplaceAll");
    const btnCloseFind = byId("btnCloseFind");
    const findInput = byId<HTMLInputElement>("findInput");
    const replaceInput = byId<HTMLInputElement>("replaceInput");
    const frPanel = byId("findReplacePanel");

    if (btnCloseFind && frPanel) {
      btnCloseFind.onclick = () => {
        frPanel.style.display = "none";
        ed.focus();
      };
    }

    if (btnReplace && findInput && replaceInput) {
      btnReplace.onclick = () => {
        const query = findInput.value;
        const rep = replaceInput.value;
        if (!query) return;
        
        const idx = ed.value.indexOf(query, ed.selectionEnd);
        const targetIdx = idx !== -1 ? idx : ed.value.indexOf(query);
        
        if (targetIdx !== -1) {
          ed.focus();
          ed.setSelectionRange(targetIdx, targetIdx + query.length);
          ed.setRangeText(rep, targetIdx, targetIdx + query.length, "select");
          this.store.set({ source: ed.value });
          this.renderPreview();
          this.updateEditorStatus();
        } else {
          snackbar("Nessuna corrispondenza trovata.");
        }
      };
    }

    if (btnReplaceAll && findInput && replaceInput) {
      btnReplaceAll.onclick = () => {
        const query = findInput.value;
        const rep = replaceInput.value;
        if (!query) return;
        
        if (ed.value.includes(query)) {
          const newText = ed.value.replaceAll(query, rep);
          ed.value = newText;
          this.store.set({ source: newText });
          this.renderPreview();
          this.updateEditorStatus();
          snackbar("Sostituzioni completate con successo!");
        } else {
          snackbar("Nessuna corrispondenza trovata.");
        }
      };
    }

    // Toggle color menu
    const colorTrigger = byId("tbColorTrigger");
    const colorMenu = byId("tbColorMenu");
    if (colorTrigger && colorMenu) {
      colorTrigger.onclick = (e) => {
        e.stopPropagation();
        colorMenu.style.display = colorMenu.style.display === "none" ? "grid" : "none";
        const fontMenu = byId("tbFontMenu");
        if (fontMenu) fontMenu.style.display = "none";
      };
    }

    // Toggle font menu
    const fontTrigger = byId("tbFontTrigger");
    const fontMenu = byId("tbFontMenu");
    if (fontTrigger && fontMenu) {
      fontTrigger.onclick = (e) => {
        e.stopPropagation();
        fontMenu.style.display = fontMenu.style.display === "none" ? "flex" : "none";
        const colorMenu = byId("tbColorMenu");
        if (colorMenu) colorMenu.style.display = "none";
      };
    }

    // Close menus on click outside
    document.addEventListener("click", () => {
      if (colorMenu) colorMenu.style.display = "none";
      if (fontMenu) fontMenu.style.display = "none";
    });

    // Apply color from toolbar dropdown
    colorMenu?.querySelectorAll<HTMLElement>(".color-menu-sw").forEach((b) => {
      b.onclick = () => {
        const c = b.dataset.col!;
        this.applyInlineStyle("color", c);
      };
    });

    // Apply font from toolbar dropdown
    fontMenu?.querySelectorAll<HTMLElement>(".font-menu-item").forEach((b) => {
      b.onclick = () => {
        const f = b.dataset.font!;
        this.applyInlineStyle("font", f);
      };
    });

    byId("mdToolbar")
      .querySelectorAll<HTMLElement>("[data-md]")
      .forEach((b) => (b.onclick = () => this.applyMd(b.dataset.md!, ed)));

    const goTypo = document.getElementById("srcGoTypography");
    if (goTypo) {
      goTypo.onclick = () => {
        if (this.screen !== "editor") this.goScreen("editor");
        this.switchTool("typography");
      };
    }

    const helpBtn = document.getElementById("mdHelpBtn");
    if (helpBtn) {
      helpBtn.onclick = () => this.openMarkdownHelp();
    }
  }

  bindPreviewHead() {
    bindSegmented("viewSeg", (v) => {
      this.view = v as ViewMode;
      const facingBtn = byId("facingQuick");
      if (facingBtn) {
        facingBtn.style.display = v === "paged" ? "inline-flex" : "none";
      }
      this.renderPreview();
    });
    byId("zoomOut").onclick = () => this.setZoom(this.zoom - 0.08);
    byId("zoomIn").onclick = () => this.setZoom(this.zoom + 0.08);
    byId("zoomFit").onclick = () => this.setZoom(this.fitZoomValue());
    
    const facingBtn = byId("facingQuick");
    if (facingBtn) {
      facingBtn.onclick = () => {
        this.facing = !this.facing;
        facingBtn.classList.toggle("is-active", this.facing);
        const scrollEl = byId("previewScroll");
        if (scrollEl) {
          scrollEl.classList.toggle("facing-pages", this.facing);
        }
      };
    }

    byId("gridQuick").onclick = () => {
      const show = !(this.s.showColumns || this.s.showMargins);
      this.store.setSettings({ showColumns: show, showMargins: show });
      byId("gridQuick").classList.toggle("is-active", show);
    };
    const saveQuick = byId("saveQuick");
    if (saveQuick) {
      saveQuick.onclick = () => {
        this.store.persistForce();
        snackbar("Documento salvato con successo!");
        const label = document.getElementById("saveLabel");
        const t = new Date().toLocaleTimeString("it", { hour: "2-digit", minute: "2-digit" });
        if (label) label.textContent = `Salvato ${t}`;
      };
    }
  }

  bindFileInput() {
    this.fileInput.onchange = async () => {
      const f = this.fileInput.files?.[0];
      if (f) await this.doImport(f);
      this.fileInput.value = "";
    };
  }

  bindDnd() {
    const sc = this.previewScroll;
    ["dragover", "dragenter"].forEach((ev) =>
      sc.addEventListener(ev, (e) => {
        e.preventDefault();
        sc.style.outline = "2px dashed var(--md-primary)";
        sc.style.outlineOffset = "-8px";
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      sc.addEventListener(ev, (e) => {
        e.preventDefault();
        sc.style.outline = "none";
      })
    );
    sc.addEventListener("drop", async (e) => {
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) await this.doImport(f);
    });
  }

  /* --------------------------- actions --------------------------- */
  schedule() {
    if (this.view === "paged") this.schedulePaged();
    else this.schedulePreview();
  }

  async doImport(file: File) {
    try {
      const res = await importFile(file);
      const doc: DocState = {
        id: newId(),
        title: res.title,
        source: res.source,
        front: { kicker: "", headline: res.title, deck: "", author: "", dateline: "", section: "" },
        settings: this.newDocSettings(),
        status: "draft",
        meta: { ...defaultMeta },
        references: [],
      };
      this.store.replace(doc);
      this.openEditor();
      snackbar(res.note ?? `Importato: ${file.name}`);
    } catch (err) {
      snackbar(`Import non riuscito: ${(err as Error).message}`);
    }
  }

  toggleTheme() {
    this.prefs.theme = this.prefs.theme === "dark" ? "light" : "dark";
    applyPrefs(this.prefs);
    savePrefs(this.prefs);
    this.updateTitlebar();
    if (this.screen === "editor") this.renderPreview();
  }

  /* Build a new document's settings from the user's defaults. */
  newDocSettings(extra: Partial<Settings> = {}): Settings {
    const base = { ...defaultSettings };
    base.pageSize = this.prefs.defPageSize;
    if (PAGE_PRESETS[this.prefs.defPageSize]) {
      base.pageW = PAGE_PRESETS[this.prefs.defPageSize].w;
      base.pageH = PAGE_PRESETS[this.prefs.defPageSize].h;
    }
    base.bodySize = this.prefs.defBodySize;
    base.leading = this.prefs.defLeading;
    return { ...base, ...extra };
  }

  newFromTemplate(t: Template) {
    const doc: DocState = {
      id: newId(),
      title: t.id === "blank" ? "Senza titolo" : t.name,
      source: t.source,
      front: { kicker: "", headline: "", deck: "", author: "", dateline: "", section: "", ...t.front },
      settings: this.newDocSettings(t.settings),
      status: "draft",
      meta: { ...defaultMeta },
      references: [],
    };
    this.store.replace(doc);
    this.openEditor();
    snackbar(`Creato: ${t.name}`);
  }

  openDoc(id: string) {
    const doc = getFromLibrary(id);
    if (!doc) return;
    this.store.replace(doc);
    this.openEditor();
  }

  openEditor() {
    this.tool = "document";
    this.view = "galley";
    this.goScreen("editor");
  }

  switchTool(tool: RailTool) {
    const ws = byId("workspace");
    if (this.tool === tool && this.inspectorOpen) {
      this.inspectorOpen = false;
      ws.classList.add("inspector-collapsed");
      ws.style.setProperty("--inspector-w", "0px");
      this.root.querySelectorAll<HTMLElement>(".rail-item").forEach((b) =>
        b.classList.remove("is-active")
      );
    } else {
      this.tool = tool;
      this.inspectorOpen = true;
      ws.classList.remove("inspector-collapsed");
      ws.style.setProperty("--inspector-w", `${this.inspectorW}px`);
      this.root.querySelectorAll<HTMLElement>(".rail-item").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.tool === tool)
      );
      this.renderInspector();
    }
    const rightPanelBtn = document.querySelector("#toggleInspector .msi");
    if (rightPanelBtn) {
      rightPanelBtn.textContent = this.inspectorOpen ? "right_panel_close" : "right_panel_open";
    }
    setTimeout(() => this.applyZoom(), 260);
  }

  applyMd(kind: string, ed: HTMLTextAreaElement) {
    this.pushState(ed.value);
    const start = ed.selectionStart;
    const end = ed.selectionEnd;
    const sel = ed.value.slice(start, end);
    let insert = sel;
    let caret = 0;
    switch (kind) {
      case "format_bold":
        insert = `**${sel || "grassetto"}**`;
        break;
      case "format_italic":
        insert = `_${sel || "corsivo"}_`;
        break;
      case "title":
        insert = `\n## ${sel || "Titolo di sezione"}\n`;
        break;
      case "format_quote":
        insert = `\n> ${sel || "citazione"}\n`;
        break;
      case "format_size":
        insert = `\n:::pullquote\n${sel || "Frase di grande impatto."}\n:::\n`;
        break;
      case "palette":
        insert = `[${sel || "testo"}]{color: #e01a1a}`;
        break;
      case "font_download":
        insert = `[${sel || "testo"}]{font: display}`;
        break;
      case "image": {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.onchange = () => {
          const file = fileInput.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
              const base64 = e.target?.result as string;
              const alt = file.name.substring(0, file.name.lastIndexOf('.')) || "immagine";
              const md = `\n![${alt}](${base64} "Didascalia dell'immagine | Foto: Autore")\n`;
              ed.setRangeText(md, start, end, "end");
              ed.focus();
              this.store.set({ source: ed.value });
              this.renderPreview();
            };
            reader.readAsDataURL(file);
          }
        };
        fileInput.click();
        return;
      }
      case "superscript":
        insert = `${sel}[^nota]`;
        caret = 0;
        break;
      case "link":
        insert = `[${sel || "testo"}](https://)`;
        break;
      case "format_list_bulleted":
        insert = `\n- ${sel || "voce"}\n`;
        break;
    }
    ed.setRangeText(insert, start, end, "end");
    ed.focus();
    void caret;
    this.store.set({ source: ed.value });
    this.schedule();
    this.updateReviewReadouts();
  }

  isMatchingKey(k1: string, k2: string): boolean {
    k1 = k1.trim().toLowerCase();
    k2 = k2.trim().toLowerCase();
    if (k1 === k2) return true;
    if ((k1 === "font" || k1 === "font-family") && (k2 === "font" || k2 === "font-family")) return true;
    if ((k1 === "bg" || k1 === "background" || k1 === "background-color") && (k2 === "bg" || k2 === "background" || k2 === "background-color")) return true;
    if ((k1 === "size" || k1 === "font-size") && (k2 === "size" || k2 === "font-size")) return true;
    if ((k1 === "decoration" || k1 === "text-decoration") && (k2 === "decoration" || k2 === "text-decoration")) return true;
    if ((k1 === "weight" || k1 === "font-weight") && (k2 === "weight" || k2 === "font-weight")) return true;
    if ((k1 === "style" || k1 === "font-style") && (k2 === "style" || k2 === "font-style")) return true;
    return false;
  }

  applyInlineStyle(key: string, val: string): boolean {
    const ed = byId<HTMLTextAreaElement>("editor");
    if (!ed) return false;
    
    this.pushState(ed.value);
    let start = ed.selectionStart;
    let end = ed.selectionEnd;
    if (start === end && this.lastSelection.start !== this.lastSelection.end) {
      start = this.lastSelection.start;
      end = this.lastSelection.end;
    }

    if (start === end) return false;

    let sel = ed.value.slice(start, end);
    const match = sel.match(/^\[(.*)\]\{([^}]+)\}$/);
    if (match) {
      const innerText = match[1];
      const styleStr = match[2];
      const styles = styleStr.split(";").map(s => s.trim()).filter(Boolean);
      let foundKey = false;
      const updatedStyles = styles.map(s => {
        const parts = s.split(":");
        if (parts.length >= 2) {
          const k = parts[0].trim().toLowerCase();
          if (this.isMatchingKey(k, key)) {
            foundKey = true;
            return `${parts[0].trim()}: ${val}`;
          }
        }
        return s;
      });
      if (!foundKey) {
        updatedStyles.push(`${key}: ${val}`);
      }
      const insert = `[${innerText}]{${updatedStyles.join("; ")}}`;
      ed.setRangeText(insert, start, end, "select");
      ed.focus();
      this.lastSelection = { start, end: start + insert.length };
      this.store.set({ source: ed.value });
      this.renderPreview();
      this.updateSelectionFormattingPanel();
      return true;
    }

    let insert = `[${sel}]{${key}: ${val}}`;
    ed.setRangeText(insert, start, end, "select");
    ed.focus();
    this.lastSelection = { start, end: start + insert.length };
    this.store.set({ source: ed.value });
    this.renderPreview();
    this.updateSelectionFormattingPanel();
    return true;
  }

  removeInlineStyleKey(key: string): boolean {
    const ed = byId<HTMLTextAreaElement>("editor");
    if (!ed) return false;
    
    this.pushState(ed.value);
    let start = ed.selectionStart;
    let end = ed.selectionEnd;
    if (start === end && this.lastSelection.start !== this.lastSelection.end) {
      start = this.lastSelection.start;
      end = this.lastSelection.end;
    }

    if (start === end) return false;

    let sel = ed.value.slice(start, end);
    const match = sel.match(/^\[(.*)\]\{([^}]+)\}$/);
    if (match) {
      const innerText = match[1];
      const styleStr = match[2];
      const styles = styleStr.split(";").map(s => s.trim()).filter(Boolean);
      const updatedStyles = styles.filter(s => {
        const parts = s.split(":");
        if (parts.length >= 2) {
          const k = parts[0].trim().toLowerCase();
          if (this.isMatchingKey(k, key)) {
            return false;
          }
        }
        return true;
      });
      
      let insert = "";
      if (updatedStyles.length > 0) {
        insert = `[${innerText}]{${updatedStyles.join("; ")}}`;
      } else {
        insert = innerText;
      }
      ed.setRangeText(insert, start, end, "select");
      ed.focus();
      this.lastSelection = { start, end: start + insert.length };
      this.store.set({ source: ed.value });
      this.renderPreview();
      this.updateSelectionFormattingPanel();
      return true;
    }
    return false;
  }

  clearInlineSelectionStyle(): boolean {
    const ed = byId<HTMLTextAreaElement>("editor");
    if (!ed) return false;
    
    this.pushState(ed.value);
    let start = ed.selectionStart;
    let end = ed.selectionEnd;
    if (start === end && this.lastSelection.start !== this.lastSelection.end) {
      start = this.lastSelection.start;
      end = this.lastSelection.end;
    }

    if (start === end) return false;

    let sel = ed.value.slice(start, end);
    const match = sel.match(/^\[(.*)\]\{([^}]+)\}$/);
    if (match) {
      const innerText = match[1];
      ed.setRangeText(innerText, start, end, "select");
      ed.focus();
      this.lastSelection = { start, end: start + innerText.length };
      this.store.set({ source: ed.value });
      this.renderPreview();
      this.updateSelectionFormattingPanel();
      return true;
    }
    return false;
  }

  updateSelectionFormattingPanel() {
    const panel = document.getElementById("selectionStyleSection");
    if (!panel) return;

    const ed = byId<HTMLTextAreaElement>("editor");
    if (!ed) return;

    const start = ed.selectionStart;
    const end = ed.selectionEnd;
    if (start === end) {
      panel.style.display = "none";
      return;
    }

    panel.style.display = "block";

    // Populate values
    const sel = ed.value.slice(start, end);
    const match = sel.match(/^\[(.*)\]\{([^}]+)\}$/);

    const fSelect = byId<HTMLSelectElement>("selFont");
    const cInput = byId<HTMLInputElement>("selColor");
    const bgInput = byId<HTMLInputElement>("selBg");
    const sSelect = byId<HTMLSelectElement>("selSize");
    const btnB = byId<HTMLButtonElement>("selBtnBold");
    const btnI = byId<HTMLButtonElement>("selBtnItalic");
    const btnU = byId<HTMLButtonElement>("selBtnUnderline");
    const btnS = byId<HTMLButtonElement>("selBtnStrike");

    // Defaults
    if (fSelect) fSelect.value = "";
    if (cInput) cInput.value = "#000000";
    if (bgInput) bgInput.value = "#ffff00";
    if (sSelect) sSelect.value = "";
    if (btnB) btnB.classList.remove("is-active");
    if (btnI) btnI.classList.remove("is-active");
    if (btnU) btnU.classList.remove("is-active");
    if (btnS) btnS.classList.remove("is-active");

    if (match) {
      const styleStr = match[2];
      const styles = styleStr.split(";").map(s => s.trim()).filter(Boolean);
      for (const style of styles) {
        const parts = style.split(":");
        if (parts.length < 2) continue;
        const key = parts[0].trim().toLowerCase();
        const val = parts.slice(1).join(":").trim();

        if (key === "color" && cInput) {
          cInput.value = val;
        } else if ((key === "font" || key === "font-family") && fSelect) {
          fSelect.value = val;
        } else if ((key === "bg" || key === "background" || key === "background-color") && bgInput) {
          bgInput.value = val;
        } else if ((key === "size" || key === "font-size") && sSelect) {
          sSelect.value = val;
        } else if (key === "weight" || key === "font-weight") {
          if (val === "bold" && btnB) btnB.classList.add("is-active");
        } else if (key === "style" || key === "font-style") {
          if (val === "italic" && btnI) btnI.classList.add("is-active");
        } else if (key === "decoration" || key === "text-decoration") {
          if (val.includes("underline") && btnU) btnU.classList.add("is-active");
          if (val.includes("line-through") && btnS) btnS.classList.add("is-active");
        }
      }
    }
  }

  updateEditorStatus() {
    const ed = byId<HTMLTextAreaElement>("editor");
    if (!ed) return;
    const text = ed.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;

    const start = ed.selectionStart;
    const end = ed.selectionEnd;
    
    const countEl = byId("statusCount");
    const charsEl = byId("statusChars");
    const selEl = byId("statusSel");
    
    if (countEl) countEl.textContent = `${words} ${words === 1 ? 'parola' : 'parole'}`;
    if (charsEl) charsEl.textContent = `${chars} ${chars === 1 ? 'carattere' : 'caratteri'}`;
    
    if (selEl) {
      if (start !== end) {
        const selText = text.slice(start, end);
        const selWords = selText.trim() ? selText.trim().split(/\s+/).length : 0;
        const selChars = selText.length;
        selEl.textContent = `Selezionato: ${selWords} ${selWords === 1 ? 'parola' : 'parole'}, ${selChars} ${selChars === 1 ? 'carattere' : 'caratteri'}`;
        selEl.style.display = "inline-flex";
      } else {
        selEl.style.display = "none";
      }
    }
  }

  pushState(source: string) {
    if (this.undoStack.length === 0 || this.undoStack[this.undoStack.length - 1] !== source) {
      this.undoStack.push(source);
      this.redoStack = [];
      if (this.undoStack.length > 50) this.undoStack.shift();
    }
  }

  undo() {
    if (this.undoStack.length > 1) {
      const current = this.undoStack.pop()!;
      this.redoStack.push(current);
      const prev = this.undoStack[this.undoStack.length - 1];
      this.applyState(prev);
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      const next = this.redoStack.pop()!;
      this.undoStack.push(next);
      this.applyState(next);
    }
  }

  applyState(source: string) {
    this.store.set({ source });
    const ed = byId<HTMLTextAreaElement>("editor");
    if (ed) {
      const oldSelStart = ed.selectionStart;
      const oldSelEnd = ed.selectionEnd;
      ed.value = source;
      ed.setSelectionRange(Math.min(oldSelStart, source.length), Math.min(oldSelEnd, source.length));
    }
    this.renderPreview();
    this.updateEditorStatus();
  }

  private pushStateDebounced = debounce(() => {
    const ed = byId<HTMLTextAreaElement>("editor");
    if (ed) this.pushState(ed.value);
  }, 1000);

  showFloatingFormatBar(rect: DOMRect, range: Range) {
    let bar = byId("floatingFormatBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "floatingFormatBar";
      bar.className = "floating-format-bar";
      document.body.appendChild(bar);
    }
    
    if (bar.style.display !== "flex") {
      bar.innerHTML = `
        <button class="bar-btn" id="flBold" title="Grassetto">${icon("format_bold", "xs")}</button>
        <button class="bar-btn" id="flItalic" title="Corsivo">${icon("format_italic", "xs")}</button>
        <div class="bar-sep"></div>
        <div class="bar-dropdown">
          <button class="bar-btn" id="flColor" title="Colore">${icon("palette", "xs")}</button>
          <div class="bar-drop-menu color-grid-menu" id="flColorMenu" style="display:none;">
            ${["#991b1b", "#ea580c", "#d97706", "#14532d", "#0f766e", "#1e3a8a", "#7c3aed", "#c026d3", "#db2777", "#854d0e", "#18181a", "#000000"]
              .map((c) => `<button class="color-menu-sw" data-col="${c}" style="background:${c}"></button>`)
              .join("")}
          </div>
        </div>
        <div class="bar-dropdown">
          <button class="bar-btn" id="flFont" title="Font">${icon("font_download", "xs")}</button>
          <div class="bar-drop-menu font-list-menu" id="flFontMenu" style="display:none;">
            ${FONT_OPTIONS.map(([val, label]) => `<button class="font-menu-item" data-font="${val}">${label}</button>`).join("")}
          </div>
        </div>
      `;

      const btnBold = bar.querySelector("#flBold") as HTMLButtonElement;
      const btnItalic = bar.querySelector("#flItalic") as HTMLButtonElement;
      const btnColor = bar.querySelector("#flColor") as HTMLButtonElement;
      const colorMenu = bar.querySelector("#flColorMenu") as HTMLElement;
      const btnFont = bar.querySelector("#flFont") as HTMLButtonElement;
      const fontMenu = bar.querySelector("#flFontMenu") as HTMLElement;

      btnBold.onmousedown = (e) => {
        e.preventDefault();
        document.execCommand("bold");
        this.syncActiveBlock();
      };

      btnItalic.onmousedown = (e) => {
        e.preventDefault();
        document.execCommand("italic");
        this.syncActiveBlock();
      };

      btnColor.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        colorMenu.style.display = colorMenu.style.display === "none" ? "grid" : "none";
        fontMenu.style.display = "none";
      };

      btnFont.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        fontMenu.style.display = fontMenu.style.display === "none" ? "flex" : "none";
        colorMenu.style.display = "none";
      };

      colorMenu.querySelectorAll<HTMLElement>(".color-menu-sw").forEach((sw) => {
        sw.onmousedown = (e) => {
          e.preventDefault();
          const c = sw.dataset.col!;
          document.execCommand("styleWithCSS", false, "true");
          document.execCommand("foreColor", false, c);
          colorMenu.style.display = "none";
          this.syncActiveBlock();
        };
      });

      fontMenu.querySelectorAll<HTMLElement>(".font-menu-item").forEach((item) => {
        item.onmousedown = (e) => {
          e.preventDefault();
          const fontName = item.dataset.font!;
          const fontStack = FONT_STACKS[fontName] || fontName;
          
          const selText = window.getSelection()?.toString() || "";
          const span = document.createElement("span");
          span.style.fontFamily = fontStack;
          span.textContent = selText;
          
          range.deleteContents();
          range.insertNode(span);
          fontMenu.style.display = "none";
          this.syncActiveBlock();
        };
      });
    }

    const w = 180;
    const h = 36;
    const left = rect.left + window.scrollX + (rect.width / 2) - (w / 2);
    const top = rect.top + window.scrollY - h - 10;
    
    bar.style.position = "absolute";
    bar.style.left = `${Math.max(10, left)}px`;
    bar.style.top = `${Math.max(10, top)}px`;
    bar.style.display = "flex";
  }

  syncActiveBlock() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && !(node instanceof HTMLElement && node.getAttribute("data-body-block") === "true")) {
      node = node.parentNode;
    }
    if (node instanceof HTMLElement) {
      const oldMd = this.originalBlockText.trim();
      const newMd = getBlockMd(node.tagName, node.innerHTML).trim();
      if (oldMd !== newMd && this.store.state.source.includes(oldMd)) {
        const updatedSource = this.store.state.source.replace(oldMd, newMd);
        this.store.set({ source: updatedSource });
        const ed = byId<HTMLTextAreaElement>("editor");
        if (ed) ed.value = updatedSource;
        this.originalBlockText = newMd;
        this.renderPreview();
      }
    }
  }

  hideFloatingFormatBar() {
    const bar = byId("floatingFormatBar");
    if (bar) bar.style.display = "none";
  }

  /* --------------------------- zoom --------------------------- */
  fitZoomValue(): number {
    const dims = pageDims(this.s);
    const avail = (this.previewScroll?.clientWidth ?? 900) - 80;
    const pageW = dims.w * MM_TO_PX;
    return Math.max(0.2, Math.min(1.4, +(avail / pageW).toFixed(2)));
  }
  setZoom(z: number) {
    this.zoom = Math.max(0.2, Math.min(2, +z.toFixed(2)));
    this.applyZoom();
  }
  applyZoom() {
    this.stage.style.transform = `scale(${this.zoom})`;
    const zv = document.getElementById("zoomVal");
    if (zv) zv.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  updateCmyk() {
    this.previewScroll.classList.toggle("cmyk-sim", this.s.cmykPreview);
  }

  /* --------------------------- preview --------------------------- */
  compileDoc() {
    return compile(this.store.state.source, this.store.state.front, this.s, {
      references: this.store.state.references,
      meta: this.store.state.meta,
    });
  }

  async renderPreview() {
    const compiled = this.compileDoc();
    this.lastCompiled = compiled;
    const scrollEl = byId("previewScroll");
    if (this.view === "galley") {
      renderGalley(this.stage, compiled.html, this.s);
      this.pageCounter.textContent = "Bozza";
      if (scrollEl) scrollEl.classList.remove("facing-pages");
    } else {
      this.stage.style.transform = "scale(1)";
      this.pageCounter.textContent = "impagino…";
      const total = await this.runPaged(compiled.html);
      this.pageCounter.textContent = total ? `${total} ${total === 1 ? "pagina" : "pagine"}` : "—";
      if (scrollEl) {
        scrollEl.classList.toggle("facing-pages", this.facing);
      }
    }
    this.applyZoom();
    this.updateCmyk();
    this.updateReviewReadouts();
  }

  /* Run paged.js with a safety timeout so the UI never hangs on "impagino…". */
  async runPaged(html: string): Promise<number> {
    const race = Promise.race([
      renderPaged(this.stage, html, this.store.state),
      new Promise<number>((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
    ]);
    try {
      return await race;
    } catch {
      this.view = "galley";
      bindSegmentedActive("viewSeg", "galley");
      renderGalley(this.stage, html, this.s);
      snackbar("Impaginazione complessa: torno alla bozza continua.");
      return 0;
    }
  }

  refreshAfterSetting() {
    this.renderPreview();
  }

  /* --------------------------- inspector --------------------------- */
  renderInspector() {
    const meta: Record<RailTool, [string, string]> = {
      document: ["article", "Documento"],
      layout: ["grid_on", "Layout & Griglie"],
      typography: ["match_case", "Tipografia"],
      editoria: ["auto_stories", "Editoria"],
      review: ["fact_check", "Revisione editoriale"],
      ai: ["smart_toy", "Strumenti AI"],
      export: ["ios_share", "Esportazione"],
    };
    const [ic, title] = meta[this.tool];
    this.inspectorIcon.textContent = ic;
    this.inspectorTitle.textContent = title;

    switch (this.tool) {
      case "document":
        this.inspectorBody.innerHTML = this.panelDocument();
        this.bindDocument();
        break;
      case "layout":
        this.inspectorBody.innerHTML = this.panelLayout();
        this.bindLayout();
        break;
      case "typography":
        this.inspectorBody.innerHTML = this.panelTypography();
        this.bindTypography();
        break;
      case "editoria":
        this.inspectorBody.innerHTML = this.panelEditoria();
        this.bindEditoria();
        break;
      case "review":
        this.inspectorBody.innerHTML = this.panelReview();
        this.bindReview();
        break;
      case "ai":
        this.inspectorBody.innerHTML = this.panelAI();
        this.bindAI();
        break;
      case "export":
        this.inspectorBody.innerHTML = this.panelExport();
        this.bindExport();
        break;
    }
  }

  /* ---- panel: document / front-matter ---- */
  mastheadStyleRow(label: string, fontKey: string, colorKey: string): string {
    const s = this.s as unknown as Record<string, string>;
    const fval = s[fontKey] || "";
    const cval = s[colorKey] || "";
    return `<div class="mh-row">
      <span class="mh-label">${label}</span>
      <select class="mh-font" data-mh-font="${fontKey}">
        <option value="">Font predefinito</option>
        ${FONT_OPTIONS.map(([k, l]) => `<option value="${k}" ${k === fval ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}
      </select>
      <input type="color" class="mh-color" data-mh-color="${colorKey}" value="${cval || "#888888"}" data-tip="Colore">
      <button class="icon-btn mh-reset" data-mh-reset="${colorKey}" data-tip="Reimposta">${icon("backspace", "sm")}</button>
    </div>`;
  }

  panelDocument(): string {
    const f = this.store.state.front;
    return `
      <div class="section">
        <h3>${icon("newspaper", "sm")} Testata articolo</h3>
        <div class="stack">
          ${fieldText("Occhiello (kicker)", "fmKicker", f.kicker, "Rubrica · Sezione")}
          ${fieldText("Titolo (headline)", "fmHeadline", f.headline)}
          ${fieldText("Sommario (deck)", "fmDeck", f.deck)}
          <div class="grid-2">
            ${fieldText("Firma", "fmAuthor", f.author, "di Nome Cognome")}
            ${fieldText("Sezione", "fmSection", f.section, "Cultura")}
          </div>
          ${fieldText("Data e luogo (dateline)", "fmDateline", f.dateline, "MILANO — 15 giugno 2026")}
        </div>
        <p class="help">La testata viene composta automaticamente in cima all'impaginato e nella copertina ePub.</p>
      </div>
      <div class="section">
        <h3>${icon("format_paint", "sm")} Stile testata</h3>
        <div class="stack">
          ${this.mastheadStyleRow("Titolo", "headlineFont", "headlineColor")}
          ${this.mastheadStyleRow("Occhiello", "kickerFont", "kickerColor")}
          ${this.mastheadStyleRow("Sommario", "deckFont", "deckColor")}
        </div>
        <p class="help">Font e colore per ogni parte della testata. Vuoto = stile predefinito del documento.</p>
      </div>
      <div class="section">
        <h3>${icon("insights", "sm")} A colpo d'occhio</h3>
        <div class="metric-grid" id="docQuick"></div>
      </div>
      <div class="section">
        <h3>${icon("public", "sm")} Condividi layout</h3>
        <button class="btn btn--tonal btn--sm" style="width:100%" id="btnSidebarPublish">${icon("cloud_upload")} Pubblica nel Mondo</button>
        <p class="help">Salva il layout e il contenuto di questo documento come modello pubblico offline.</p>
      </div>`;
  }
  bindDocument() {
    const map: [string, keyof typeof this.store.state.front][] = [
      ["fmKicker", "kicker"],
      ["fmHeadline", "headline"],
      ["fmDeck", "deck"],
      ["fmAuthor", "author"],
      ["fmSection", "section"],
      ["fmDateline", "dateline"],
    ];
    for (const [id, key] of map) {
      byId<HTMLInputElement>(id).addEventListener("input", (e) => {
        this.store.setFront(key, (e.target as HTMLInputElement).value);
        this.schedule();
      });
    }
    // masthead per-part font/colour
    this.inspectorBody.querySelectorAll<HTMLSelectElement>("[data-mh-font]").forEach((el) => {
      el.addEventListener("change", () => {
        this.store.setSetting(el.dataset.mhFont as keyof Settings, el.value as never);
        this.renderPreview();
      });
    });
    this.inspectorBody.querySelectorAll<HTMLInputElement>("[data-mh-color]").forEach((el) => {
      el.addEventListener("input", () => {
        this.store.setSetting(el.dataset.mhColor as keyof Settings, el.value as never);
        this.renderPreview();
      });
    });
    this.inspectorBody.querySelectorAll<HTMLElement>("[data-mh-reset]").forEach((el) => {
      el.onclick = () => {
        this.store.setSetting(el.dataset.mhReset as keyof Settings, "" as never);
        this.renderInspector();
        this.renderPreview();
      };
    });
    this.updateDocQuick();
    const pubBtn = document.getElementById("btnSidebarPublish");
    if (pubBtn) {
      pubBtn.onclick = () => this.openPublishModal();
    }
  }
  updateDocQuick() {
    const host = document.getElementById("docQuick");
    if (!host) return;
    const a = analyze(toPlainText(this.store.state.source), this.prefs.language);
    host.innerHTML = `
      ${tile(a.words.toLocaleString("it"), "Parole")}
      ${tile(fmtMin(a.readingMin), "Lettura")}
      ${tile(String(a.sentences), "Frasi")}
      ${tile(String(this.lastCompiled.footnoteCount), "Note")}`;
  }

  /* ---- panel: layout & grids ---- */
  panelLayout(): string {
    const s = this.s;
    const custom = s.pageSize === "Custom";
    return `
      <div class="section">
        <h3>${icon("crop_free", "sm")} Formato pagina</h3>
        <div class="stack">
          ${fieldSelect(
            "Formato",
            "pgSize",
            [
              ["A3", "A3 — 297 × 420"],
              ["A4", "A4 — 210 × 297"],
              ["A5", "A5 — 148 × 210"],
              ["Letter", "US Letter — 8.5 × 11″"],
              ["Tabloid", "Tabloid — 279 × 432"],
              ["Custom", "Personalizzato…"],
            ],
            s.pageSize
          )}
          ${segmented("pgOrient", [["portrait", "Verticale", "crop_portrait"], ["landscape", "Orizzontale", "crop_landscape"]], s.orientation)}
          <div class="grid-2" id="customDims" style="${custom ? "" : "display:none"}">
            ${fieldNumber("Larghezza (mm)", "pgW", s.pageW, 50, 2000)}
            ${fieldNumber("Altezza (mm)", "pgH", s.pageH, 50, 2000)}
          </div>
        </div>
      </div>
      <div class="section">
        <h3>${icon("margin", "sm")} Margini (mm)</h3>
        <div class="grid-2">
          ${fieldNumber("Alto", "mT", s.marginTop, 0, 100)}
          ${fieldNumber("Basso", "mB", s.marginBottom, 0, 100)}
          ${fieldNumber("Interno/Sx", "mL", s.marginLeft, 0, 100)}
          ${fieldNumber("Esterno/Dx", "mR", s.marginRight, 0, 100)}
        </div>
      </div>
      <div class="section">
        <h3>${icon("view_column", "sm")} Colonne</h3>
        <div class="stack">
          ${segmented("cols", [["1", "1"], ["2", "2"], ["3", "3"]], String(s.columns))}
          ${sliderRow("Spaziatura colonne (mm)", "colGap", 2, 20, 0.5, s.columnGap, " mm")}
          ${switchRow("Filetto di colonna", "Linea divisoria tra le colonne", "colRule", s.columnRule)}
        </div>
      </div>
      <div class="section">
        <h3>${icon("straighten", "sm")} Griglie e guide</h3>
        <div class="stack">
          ${switchRow("Margini al vivo", "Mostra la gabbia di testo", "gMargins", s.showMargins)}
          ${switchRow("Colonne", "Sovrapponi le colonne", "gCols", s.showColumns)}
          ${switchRow("Griglia di base", "Linee di base del testo", "gBaseline", s.showBaseline)}
          ${sliderRow("Passo linea di base", "baseStep", 8, 32, 1, s.baselineStep, " px")}
          ${switchRow("Sezione aurea", "Guide su rapporto 1:1,618", "gGolden", s.showGolden)}
          <button class="btn btn--tonal" id="goldenApply" style="width:100%">${icon("auto_awesome")}Margini aurei automatici</button>
        </div>
      </div>
      <div class="section">
        <h3>${icon("content_cut", "sm")} Stampa professionale</h3>
        <div class="stack">
          ${sliderRow("Abbondanza / bleed (mm)", "bleed", 0, 10, 0.5, s.bleed, " mm")}
          ${switchRow("Crocini di taglio e registro", "Crop & registration marks (PDF)", "marks", s.marks)}
          ${switchRow("Mostra abbondanza", "Evidenzia l'area di bleed in bozza", "showBleed", s.showBleed)}
          ${switchRow("Numeri di pagina", "", "pageNum", s.pageNumbers)}
          ${switchRow("Testatina corrente", "Running head in alto", "runHead", s.runningHead)}
        </div>
        <p class="help">Crocini e abbondanza compaiono nell'impaginato e nel PDF di stampa.</p>
      </div>`;
  }
  bindLayout() {
    const s = () => this.s;
    bindSelect("pgSize", (v) => {
      this.store.setSetting("pageSize", v as Settings["pageSize"]);
      if (v !== "Custom" && PAGE_PRESETS[v]) {
        this.store.setSetting("pageW", PAGE_PRESETS[v].w);
        this.store.setSetting("pageH", PAGE_PRESETS[v].h);
      }
      byId("customDims").style.display = v === "Custom" ? "" : "none";
      this.afterLayout(true);
    });
    bindSegmented("pgOrient", (v) => {
      this.store.setSetting("orientation", v as Settings["orientation"]);
      this.afterLayout(true);
    });
    bindNumber("pgW", (n) => (this.store.setSetting("pageW", n), this.afterLayout(true)));
    bindNumber("pgH", (n) => (this.store.setSetting("pageH", n), this.afterLayout(true)));
    bindNumber("mT", (n) => (this.store.setSetting("marginTop", n), this.afterLayout()));
    bindNumber("mB", (n) => (this.store.setSetting("marginBottom", n), this.afterLayout()));
    bindNumber("mL", (n) => (this.store.setSetting("marginLeft", n), this.afterLayout()));
    bindNumber("mR", (n) => (this.store.setSetting("marginRight", n), this.afterLayout()));
    bindSegmented("cols", (v) => {
      this.store.setSetting("columns", Number(v) as 1 | 2 | 3);
      this.afterLayout();
    });
    bindSlider("colGap", (n) => (this.store.setSetting("columnGap", n), this.afterLayout()), " mm");
    bindSwitch("colRule", (c) => (this.store.setSetting("columnRule", c), this.afterLayout()));
    bindSwitch("gMargins", (c) => (this.store.setSetting("showMargins", c), this.afterLayout()));
    bindSwitch("gCols", (c) => (this.store.setSetting("showColumns", c), this.afterLayout()));
    bindSwitch("gBaseline", (c) => (this.store.setSetting("showBaseline", c), this.afterLayout()));
    bindSlider("baseStep", (n) => (this.store.setSetting("baselineStep", n), this.afterLayout()), " px");
    bindSwitch("gGolden", (c) => (this.store.setSetting("showGolden", c), this.afterLayout()));
    bindSlider("bleed", (n) => (this.store.setSetting("bleed", n), this.afterLayout()), " mm");
    bindSwitch("marks", (c) => (this.store.setSetting("marks", c), this.afterLayout()));
    bindSwitch("showBleed", (c) => (this.store.setSetting("showBleed", c), this.afterLayout()));
    bindSwitch("pageNum", (c) => (this.store.setSetting("pageNumbers", c), this.afterLayout()));
    bindSwitch("runHead", (c) => (this.store.setSetting("runningHead", c), this.afterLayout()));
    byId("goldenApply").onclick = () => this.applyGoldenMargins();
    void s;
  }
  afterLayout(refit = false) {
    if (refit) this.zoom = this.fitZoomValue();
    this.renderPreview();
  }
  applyGoldenMargins() {
    const { w, h } = pageDims(this.s);
    // classic golden-canon proportion: inner margin = page width / 9
    const inner = +(w / 9).toFixed(1);
    this.store.setSetting("marginLeft", inner);
    this.store.setSetting("marginRight", +(inner * 2).toFixed(1));
    this.store.setSetting("marginTop", +(h / 9).toFixed(1));
    this.store.setSetting("marginBottom", +((h / 9) * 2).toFixed(1));
    this.store.setSetting("showGolden", true);
    this.renderInspector();
    this.afterLayout();
    snackbar("Applicato canone aureo dei margini (1:2 interno/esterno).");
  }

  /* ---- panel: typography ---- */
  panelTypography(): string {
    const s = this.s;
    return `
      <!-- Stile testo selezionato (dinamico) -->
      <div class="section selection-style-section" id="selectionStyleSection" style="display: none; margin-bottom: 20px;">
        <h3>${icon("edit_note", "sm")} Stile testo selezionato</h3>
        <div class="stack">
          <div class="field">
            <label for="selFont">Font selezione</label>
            <select id="selFont">
              <option value="">Ereditato (corpo)</option>
              ${FONT_OPTIONS.map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join("")}
            </select>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="field" style="flex: 1;">
              <label for="selColor">Colore testo</label>
              <div class="color-row">
                <input type="color" id="selColor" value="#000000" style="padding: 2px; height: 34px;">
              </div>
            </div>
            <div class="field" style="flex: 1;">
              <label for="selBg">Evidenziatore</label>
              <div class="color-row">
                <input type="color" id="selBg" value="#ffff00" style="padding: 2px; height: 34px;">
              </div>
            </div>
          </div>
          <div class="field">
            <label for="selSize">Dimensione</label>
            <select id="selSize">
              <option value="">Ereditato</option>
              <option value="0.75em">Molto piccolo (75%)</option>
              <option value="0.85em">Piccolo (85%)</option>
              <option value="1.15em">Medio (115%)</option>
              <option value="1.3em">Grande (130%)</option>
              <option value="1.5em">Molto grande (150%)</option>
              <option value="2em">Gigante (200%)</option>
            </select>
          </div>
          <div class="opt-row" style="padding: 6px 0;">
            <div class="opt-label">
              <b>Stili rapidi</b>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="icon-btn" id="selBtnBold" data-tip="Grassetto">${icon("format_bold", "sm")}</button>
              <button class="icon-btn" id="selBtnItalic" data-tip="Corsivo">${icon("format_italic", "sm")}</button>
              <button class="icon-btn" id="selBtnUnderline" data-tip="Sottolineato">${icon("format_underlined", "sm")}</button>
              <button class="icon-btn" id="selBtnStrike" data-tip="Barrato">${icon("strikethrough_s", "sm")}</button>
            </div>
          </div>
          <button class="btn btn--tonal btn--sm" style="width:100%" id="selBtnReset">${icon("format_clear")} Ripristina stile originale</button>
        </div>
      </div>

      <div class="section">
        <h3>${icon("text_fields", "sm")} Corpo del testo</h3>
        <div class="stack">
          ${fieldSelect("Carattere del testo", "bodyFont", FONT_OPTIONS, s.bodyFont)}
          ${fieldSelect("Carattere dei titoli", "headingFont", FONT_OPTIONS, s.headingFont)}
          <div class="field"><label for="textColor">Colore del testo</label>
            <div class="color-row">
              <input type="color" id="textColor" value="${s.textColor}">
              <div class="color-swatches" id="textColorSwatches">
                 ${["#18181a", "#000000", "#555555", "#991b1b", "#ea580c", "#d97706", "#14532d", "#0f766e", "#1e3a8a", "#4f46e5", "#7c3aed", "#c026d3", "#db2777", "#854d0e"]
                  .map((c) => `<button class="color-sw" data-col="${c}" style="background:${c}"></button>`)
                  .join("")}
              </div>
            </div>
          </div>
          ${sliderRow("Corpo (pt)", "bodySize", 7, 16, 0.25, s.bodySize, " pt")}
          ${sliderRow("Interlinea", "leading", 1.0, 2.2, 0.05, s.leading, "×")}
          ${segmented("align", [["justify", "Giustificato", "format_align_justify"], ["left", "A bandiera", "format_align_left"]], s.align)}
          ${sliderRow("Rientro paragrafo (em)", "indent", 0, 3, 0.1, s.paraIndent, " em")}
        </div>
      </div>
      <div class="section">
        <h3>${icon("auto_fix_high", "sm")} Regole tipografiche</h3>
        <div class="stack">
          ${switchRow("Sillabazione automatica", "Multilingua (hyphens: auto)", "hyphens", s.hyphens)}
          ${switchRow("Legature", "ﬁ, ﬂ — liga/clig", "liga", s.ligatures)}
          ${switchRow("Cifre minuscole", "Numeri in stile antico (oldstyle)", "oldstyle", s.oldstyle)}
          ${switchRow("Capolettera", "Drop cap sul primo paragrafo", "dropcap", s.dropcap)}
          ${switchRow("Tipografia intelligente", "Virgolette curve, trattini, …", "smart", s.smart)}
        </div>
      </div>
      <div class="section">
        <h3>${icon("rule", "sm")} Righe orfane e vedove</h3>
        <div class="grid-2">
          ${fieldNumber("Orfane (min)", "orphans", s.orphans, 1, 5)}
          ${fieldNumber("Vedove (min)", "widows", s.widows, 1, 5)}
        </div>
        <p class="help">Numero minimo di righe consentite all'inizio/fine di una pagina o colonna.</p>
      </div>
      <div class="section">
        <h3>${icon("tips_and_updates", "sm")} Sintassi editoriale</h3>
        <p class="help" style="line-height:1.7">
          <code>:::pullquote … :::</code> — frase in evidenza<br>
          <code>![alt](src "Didascalia | Foto: Autore")</code> — immagine ancorata<br>
          <code>testo[^1]</code> e <code>[^1]: nota</code> — note dinamiche
        </p>
      </div>`;
  }
  bindTypography() {
    // Inizializza e collega gli strumenti di stile selezione dinamica
    this.updateSelectionFormattingPanel();

    const selFont = byId<HTMLSelectElement>("selFont");
    if (selFont) {
      selFont.onchange = () => {
        if (selFont.value === "") {
          this.removeInlineStyleKey("font");
        } else {
          this.applyInlineStyle("font", selFont.value);
        }
      };
    }

    const selColor = byId<HTMLInputElement>("selColor");
    if (selColor) {
      selColor.oninput = () => {
        this.applyInlineStyle("color", selColor.value);
      };
    }

    const selBg = byId<HTMLInputElement>("selBg");
    if (selBg) {
      selBg.oninput = () => {
        this.applyInlineStyle("bg", selBg.value);
      };
    }

    const selSize = byId<HTMLSelectElement>("selSize");
    if (selSize) {
      selSize.onchange = () => {
        if (selSize.value === "") {
          this.removeInlineStyleKey("size");
        } else {
          this.applyInlineStyle("size", selSize.value);
        }
      };
    }

    const sBtnB = byId<HTMLButtonElement>("selBtnBold");
    if (sBtnB) {
      sBtnB.onclick = () => {
        if (sBtnB.classList.contains("is-active")) {
          this.removeInlineStyleKey("weight");
        } else {
          this.applyInlineStyle("weight", "bold");
        }
      };
    }

    const sBtnI = byId<HTMLButtonElement>("selBtnItalic");
    if (sBtnI) {
      sBtnI.onclick = () => {
        if (sBtnI.classList.contains("is-active")) {
          this.removeInlineStyleKey("style");
        } else {
          this.applyInlineStyle("style", "italic");
        }
      };
    }

    const sBtnU = byId<HTMLButtonElement>("selBtnUnderline");
    if (sBtnU) {
      sBtnU.onclick = () => {
        if (sBtnU.classList.contains("is-active")) {
          this.removeInlineStyleKey("decoration");
        } else {
          this.applyInlineStyle("decoration", "underline");
        }
      };
    }

    const sBtnS = byId<HTMLButtonElement>("selBtnStrike");
    if (sBtnS) {
      sBtnS.onclick = () => {
        if (sBtnS.classList.contains("is-active")) {
          this.removeInlineStyleKey("decoration");
        } else {
          this.applyInlineStyle("decoration", "line-through");
        }
      };
    }

    const sBtnReset = byId<HTMLButtonElement>("selBtnReset");
    if (sBtnReset) {
      sBtnReset.onclick = () => {
        this.clearInlineSelectionStyle();
      };
    }

    bindSelect("bodyFont", (v) => {
      if (this.applyInlineStyle("font", v)) {
        const select = byId<HTMLSelectElement>("bodyFont");
        if (select) select.value = this.s.bodyFont;
        return;
      }
      this.store.setSetting("bodyFont", v);
      this.renderPreview();
    });
    bindSelect("headingFont", (v) => {
      if (this.applyInlineStyle("font", v)) {
        const select = byId<HTMLSelectElement>("headingFont");
        if (select) select.value = this.s.headingFont;
        return;
      }
      this.store.setSetting("headingFont", v);
      this.renderPreview();
    });
    const hasLiveSelection = () => {
      const ed = document.getElementById("editor") as HTMLTextAreaElement | null;
      return !!ed && ed.selectionStart !== ed.selectionEnd;
    };
    const colorInput = byId<HTMLInputElement>("textColor");
    if (colorInput) {
      colorInput.addEventListener("input", () => {
        if (hasLiveSelection() && this.applyInlineStyle("color", colorInput.value)) {
          colorInput.value = this.s.textColor;
          return;
        }
        this.store.setSetting("textColor", colorInput.value);
        this.renderPreview();
      });
    }
    this.inspectorBody.querySelectorAll<HTMLElement>(".color-sw").forEach((b) => {
      b.onclick = () => {
        const c = b.dataset.col!;
        if (hasLiveSelection() && this.applyInlineStyle("color", c)) return;
        this.store.setSetting("textColor", c);
        if (colorInput) colorInput.value = c;
        this.renderPreview();
      };
    });
    bindSlider("bodySize", (n) => (this.store.setSetting("bodySize", n), this.renderPreview()), " pt");
    bindSlider("leading", (n) => (this.store.setSetting("leading", n), this.renderPreview()), "×");
    bindSegmented("align", (v) => (this.store.setSetting("align", v as Settings["align"]), this.renderPreview()));
    bindSlider("indent", (n) => (this.store.setSetting("paraIndent", n), this.renderPreview()), " em");
    bindSwitch("hyphens", (c) => (this.store.setSetting("hyphens", c), this.renderPreview()));
    bindSwitch("liga", (c) => (this.store.setSetting("ligatures", c), this.renderPreview()));
    bindSwitch("oldstyle", (c) => (this.store.setSetting("oldstyle", c), this.renderPreview()));
    bindSwitch("dropcap", (c) => (this.store.setSetting("dropcap", c), this.renderPreview()));
    bindSwitch("smart", (c) => (this.store.setSetting("smart", c), this.renderPreview()));
    bindNumber("orphans", (n) => (this.store.setSetting("orphans", n), this.renderPreview()));
    bindNumber("widows", (n) => (this.store.setSetting("widows", n), this.renderPreview()));
  }

  /* ---- panel: editoria (workflow · book metadata · bibliography) ---- */
  panelEditoria(): string {
    const m = this.store.state.meta;
    const st = this.store.state.status;
    const refs = this.store.state.references;
    return `
      <div class="section">
        <h3>${icon("workspaces", "sm")} Stato editoriale</h3>
        <div class="stack">
          ${segmented(
            "edStatus",
            [
              ["draft", "Bozza"],
              ["review", "Revisione"],
              ["approved", "Approvato"],
              ["published", "Pubblicato"],
            ],
            st
          )}
          <p class="help">Lo stato segue il flusso di produzione del documento ed è mostrato nella barra del titolo.</p>
        </div>
      </div>

      <div class="section">
        <h3>${icon("qr_code_2", "sm")} Metadati del volume</h3>
        <div class="stack">
          ${fieldText("ISBN", "edIsbn", m.isbn, "978-88-000-0000-0")}
          <div class="grid-2">
            ${fieldText("Editore", "edPublisher", m.publisher, "Casa editrice")}
            ${fieldText("Collana", "edCollection", m.collection, "")}
          </div>
          <div class="grid-2">
            ${fieldText("Edizione", "edEdition", m.edition, "Prima edizione")}
            ${fieldText("Anno", "edYear", m.year, "2026")}
          </div>
          ${fieldText("Copyright", "edCopyright", m.copyright, "© 2026 Autore")}
          ${fieldText("Diritti / licenza", "edRights", m.rights, "Tutti i diritti riservati")}
          ${fieldText("Soggetti / parole chiave", "edSubjects", m.subjects, "narrativa; saggistica")}
          ${switchRow("Genera colophon", "Pagina con i dati editoriali", "edColophon", m.genColophon)}
        </div>
        <p class="help">I metadati alimentano il colophon e la copertina/OPF dell'ePub.</p>
      </div>

      <div class="section">
        <h3>${icon("menu_book", "sm")} Bibliografia e citazioni</h3>
        ${segmented("citationStyle", [["author-date", "Autore-anno"], ["numeric", "Numerica (IEEE)"]], this.s.citationStyle)}
        <div id="refList" style="margin-top:12px"></div>
        <button class="btn btn--tonal" id="addRef" style="width:100%;margin-top:8px">${icon("add")}Aggiungi riferimento</button>
        <p class="help">Cita nel testo con <code>[@chiave]</code> → diventa <em>${this.s.citationStyle === "numeric" ? "[1]" : "(Autore anno)"}</em> e genera automaticamente la sezione Bibliografia. ${refs.length ? `${refs.length} riferimenti.` : ""}</p>
      </div>`;
  }

  bindEditoria() {
    bindSegmented("edStatus", (v) => {
      this.store.set({ status: v as EditorialStatus });
      this.updateStatusChip();
    });
    const metaMap: [string, keyof EditorialMeta][] = [
      ["edIsbn", "isbn"],
      ["edPublisher", "publisher"],
      ["edCollection", "collection"],
      ["edEdition", "edition"],
      ["edYear", "year"],
      ["edCopyright", "copyright"],
      ["edRights", "rights"],
      ["edSubjects", "subjects"],
    ];
    for (const [id, key] of metaMap) {
      byId<HTMLInputElement>(id).addEventListener("input", (e) => {
        this.store.setMeta(key, (e.target as HTMLInputElement).value);
        this.schedule();
      });
    }
    bindSwitch("edColophon", (c) => {
      this.store.setMeta("genColophon", c);
      this.renderPreview();
    });
    bindSegmented("citationStyle", (v) => {
      this.store.setSetting("citationStyle", v as "author-date" | "numeric");
      this.renderPreview();
    });
    byId("addRef").onclick = () => {
      const refs = [...this.store.state.references, { key: `rif${this.store.state.references.length + 1}`, author: "", title: "", year: "", publisher: "" }];
      this.store.setReferences(refs);
      this.renderReferences();
      this.renderPreview();
    };
    this.renderReferences();
  }

  renderReferences() {
    const host = document.getElementById("refList");
    if (!host) return;
    const refs = this.store.state.references;
    if (!refs.length) {
      host.innerHTML = `<p class="help" style="margin:0 0 4px">Nessun riferimento. Aggiungine uno per creare la bibliografia.</p>`;
      return;
    }
    host.innerHTML = refs
      .map(
        (r, i) => `<div class="ref-card" data-i="${i}">
          <div class="ref-card-head">
            <span class="ref-key">[@${escapeHtml(r.key || "chiave")}]</span>
            <button class="icon-btn ref-del" data-del="${i}" data-tip="Rimuovi">${icon("delete", "sm")}</button>
          </div>
          <input class="ref-in" data-f="key" data-i="${i}" value="${escapeHtml(r.key)}" placeholder="chiave">
          <input class="ref-in" data-f="author" data-i="${i}" value="${escapeHtml(r.author)}" placeholder="Autore (Cognome, Nome)">
          <input class="ref-in" data-f="title" data-i="${i}" value="${escapeHtml(r.title)}" placeholder="Titolo">
          <div class="grid-2">
            <input class="ref-in" data-f="year" data-i="${i}" value="${escapeHtml(r.year)}" placeholder="Anno">
            <input class="ref-in" data-f="publisher" data-i="${i}" value="${escapeHtml(r.publisher)}" placeholder="Editore">
          </div>
        </div>`
      )
      .join("");
    host.querySelectorAll<HTMLInputElement>(".ref-in").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.dataset.i);
        const f = inp.dataset.f as keyof Reference;
        const refs2 = this.store.state.references.map((r, idx) => (idx === i ? { ...r, [f]: inp.value } : r));
        this.store.setReferences(refs2);
        if (f === "key") {
          const keyEl = host.querySelector(`.ref-card[data-i="${i}"] .ref-key`);
          if (keyEl) keyEl.textContent = `[@${inp.value || "chiave"}]`;
        }
        this.schedule();
      });
    });
    host.querySelectorAll<HTMLElement>("[data-del]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.del);
        this.store.setReferences(this.store.state.references.filter((_, idx) => idx !== i));
        this.renderReferences();
        this.renderPreview();
      };
    });
  }

  /* ---- panel: AI tools ---- */
  sectionHead(ic: string, title: string, kind: "local" | "remote"): string {
    const badge =
      kind === "local"
        ? `<span class="badge badge--local">${icon("bolt", "xs")}Locale</span>`
        : `<span class="badge badge--remote">${icon("cloud", "xs")}Servizio esterno</span>`;
    return `<div class="ai-head"><h3>${icon(ic, "sm")} ${title}</h3>${badge}</div>`;
  }

  panelAI(): string {
    return `
      <div class="section ai-tabs-head">
        ${segmented(
          "aiTab",
          [
            ["detect", "Rileva", "policy"],
            ["orig", "Originalità", "verified"],
            ["rewrite", "Riscrivi", "auto_fix_high"],
            ["para", "Riformula", "shuffle"],
          ],
          "detect"
        )}
      </div>
      <div id="aiPane-detect" class="ai-pane">
        ${this.sectionHead("policy", "Rilevatore AI · Umano vs AI", "local")}
        <p class="intro">Stima <b>euristica locale</b> (stilometria): nessun modello esterno, 100% offline. Indicativa, non probatoria.</p>
        <div class="card">
          <button class="btn btn--filled" id="aiAnalyze" style="width:100%">${icon("frame_inspect")}Analizza il testo</button>
          <div id="aiResult"></div>
        </div>
      </div>
      <div id="aiPane-orig" class="ai-pane" hidden>
        ${this.sectionHead("verified", "Verifica di originalità", "local")}
        <p class="intro">Confronta il documento con gli altri testi salvati <b>su questo dispositivo</b>: cerca frammenti di almeno
          8 parole in comune. Nessun testo lascia mai il dispositivo.</p>
        <div class="card">
          <button class="btn btn--filled" id="origScan" style="width:100%">${icon("fact_check")}Confronta con la libreria</button>
          <div id="origResult"></div>
        </div>
        <div class="card">
          <div class="field"><label>Testo di riferimento da confrontare (facoltativo)</label>
            <textarea id="origRef" rows="4" spellcheck="false" placeholder="Incolla qui una fonte o una bozza precedente da confrontare…"></textarea>
          </div>
          <button class="btn btn--outlined" id="origScanRef" style="width:100%">${icon("compare")}Confronta anche con questo testo</button>
        </div>
      </div>
      <div id="aiPane-rewrite" class="ai-pane" hidden>
        ${this.sectionHead("auto_fix_high", "Riscrittore", "local")}
        <p class="intro">Riscrittura <b>locale basata su regole</b>: rimuove i cliché da LLM, varia il ritmo, semplifica o formalizza. Offline.</p>
        <div class="card">
          ${segmented("aiMode", [["humanize", "Umanizza"], ["simplify", "Semplifica"], ["formal", "Formale"]], "humanize")}
          <div style="height:14px"></div>
          <button class="btn btn--filled" id="aiRewrite" style="width:100%">${icon("autorenew")}Riscrivi il testo</button>
          <div id="aiRewriteWrap" style="display:none">
            <div class="field"><label>Risultato</label><textarea id="aiRewriteOut" rows="8" spellcheck="false"></textarea></div>
            <div style="display:flex;gap:8px">
              <button class="btn btn--tonal btn--sm" id="aiApply">${icon("check")}Applica al documento</button>
              <button class="btn btn--text btn--sm" id="aiCopy">${icon("content_copy")}Copia</button>
            </div>
          </div>
        </div>
      </div>
      <div id="aiPane-para" class="ai-pane" hidden>
        ${this.sectionHead("shuffle", "Riformulatore", "local")}
        <p class="intro">Motore <b>proprietario e locale</b> (nessuna rete, nessun servizio esterno): varia lessico e sintassi mantenendo
          invariati numeri, citazioni, nomi propri e link. Non è uno strumento per falsificare l'autorialità di un testo: usalo solo
          su contenuti propri e nel rispetto dei regolamenti scolastici, professionali o contrattuali applicabili.</p>
        <div class="card">
          ${sliderRow("Varietà lessicale (sinonimi)", "paraLex", 0, 100, 5, 50, "%")}
          ${sliderRow("Varietà strutturale (connettivi, ordine, ritmo)", "paraStruct", 0, 100, 5, 50, "%")}
          <div class="field">
            <label>Termini da non toccare (nomi, sigle, glossario tecnico)</label>
            <input type="text" id="paraGlossary" placeholder="es. Typographus, HWID, Nexflamma (separati da virgola)">
          </div>
          <button class="btn btn--filled" id="paraRun" style="width:100%;margin-top:14px">${icon("auto_awesome")}Riformula il testo</button>
          <div id="paraWrap" style="display:none">
            <div class="field"><label>Risultato</label><textarea id="paraOut" rows="8" spellcheck="false"></textarea></div>
            <div id="paraMeta"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn--tonal btn--sm" id="paraApply">${icon("check")}Applica al documento</button>
              <button class="btn btn--outlined btn--sm" id="paraAgain">${icon("refresh")}Un'altra variante</button>
              <button class="btn btn--text btn--sm" id="paraCopy">${icon("content_copy")}Copia</button>
            </div>
          </div>
        </div>
      </div>`;
  }
  bindAI() {
    /* ---- schede: un solo strumento visibile alla volta ---- */
    const AI_TABS = ["detect", "orig", "rewrite", "para"];
    bindSegmented("aiTab", (v) => {
      AI_TABS.forEach((t) => (byId(`aiPane-${t}`).hidden = t !== v));
    });

    /* ---- verifica di originalità (locale: shingling + Jaccard, [[typographus-architecture]]) ---- */
    const origResult = byId("origResult");
    const renderOriginality = (report: ReturnType<typeof checkOriginality>) => {
      if (!report.reliable) {
        origResult.innerHTML = `<div class="ai-note">${icon("info", "sm")}<span>Testo troppo breve per un confronto affidabile.</span></div>`;
        return;
      }
      if (!report.matches.length) {
        origResult.innerHTML = `<div class="ai-verdict ok">${icon("check_circle", "sm")}<span>Nessuna sovrapposizione rilevante trovata (${report.comparedAgainst} testi confrontati). Originalità stimata <b>${report.originality}%</b>.</span></div>`;
        return;
      }
      origResult.innerHTML = `
        <div class="ai-verdict ${report.originality < 70 ? "warn" : "ok"}">${icon(report.originality < 70 ? "report" : "check_circle", "sm")}<span>Originalità stimata <b>${report.originality}%</b> su ${report.comparedAgainst} testi confrontati.</span></div>
        <div class="ai-signals">
          ${report.matches
            .slice(0, 5)
            .map(
              (m) => `<div class="ai-sig">
                <div class="ai-sig-top"><span>${escapeHtml(m.title)}</span><b>${m.similarity}%</b></div>
                <div class="ai-sig-bar"><i style="width:${m.similarity}%"></i></div>
                ${m.samples.length ? `<span class="ai-sig-d">Frammento in comune: “${escapeHtml(m.samples[0])}…”</span>` : ""}
              </div>`
            )
            .join("")}
        </div>`;
    };
    byId("origScan").onclick = () => {
      const current = toPlainText(this.store.state.source);
      const corpus = listLibrary()
        .filter((d) => d.id !== this.store.state.id)
        .map((d) => ({ id: d.id, title: d.title || "Senza titolo", text: toPlainText(d.source) }));
      renderOriginality(checkOriginality(current, corpus));
    };
    byId("origScanRef").onclick = () => {
      const refText = byId<HTMLTextAreaElement>("origRef").value;
      if (!refText.trim()) {
        snackbar("Incolla prima un testo di riferimento.");
        return;
      }
      const current = toPlainText(this.store.state.source);
      const corpus = [
        { id: "__ref__", title: "Testo di riferimento incollato", text: refText },
        ...listLibrary()
          .filter((d) => d.id !== this.store.state.id)
          .map((d) => ({ id: d.id, title: d.title || "Senza titolo", text: toPlainText(d.source) })),
      ];
      renderOriginality(checkOriginality(current, corpus));
    };

    byId("aiAnalyze").onclick = () => {
      const res = detectAI(toPlainText(this.store.state.source), this.prefs.language);
      const host = byId("aiResult");
      if (!res.reliable) {
        host.innerHTML = `<div class="ai-note">${icon("info", "sm")}<span>${res.verdict}</span></div>`;
        return;
      }
      host.innerHTML = `
        <div class="ai-split" data-tip="${res.words} parole analizzate">
          <div class="ai-human" style="width:${res.humanScore}%"></div>
          <div class="ai-ai" style="width:${res.aiScore}%"></div>
        </div>
        <div class="ai-legend">
          <span><i class="dot human"></i>Umano <b>${res.humanScore}%</b></span>
          <span><i class="dot ai"></i>AI <b>${res.aiScore}%</b></span>
        </div>
        <div class="ai-verdict ${res.aiScore >= 45 ? "warn" : "ok"}">${icon(res.aiScore >= 45 ? "smart_toy" : "person", "sm")}<span>${res.verdict}</span></div>
        <div class="ai-signals">
          ${res.signals
            .map(
              (s) => `<div class="ai-sig">
                <div class="ai-sig-top"><span>${s.label}</span><b>${s.value}</b></div>
                <div class="ai-sig-bar"><i style="width:${s.value}%"></i></div>
                <span class="ai-sig-d">${escapeHtml(s.detail)}</span>
              </div>`
            )
            .join("")}
        </div>`;
    };

    let mode: RewriteMode = "humanize";
    bindSegmented("aiMode", (v) => (mode = v as RewriteMode));
    byId("aiRewrite").onclick = () => {
      const out = rewrite(this.store.state.source, mode, this.prefs.language);
      byId("aiRewriteWrap").style.display = "block";
      byId<HTMLTextAreaElement>("aiRewriteOut").value = out;
    };
    byId("aiApply").onclick = () => {
      const out = byId<HTMLTextAreaElement>("aiRewriteOut").value;
      if (!out.trim()) return;
      this.commitSource(out);
      snackbar("Testo riscritto applicato al documento.");
    };
    byId("aiCopy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(byId<HTMLTextAreaElement>("aiRewriteOut").value);
        snackbar("Copiato negli appunti.");
      } catch {
        snackbar("Copia non riuscita.");
      }
    };

    /* ---- riformulatore (motore proprietario src/paraphraser.ts) ---- */
    const lexInput = byId<HTMLInputElement>("paraLex");
    const structInput = byId<HTMLInputElement>("paraStruct");
    lexInput.oninput = () => (byId("paraLex-v").textContent = `${lexInput.value}%`);
    structInput.oninput = () => (byId("paraStruct-v").textContent = `${structInput.value}%`);

    const runParaphrase = (seed?: number) => {
      const glossary = byId<HTMLInputElement>("paraGlossary").value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = paraphrase(this.store.state.source, {
        lexicalIntensity: Number(lexInput.value) / 100,
        structuralIntensity: Number(structInput.value) / 100,
        lang: this.prefs.language,
        protectTerms: glossary,
        seed,
      });
      byId("paraWrap").style.display = "block";
      byId<HTMLTextAreaElement>("paraOut").value = res.text;
      const simPct = Math.round(res.similarity * 100);
      const changedPct = Math.round(res.changedRatio * 100);
      byId("paraMeta").innerHTML = `
        <div class="ai-sig">
          <div class="ai-sig-top"><span>Somiglianza col testo originale</span><b>${simPct}%</b></div>
          <div class="ai-sig-bar"><i style="width:${simPct}%"></i></div>
          <span class="ai-sig-d">Sovrapposizione delle parole di contenuto (nomi, numeri e citazioni sempre esclusi da qualunque modifica).</span>
        </div>
        <div class="ai-sig">
          <div class="ai-sig-top"><span>Parole e connettivi variati</span><b>${changedPct}%</b></div>
          <div class="ai-sig-bar"><i style="width:${changedPct}%"></i></div>
        </div>
        ${
          res.warnings.length
            ? `<div class="ai-note">${icon("warning", "sm")}<span>${escapeHtml(res.warnings.join(" "))}</span></div>`
            : ""
        }`;
      return res;
    };

    byId("paraRun").onclick = () => runParaphrase();
    byId("paraAgain").onclick = () => runParaphrase(Date.now());
    byId("paraApply").onclick = () => {
      const out = byId<HTMLTextAreaElement>("paraOut").value;
      if (!out.trim()) return;
      this.commitSource(out);
      snackbar("Testo riformulato applicato al documento.");
    };
    byId("paraCopy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(byId<HTMLTextAreaElement>("paraOut").value);
        snackbar("Copiato negli appunti.");
      } catch {
        snackbar("Copia non riuscita.");
      }
    };
  }

  /* ---- panel: review (metrics + linter) ---- */
  panelReview(): string {
    return `
      <div class="section">
        <h3>${icon("speed", "sm")} Leggibilità</h3>
        <div id="readability"></div>
      </div>
      <div class="section">
        <h3>${icon("functions", "sm")} Statistiche del testo</h3>
        <div class="metric-grid" id="stats"></div>
      </div>
      <div class="section">
        <h3>${icon("straighten", "sm")} Copyfitting</h3>
        <div class="stack">
          ${fieldNumber("Obiettivo parole", "targetWords", this.s.targetWords, 50, 20000, 50)}
          <div id="copyfit"></div>
        </div>
      </div>
      <div class="section">
        <h3>${icon("spellcheck", "sm")} Stile redazionale</h3>
        <div id="lintList"></div>
      </div>`;
  }
  bindReview() {
    bindNumber("targetWords", (n) => {
      this.store.setSetting("targetWords", n);
      this.updateReviewReadouts();
    });
    this.updateReviewReadouts();
  }

  updateReviewReadouts() {
    this.updateDocQuick();
    if (this.tool !== "review") return;
    const plain = toPlainText(this.store.state.source);
    const a = analyze(plain, this.prefs.language);
    this.renderReadability(a);
    this.renderStats(a);
    this.renderCopyfit(a);
    this.renderLint();
  }

  renderReadability(a: Analysis) {
    const host = document.getElementById("readability");
    if (!host) return;
    host.innerHTML = `
      <div class="gauge">
        ${gaugeSvg(a.gulpease, 100)}
        <div class="meta">
          <b>Gulpease ${a.gulpease} · ${a.gulpeaseLabel}</b>
          <span>${a.gulpeaseAudience}</span>
          <span style="margin-top:4px;display:block">Flesch ${a.flesch} — ${a.fleschLabel}</span>
        </div>
      </div>`;
  }
  renderStats(a: Analysis) {
    const host = document.getElementById("stats");
    if (!host) return;
    host.innerHTML = `
      ${tile(a.words.toLocaleString("it"), "Parole")}
      ${tile(a.characters.toLocaleString("it"), "Caratteri")}
      ${tile(String(a.sentences), "Frasi")}
      ${tile(String(a.paragraphs), "Paragrafi")}
      ${tile(String(a.avgWordsPerSentence), "Parole / frase")}
      ${tile(String(a.avgCharsPerWord), "Lettere / parola")}
      ${tile(fmtMin(a.readingMin), "Lettura")}
      ${tile(fmtMin(a.speakingMin), "A voce")}`;
  }
  renderCopyfit(a: Analysis) {
    const host = document.getElementById("copyfit");
    if (!host) return;
    const target = this.s.targetWords;
    const pct = Math.min(150, Math.round((a.words / target) * 100));
    const delta = a.words - target;
    const est = estimateExtent(a.charactersAll, this.s);
    const over = delta > 0;
    const color = Math.abs(delta) <= target * 0.05 ? "var(--md-success)" : over ? "var(--md-error)" : "var(--md-warning)";
    host.innerHTML = `
      <div class="metric span-2" style="grid-column:auto">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="k" style="margin:0">${a.words} / ${target} parole</span>
          <b style="color:${color};font:600 14px/1 var(--md-font-plain)">${over ? "+" : ""}${delta}</b>
        </div>
        <div class="progress" style="margin-top:8px"><i style="width:${Math.min(100, pct)}%;background:${color}"></i></div>
        <p class="help" style="margin-top:8px">
          Spazio stimato: <b>${est.estPages}</b> pagine · ${est.charsPerLine} car./riga · ${est.linesPerPage} righe/pagina.
          ${over ? "Tagliare" : "Aggiungere"} ~${Math.abs(delta)} parole per centrare l'obiettivo.
        </p>
      </div>`;
  }
  renderLint() {
    const host = document.getElementById("lintList");
    if (!host) return;
    const issues = lint(this.store.state.source);
    if (!issues.length) {
      host.innerHTML = `<div class="empty-state">${icon("verified")}<b>Nessun rilievo di stile</b><span class="help">Il testo rispetta le regole tipografiche.</span></div>`;
      return;
    }
    host.innerHTML =
      issues
        .map(
          (it) => `<div class="lint-item ${it.severity}">
            ${icon(it.severity === "warn" ? "report" : "info", "sm")}
            <div class="lt"><b>${it.title}</b><span>${escapeHtml(it.detail)}</span></div>
            ${it.fix ? `<button class="btn btn--text btn--sm count" data-fix="${it.id}">Correggi</button>` : `<span class="badge badge--neutral count">${it.count}</span>`}
          </div>`
        )
        .join("") +
      `<button class="btn btn--tonal" id="fixAll" style="width:100%;margin-top:4px">${icon("auto_fix_high")}Applica tipografia intelligente</button>`;

    host.querySelectorAll<HTMLElement>("[data-fix]").forEach((b) => {
      b.onclick = () => this.applyFix(b.dataset.fix!);
    });
    const fixAll = document.getElementById("fixAll");
    if (fixAll) fixAll.onclick = () => this.applyAllFixes();
  }
  applyFix(id: string) {
    const issue = lint(this.store.state.source).find((i) => i.id === id);
    if (!issue?.fix) return;
    const fixed = issue.fix(this.store.state.source);
    this.commitSource(fixed);
    snackbar(`Corretto: ${issue.title.toLowerCase()}.`);
  }
  applyAllFixes() {
    let src = this.store.state.source;
    for (const issue of lint(src)) if (issue.fix) src = issue.fix(src);
    this.commitSource(src);
    snackbar("Tipografia intelligente applicata a tutto il testo.");
  }
  commitSource(src: string) {
    this.store.set({ source: src });
    byId<HTMLTextAreaElement>("editor").value = src;
    this.renderPreview();
    this.updateReviewReadouts();
  }

  /* ---- panel: export ---- */
  panelExport(): string {
    const s = this.s;
    return `
      <div class="section">
        <h3>${icon("picture_as_pdf", "sm")} PDF pronto per la stampa</h3>
        <div class="stack">
          ${fieldSelect(
            "Profilo colore ICC",
            "icc",
            [
              ["ISO Coated v2 (ECI) — FOGRA39", "ISO Coated v2 — FOGRA39"],
              ["PSO Uncoated ISO12647 — FOGRA47", "PSO Uncoated — FOGRA47"],
              ["US Web Coated (SWOP) v2", "US Web Coated (SWOP)"],
              ["Japan Color 2001 Coated", "Japan Color 2001"],
            ],
            s.iccProfile
          )}
          <div class="swatches">
            <div class="swatch" style="background:#22b2e6"><span>C</span></div>
            <div class="swatch" style="background:#e6308a"><span>M</span></div>
            <div class="swatch" style="background:#ffec3d"><span>Y</span></div>
            <div class="swatch" style="background:#222"><span>K</span></div>
          </div>
          <div class="opt-row" style="padding-top:0"><div class="opt-label"><b>Spazio colore</b><span>CMYK · ${s.bleed} mm bleed · ${s.marks ? "crocini attivi" : "senza crocini"}</span></div></div>
          ${switchRow("Anteprima separazione CMYK", "Simula la resa di stampa", "cmykExp", s.cmykPreview)}
          <button class="btn btn--filled" id="pdfBtn" style="width:100%">${icon("print")}Genera PDF di stampa</button>
          <p class="help">Apre la stampa di sistema in modalità impaginata: scegli "Salva come PDF". I crocini e l'abbondanza sono inclusi.</p>
        </div>
      </div>
      <div class="section">
        <h3>${icon("menu_book", "sm")} ePub 3 (e-book)</h3>
        <div class="stack">
          <p class="help">ePub re-flowable validato (XHTML pulito, nav EPUB3 + NCX, metadati Dublin Core).</p>
          <button class="btn btn--tonal" id="epubBtn" style="width:100%">${icon("download")}Esporta ePub</button>
        </div>
      </div>
      <div class="section">
        <h3>${icon("html", "sm")} HTML</h3>
        <button class="btn btn--outlined" id="htmlBtn" style="width:100%">${icon("download")}Esporta HTML autonomo</button>
      </div>
      <div class="section">
        <h3>${icon("functions", "sm")} LaTeX &amp; Typst</h3>
        <div class="stack">
          <p class="help">Conversione best-effort del sorgente Markdown: titoli, elenchi, note, citazioni <code>[@chiave]</code> e formule
            <code>$…$</code>/<code>$$…$$</code>. Tabelle e stili di testo complessi restano testo semplice — rivedi il risultato.</p>
          <button class="btn btn--tonal" id="latexZipBtn" style="width:100%">${icon("download")}Scarica progetto LaTeX (.zip, per Overleaf)</button>
          <button class="btn btn--filled" id="overleafBtn" style="width:100%">${icon("open_in_new")}Apri in Overleaf</button>
          <button class="btn btn--outlined" id="typstBtn" style="width:100%">${icon("download")}Scarica sorgente Typst (.typ)</button>
          <div id="typstCompileWrap"></div>
        </div>
      </div>
      <div class="section">
        <h3>${icon("cloud_upload", "sm")} Condividi e Pubblica</h3>
        <div class="stack">
          <p class="help">Pubblica temporaneamente il documento standalone online per condividerlo o leggerlo nel browser.</p>
          <button class="btn btn--tonal" id="shareBtn" style="width:100%">${icon("share")}Pubblica online</button>
          <div id="shareResult" style="display:none;margin-top:10px;flex-direction:column;gap:8px" class="stack">
            <div style="display:flex;gap:6px">
              <input id="shareLink" type="text" readonly style="flex:1;background:var(--md-surface-container-high);border:1px solid var(--hairline);border-radius:var(--r-sm);padding:6px;font-size:12px;color:var(--md-on-surface)">
              <button class="btn btn--filled btn--sm" id="copyShareBtn" style="padding:0 8px;height:28px">${icon("content_copy", "sm")}</button>
            </div>
            <p class="help" style="color:var(--accent);font-weight:600;margin:0">Il link è pronto! Chiunque lo scaricherà vedrà il tuo impaginato.</p>
          </div>
        </div>
      </div>
      <div class="section">
        <h3>${icon("public", "sm")} Pubblica su WordPress</h3>
        <div class="stack">
          <p class="help">Usa l'API ufficiale di WordPress con una <b>Password Applicazione</b> (Utenti → Il tuo profilo → Password
            applicazioni, nel pannello wp-admin del sito) — non la tua password reale, revocabile in ogni momento.</p>
          <div class="field"><label>Indirizzo del sito</label><input type="text" id="wpSite" placeholder="https://www.iltuogiornale.it"></div>
          <div class="grid-2">
            <div class="field"><label>Utente</label><input type="text" id="wpUser" placeholder="nomeutente"></div>
            <div class="field"><label>Password applicazione</label><input type="password" id="wpPass" placeholder="xxxx xxxx xxxx xxxx" autocomplete="off"></div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn--outlined btn--sm" id="wpSave">${icon("key")}Salva credenziali</button>
            <button class="btn btn--text btn--sm" id="wpCheck">${icon("wifi_tethering")}Verifica sito</button>
          </div>
          <div id="wpCheckResult"></div>
          ${segmented("wpStatus", [["draft", "Come bozza"], ["publish", "Pubblica subito"]], "draft")}
          <button class="btn btn--filled" id="wpPublishBtn" style="width:100%">${icon("cloud_upload")}Invia a WordPress</button>
          <div id="wpPublishResult"></div>
        </div>
      </div>
      <div class="section">
        <h3>${icon("toc", "sm")} Indice generale</h3>
        <div id="tocPreview"></div>
      </div>`;
  }
  bindExport() {
    bindSelect("icc", (v) => this.store.setSetting("iccProfile", v));
    bindSwitch("cmykExp", (c) => {
      this.store.setSetting("cmykPreview", c);
      const el = byId("cmykQuick");
      if (el) el.classList.toggle("is-active", c);
      this.updateCmyk();
    });
    byId("pdfBtn").onclick = async () => {
      if (this.view !== "paged") {
        this.view = "paged";
        bindSegmentedActive("viewSeg", "paged");
        await this.renderPreview();
      }
      snackbar('Nella finestra di stampa scegli "Salva come PDF".');
      setTimeout(() => printDocument(), 400);
    };
    byId("epubBtn").onclick = async () => {
      try {
        const compiled = this.compileDoc();
        const blob = await exportEpub(this.store.state, compiled.html);
        downloadBlob(blob, `${slugFile(this.store.state.title)}.epub`);
        snackbar("ePub esportato.");
      } catch (err) {
        snackbar(`ePub non riuscito: ${(err as Error).message}`);
      }
    };
    byId("htmlBtn").onclick = () => {
      const compiled = this.compileDoc();
      const html = buildStandaloneHtml(this.store.state, compiled.html);
      downloadBlob(new Blob([html], { type: "text/html" }), `${slugFile(this.store.state.title)}.html`);
      snackbar("HTML esportato.");
    };

    const slugName = () => slugForExport(this.store.state.title);

    byId("latexZipBtn").onclick = async () => {
      const { tex, bib } = toLatex(this.store.state);
      const zip = new JSZip();
      zip.file("main.tex", tex);
      if (bib.trim()) zip.file(`${slugName()}.bib`, bib);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${slugName()}-latex.zip`);
      snackbar("Progetto LaTeX esportato. Su Overleaf: Nuovo progetto → Carica progetto.");
    };

    byId("typstBtn").onclick = () => {
      const typ = toTypst(this.store.state);
      downloadBlob(new Blob([typ], { type: "text/plain" }), `${slugName()}.typ`);
      snackbar("Sorgente Typst esportato.");
    };

    /* ---- compile with Typst (real compiler, downloaded on demand) ---- */
    const typstWrap = byId("typstCompileWrap");
    const renderTypstWrap = (installed: boolean, downloadable: boolean) => {
      if (installed) {
        typstWrap.innerHTML = `<button class="btn btn--filled" id="typstCompileBtn" style="width:100%;margin-top:8px">${icon("bolt")}Compila con Typst → PDF</button>
          <div id="typstCompileResult"></div>`;
        byId("typstCompileBtn").onclick = async () => {
          const btn = byId<HTMLButtonElement>("typstCompileBtn");
          btn.disabled = true;
          const resHost = byId("typstCompileResult");
          resHost.innerHTML = `<div class="ai-note">${icon("progress_activity", "sm")}<span>Compilazione in corso…</span></div>`;
          try {
            const src = toTypst(this.store.state);
            const res = await desktop!.typst!.compile(src);
            if (!res.ok || !res.pdfBase64) {
              resHost.innerHTML = `<div class="ai-note">${icon("error", "sm")}<span>${escapeHtml(res.error || "Compilazione non riuscita.")}</span></div>`;
              return;
            }
            const bytes = Uint8Array.from(atob(res.pdfBase64), (c) => c.charCodeAt(0));
            downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${slugName()}.pdf`);
            resHost.innerHTML = "";
            snackbar("PDF compilato con Typst.");
          } finally {
            btn.disabled = false;
          }
        };
      } else if (downloadable) {
        typstWrap.innerHTML = `<button class="btn btn--outlined" id="typstDownloadBtn" style="width:100%;margin-top:8px">${icon("cloud_download")}Scarica il compilatore Typst (~15 MB, una tantum)</button>
          <p class="help">Da <code>github.com/typst/typst</code>, il binario ufficiale — nessun servizio terzo. Necessario per compilare
            direttamente in PDF; senza, puoi comunque scaricare il sorgente <code>.typ</code> sopra e compilarlo altrove.</p>`;
        byId("typstDownloadBtn").onclick = async () => {
          const btn = byId<HTMLButtonElement>("typstDownloadBtn");
          btn.disabled = true;
          btn.innerHTML = `${icon("sync")}Download in corso…`;
          const r = await desktop!.typst!.download();
          if (r.ok) {
            snackbar("Typst installato.");
            renderTypstWrap(true, true);
          } else {
            snackbar(r.error || "Download non riuscito.");
            btn.disabled = false;
            btn.innerHTML = `${icon("cloud_download")}Scarica il compilatore Typst (~15 MB, una tantum)`;
          }
        };
      } else {
        typstWrap.innerHTML = "";
      }
    };
    if (desktop?.typst) {
      desktop.typst.status().then((s) => renderTypstWrap(s.installed, !!s.downloadable));
    }

    byId("overleafBtn").onclick = () => {
      const { tex, bib } = toLatex(this.store.state);
      const files: [string, string][] = [["main.tex", tex]];
      if (bib.trim()) files.push([`${slugName()}.bib`, bib]);
      const form = document.createElement("form");
      form.action = "https://www.overleaf.com/docs";
      form.method = "POST";
      form.target = "_blank";
      for (const [name, content] of files) {
        const fInput = document.createElement("input");
        fInput.type = "hidden";
        fInput.name = "snip[]";
        fInput.value = content;
        form.appendChild(fInput);
        const nInput = document.createElement("input");
        nInput.type = "hidden";
        nInput.name = "snip_name[]";
        nInput.value = name;
        form.appendChild(nInput);
      }
      document.body.appendChild(form);
      form.submit();
      form.remove();
      snackbar("Apertura in Overleaf…");
    };

    /* ---- WordPress publish connector ---- */
    const wpResult = byId("wpCheckResult");
    const wpPubResult = byId("wpPublishResult");
    const wpAvailable = !!desktop?.wordpress;
    if (!wpAvailable) {
      wpResult.innerHTML = `<div class="ai-note">${icon("info", "sm")}<span>Disponibile solo nell'app desktop Typographus.</span></div>`;
      (byId<HTMLButtonElement>("wpSave")).disabled = true;
      (byId<HTMLButtonElement>("wpCheck")).disabled = true;
      (byId<HTMLButtonElement>("wpPublishBtn")).disabled = true;
    } else {
      let wpStatus: "draft" | "publish" = "draft";
      bindSegmented("wpStatus", (v) => (wpStatus = v as "draft" | "publish"));

      byId("wpSave").onclick = async () => {
        const site = byId<HTMLInputElement>("wpSite").value.trim();
        const user = byId<HTMLInputElement>("wpUser").value.trim();
        const pw = byId<HTMLInputElement>("wpPass").value.trim();
        if (!site || !user || !pw) {
          snackbar("Compila sito, utente e password applicazione.");
          return;
        }
        const r = await desktop!.wordpress!.saveCredentials(site, user, pw);
        snackbar(r.ok ? "Credenziali salvate." : "Impossibile salvare le credenziali.");
        if (r.ok) byId<HTMLInputElement>("wpPass").value = "";
      };

      byId("wpCheck").onclick = async () => {
        wpResult.innerHTML = `<div class="ai-note">${icon("progress_activity", "sm")}<span>Verifica in corso…</span></div>`;
        const r = await desktop!.wordpress!.checkSite();
        wpResult.innerHTML = r.ok
          ? `<div class="ai-verdict ok">${icon("check_circle", "sm")}<span>Raggiunto: <b>${escapeHtml(r.siteName || "")}</b>. È WordPress con l'API REST attiva.</span></div>`
          : `<div class="ai-note">${icon("error", "sm")}<span>${escapeHtml(r.error || "Verifica non riuscita.")}</span></div>`;
      };

      byId("wpPublishBtn").onclick = async () => {
        const btn = byId<HTMLButtonElement>("wpPublishBtn");
        btn.disabled = true;
        wpPubResult.innerHTML = `<div class="ai-note">${icon("progress_activity", "sm")}<span>Invio in corso…</span></div>`;
        try {
          const compiled = this.compileDoc();
          const title = this.store.state.front.headline || this.store.state.title || "Senza titolo";
          const res = await desktop!.wordpress!.publish(title, compiled.html, wpStatus);
          wpPubResult.innerHTML = res.ok
            ? `<div class="ai-verdict ok">${icon("check_circle", "sm")}<span>Inviato${res.link ? ` — <a href="${escapeHtml(res.link)}" target="_blank" rel="noopener">apri</a>` : ""}.</span></div>`
            : `<div class="ai-note">${icon("error", "sm")}<span>${escapeHtml(res.error || "Pubblicazione non riuscita.")}</span></div>`;
        } finally {
          btn.disabled = false;
        }
      };
    }

    byId("shareBtn").onclick = async () => {
      const btn = byId("shareBtn") as HTMLButtonElement;
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `${icon("sync")} Caricamento...`;
      try {
        const compiled = this.compileDoc();
        const html = buildStandaloneHtml(this.store.state, compiled.html);
        const blob = new Blob([html], { type: "text/html" });
        const formData = new FormData();
        formData.append("file", blob, `${slugFile(this.store.state.title)}.html`);
        const res = await fetch("https://file.io/?expires=1w", {
          method: "POST",
          body: formData
        });
        if (!res.ok) throw new Error("Upload non riuscito");
        const data = await res.json();
        if (data.success && data.link) {
          byId("shareResult").style.display = "flex";
          byId<HTMLInputElement>("shareLink").value = data.link;
          snackbar("Pubblicato online con successo!");
        } else {
          throw new Error(data.message || "Upload fallito");
        }
      } catch (err) {
        snackbar(`Errore durante l'upload: ${(err as Error).message}`);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    };
    
    byId("copyShareBtn").onclick = async () => {
      const link = byId<HTMLInputElement>("shareLink").value;
      if (link) {
        await navigator.clipboard.writeText(link);
        snackbar("Link copiato negli appunti.");
      }
    };

    this.renderTocPreview();
  }
  renderTocPreview() {
    const host = document.getElementById("tocPreview");
    if (!host) return;
    const compiled = this.compileDoc();
    const { toc } = buildToc(compiled.html);
    if (!toc.length) {
      host.innerHTML = `<p class="help">Aggiungi titoli (## ) per generare l'indice automatico.</p>`;
      return;
    }
    host.innerHTML = toc
      .map(
        (t) =>
          `<div style="display:flex;gap:8px;padding:6px 0;${t.level > 2 ? "padding-left:16px;" : ""}border-bottom:1px solid var(--md-outline-variant)">
            ${icon(t.level === 1 ? "article" : "subdirectory_arrow_right", "xs")}
            <span class="t-body-m" style="color:var(--md-on-surface)">${escapeHtml(t.text)}</span>
          </div>`
      )
      .join("");
  }

  /* ============================ HOME ============================ */
  homeScreen(): string {
    const lib = listLibrary();
    const totalDocs = lib.length;
    let totalWords = 0;
    lib.forEach(d => {
      totalWords += analyze(toPlainText(d.source), this.prefs.language).words;
    });

    let activeTemplates: (Template | CommunityTemplate)[] = [];
    let isCommunity = false;

    if (this.homeTab === "registi") {
      activeTemplates = TEMPLATES.filter((t) => ["screenplay", "poetry"].includes(t.id));
    } else if (this.homeTab === "tesisti") {
      activeTemplates = TEMPLATES.filter((t) => ["thesis", "essay", "technical"].includes(t.id));
    } else if (this.homeTab === "editoriali") {
      activeTemplates = TEMPLATES.filter((t) => ["novel", "article", "magazine", "newsletter", "press"].includes(t.id));
    } else if (this.homeTab === "altri") {
      activeTemplates = TEMPLATES.filter((t) => ["blank", "report", "menu", "letter", "brochure", "cv", "recipe"].includes(t.id));
    } else if (this.homeTab === "community") {
      const localComm = getCommunityTemplates();
      const onlineComm = this.onlineTemplates || [];
      const combined = [...localComm];
      for (const t of onlineComm) {
        if (!combined.some((x) => x.id === t.id)) {
          combined.push(t);
        }
      }
      activeTemplates = combined;
      isCommunity = true;
    }

    let currentUserHandle = "@tu";
    if (this.supabaseUser && this.supabaseUser.email) {
      const email = this.supabaseUser.email;
      currentUserHandle = email.startsWith("@") ? email : "@" + email.split("@")[0];
    } else if (this.licenseStatus?.valid && this.licenseStatus?.email) {
      const email = this.licenseStatus.email;
      currentUserHandle = email.startsWith("@") ? email : "@" + email.split("@")[0];
    }

    const tplGridHtml = activeTemplates.map((t) => {
      const authorText = (t as any).author ? `<span class="tpl-author">Caricato da ${(t as any).author}</span>` : "";
      let borderLeft = "";
      if (t.id === "blank") borderLeft = "border-left: 3px solid #b9b9b3;";
      else if (t.id === "article") borderLeft = "border-left: 3px solid var(--accent);";
      else if (t.id === "essay") borderLeft = "border-left: 3px solid #38bdf8;";
      else if (t.id === "magazine") borderLeft = "border-left: 3px solid #e879f9;";
      else if (t.id === "novel") borderLeft = "border-left: 3px solid #34d399;";
      else if (t.id === "cv") borderLeft = "border-left: 3px solid #f5a524;";
      else if (t.id === "report") borderLeft = "border-left: 3px solid #f43f5e;";
      else if (t.id === "technical") borderLeft = "border-left: 3px solid #8b5cf6;";
      else if (t.id === "menu") borderLeft = "border-left: 3px solid #10b981;";
      else if (t.id === "screenplay") borderLeft = "border-left: 3px solid #f59e0b;";
      else if (t.id === "poetry") borderLeft = "border-left: 3px solid #ec4899;";
      else if (t.id.startsWith("comm-") || t.id.startsWith("comm_")) borderLeft = "border-left: 3px solid var(--accent);";

      const isComm = t.id.startsWith("comm-") || t.id.startsWith("comm_");
      const isAuthor = (t as any).author === "@tu" || (t as any).author === currentUserHandle;
      const isAdmin = this.licenseStatus?.plan?.toLowerCase() === "admin" || this.supabaseProfile?.role === "admin";
      const canDelete = isComm && (isAdmin || isAuthor);
      const delBtn = canDelete ? `<button class="tpl-del icon-btn btn--sm" data-del-tpl="${t.id}" data-tip="Rimuovi modello">${icon("delete", "sm")}</button>` : "";

      return `<div class="tpl-card-wrapper">
        <button class="tpl-card" data-tpl="${t.id}" style="${borderLeft}">
          <span class="tpl-ic">${icon(t.icon)}</span>
          <b>${escapeHtml(t.name)}</b>
          <span class="tpl-desc">${escapeHtml(t.desc)}</span>
          ${authorText}
        </button>
        ${delBtn}
      </div>`;
    }).join("");

    let communityHeader = "";
    if (isCommunity) {
      communityHeader = `
        <div class="community-header">
          <p class="help">Modelli creati e condivisi dagli utenti del mondo per registi, tesisti ed editoriali.</p>
        </div>
      `;
    }
    
    return `
    <div class="home">
      <header class="home-hero">
        <div class="home-logo"><img src="${BRAND_ICON}" alt=""></div>
        <div class="home-hero-text">
          <h1>Typographus</h1>
          <p>Motore editoriale e di impaginazione tipografica ad alta precisione.</p>
        </div>
        <div class="home-hero-actions">
          <button class="btn btn--filled" id="homeNewBlank">${icon("add")}Nuovo documento</button>
          <button class="btn btn--tonal" id="homeImport">${icon("upload_file")}Importa file…</button>
        </div>
      </header>

      <div class="home-stats">
        <div class="home-stat-chip">${icon("folder", "sm")} <b>${totalDocs}</b> &nbsp;documenti salvati</div>
        <div class="home-stat-chip">${icon("edit", "sm")} <b>${totalWords.toLocaleString("it")}</b> &nbsp;parole scritte totali</div>
      </div>

      <section class="home-sec">
        <div class="tpl-section-header">
          <h2>${icon("dashboard_customize", "sm")} Modelli di scrittura</h2>
          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
            <div class="tpl-tabs segmented">
              <button class="tab-btn ${this.homeTab === 'registi' ? 'is-active' : ''}" data-tab="registi">${icon("movie", "sm")} <span>Registi</span></button>
              <button class="tab-btn ${this.homeTab === 'tesisti' ? 'is-active' : ''}" data-tab="tesisti">${icon("school", "sm")} <span>Tesisti</span></button>
              <button class="tab-btn ${this.homeTab === 'editoriali' ? 'is-active' : ''}" data-tab="editoriali">${icon("auto_stories", "sm")} <span>Editoriali</span></button>
              <button class="tab-btn ${this.homeTab === 'community' ? 'is-active' : ''}" data-tab="community">${icon("public", "sm")} <span>Mondo</span></button>
              <button class="tab-btn ${this.homeTab === 'altri' ? 'is-active' : ''}" data-tab="altri">${icon("more_horiz", "sm")} <span>Altri</span></button>
            </div>
            <button class="btn btn--tonal btn--sm" id="homePublishTplBtn" data-tip="Crea e pubblica un modello">${icon("cloud_upload")} Pubblica nel Mondo</button>
          </div>
        </div>

        ${communityHeader}

        <div class="tpl-grid">
          ${tplGridHtml || `<div class="empty-state" style="grid-column: 1/-1; border: 1px dashed var(--hairline); padding: 32px; text-align: center; border-radius: var(--r-md);">${icon("folder_open")} <b>Nessun modello condiviso</b></div>`}
        </div>
      </section>

      <section class="home-sec">
        <h2>${icon("history", "sm")} Documenti recenti</h2>
        ${
          lib.length
            ? `<div class="recent-grid">${lib
                .map((d) => {
                  const words = analyze(toPlainText(d.source), this.prefs.language).words;
                  return `<div class="recent-card" data-open="${d.id}">
                    <button class="recent-del icon-btn" data-del="${d.id}" data-tip="Elimina">${icon("delete", "sm")}</button>
                    <div class="recent-thumb">${icon("description")}</div>
                    <div class="recent-meta">
                      <b>${escapeHtml(d.title || "Senza titolo")}</b>
                      <span>${d.settings.pageSize} · ${words.toLocaleString("it")} parole · ${relTime(d.updatedAt)}</span>
                    </div>
                  </div>`;
                })
                .join("")}</div>`
            : `<div class="empty-state" style="border:1px dashed var(--hairline);border-radius:var(--r-lg)">${icon("inbox")}<b>Nessun documento</b><span class="help">Crea un nuovo documento o importane uno.</span></div>`
        }
      </section>

      <footer class="home-foot">
        <span>${COPYRIGHT} · Typographus v${COMPANY.version} · documenti salvati in locale</span>
        <button class="btn btn--text btn--sm" id="homeSettings">${icon("settings", "sm")}Impostazioni</button>
      </footer>
    </div>`;
  }

  bindHome() {
    byId("homeNewBlank").onclick = () => this.newFromTemplate(TEMPLATES[0]);
    byId("homeImport").onclick = () => this.fileInput.click();
    byId("homeSettings").onclick = () => this.goScreen("settings");

    this.screenRoot.querySelectorAll<HTMLElement>(".tpl-tabs button").forEach((btn) => {
      btn.onclick = async () => {
        this.homeTab = btn.dataset.tab!;
        if (this.homeTab === "community") {
          await this.loadOnlineTemplates();
        }
        this.screenRoot.innerHTML = this.homeScreen();
        this.bindHome();
      };
    });

    const homePubBtn = byId("homePublishTplBtn");
    if (homePubBtn) {
      homePubBtn.onclick = () => this.openPublishModal();
    }

    this.screenRoot.querySelectorAll<HTMLElement>(".tpl-card").forEach((c) => {
      c.onclick = () => {
        const tplId = c.dataset.tpl!;
        let t: Template | CommunityTemplate | undefined;
        if (tplId.startsWith("comm-")) {
          t = getCommunityTemplates().find((x) => x.id === tplId) || this.onlineTemplates.find((x) => x.id === tplId);
        } else {
          t = TEMPLATES.find((x) => x.id === tplId);
        }
        if (t) this.newFromTemplate(t);
      };
    });
    this.screenRoot.querySelectorAll<HTMLElement>("[data-del-tpl]").forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const tplId = b.dataset.delTpl!;
        try {
          const { error } = await supabase.from("community_templates").delete().eq("id", tplId);
          if (error) {
            console.error("Errore cancellazione online Supabase:", error);
          }
        } catch (err) {
          console.error(err);
        }
        deleteCommunityTemplate(tplId);
        await this.loadOnlineTemplates();
        this.screenRoot.innerHTML = this.homeScreen();
        this.bindHome();
        snackbar("Modello rimosso.");
      };
    });
    this.screenRoot.querySelectorAll<HTMLElement>(".recent-card").forEach((c) => {
      c.onclick = (e) => {
        if ((e.target as HTMLElement).closest("[data-del]")) return;
        this.openDoc(c.dataset.open!);
      };
    });
    this.screenRoot.querySelectorAll<HTMLElement>("[data-del]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        deleteFromLibrary(b.dataset.del!);
        this.goScreen("home");
        snackbar("Documento eliminato.");
      };
    });
  }

  openPublishModal() {
    const old = document.getElementById("publishScrim");
    if (old) old.remove();

    const lib = listLibrary();
    const docOptionsHtml = lib.map(d => `<option value="${d.id}">${escapeHtml(d.title || "Senza titolo")}</option>`).join("");

    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.id = "publishScrim";
    scrim.innerHTML = `
      <div class="dialog md-help-dialog" role="dialog" aria-modal="true" style="max-width:500px">
        <div class="lic-head">
          <div class="vendor-logo sm" style="background:var(--accent-dim);color:var(--accent)">${icon("public")}</div>
          <div>
            <h2>Pubblica modello nel Mondo</h2>
            <p class="help" style="margin:2px 0 0">Condividi la tua struttura con registi, tesisti ed editoriali.</p>
          </div>
        </div>
        <div class="modal-body stack" style="margin:18px 0">
          <div class="field">
            <label for="pubName">Nome del modello</label>
            <input type="text" id="pubName" placeholder="es. Sceneggiatura Cinema d'Autore">
          </div>
          <div class="field">
            <label for="pubDesc">Descrizione</label>
            <input type="text" id="pubDesc" placeholder="es. Layout a 1 colonna, Courier 12pt, margini ampi…">
          </div>
          <div class="field">
            <label for="pubCategory">Categoria target</label>
            <select id="pubCategory">
              <option value="registi">Registi (Cinema, Teatro, Poesia)</option>
              <option value="tesisti">Tesisti (Accademia, Saggi)</option>
              <option value="editoriali">Editoriali (Libri, Giornali, Riviste)</option>
              <option value="altri">Altri</option>
            </select>
          </div>
          <div class="field">
            <label for="pubIcon">Icona</label>
            <select id="pubIcon">
              <option value="theater_comedy">Teatro (Maschere)</option>
              <option value="movie">Cinema (Ciak)</option>
              <option value="school">Studio (Cappello accademico)</option>
              <option value="auto_stories">Romanzo (Libro aperto)</option>
              <option value="newspaper">Periodico (Giornale)</option>
              <option value="star">Speciale (Stella)</option>
            </select>
          </div>
          <div class="field">
            <label for="pubSourceDoc">Sorgente dati</label>
            <select id="pubSourceDoc">
              <option value="current">Usa documento attualmente aperto</option>
              ${docOptionsHtml}
            </select>
            <p class="help">Il testo di partenza e le impostazioni del layout saranno copiate da questo documento.</p>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn--text" id="pubCancel">Annulla</button>
          <button class="btn btn--filled" id="pubSubmit">${icon("cloud_upload", "sm")} Pubblica nel Mondo</button>
        </div>
      </div>
    `;
    document.body.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add("is-open"));

    const close = () => {
      scrim.classList.remove("is-open");
      setTimeout(() => scrim.remove(), 220);
    };

    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) close();
    });

    byId("pubCancel").onclick = close;
    byId("pubSubmit").onclick = () => {
      const name = byId<HTMLInputElement>("pubName").value.trim();
      const desc = byId<HTMLInputElement>("pubDesc").value.trim();
      const category = byId<HTMLSelectElement>("pubCategory").value;
      const iconName = byId<HTMLSelectElement>("pubIcon").value;
      const sourceDocId = byId<HTMLSelectElement>("pubSourceDoc").value;

      if (!name) {
        snackbar("Attenzione: inserisci un nome per il modello.");
        return;
      }

      let sourceText = "Inizia a scrivere qui…";
      let sourceSettings = {};
      let sourceFront = {};

      if (sourceDocId === "current" && this.store.state) {
        sourceText = this.store.state.source;
        sourceSettings = { ...this.store.state.settings };
        sourceFront = { ...this.store.state.front };
      } else {
        const found = getFromLibrary(sourceDocId);
        if (found) {
          sourceText = found.source;
          sourceSettings = { ...found.settings };
          sourceFront = { ...found.front };
        }
      }

      let author = "@tu";
      if (this.supabaseUser && this.supabaseUser.email) {
        const email = this.supabaseUser.email;
        author = email.startsWith("@") ? email : "@" + email.split("@")[0];
      } else if (this.licenseStatus?.valid && this.licenseStatus?.email) {
        const email = this.licenseStatus.email;
        author = email.startsWith("@") ? email : "@" + email.split("@")[0];
      }

      const newTpl: CommunityTemplate = {
        id: "comm-" + Date.now().toString(36),
        name,
        desc: desc || "Modello condiviso",
        icon: iconName,
        front: sourceFront,
        source: sourceText,
        settings: sourceSettings,
        author
      };

      saveCommunityTemplate(newTpl);
      
      const userId = this.supabaseUser?.id || null;
      supabase
        .from("community_templates")
        .insert([{
          id: newTpl.id,
          name: newTpl.name,
          desc: newTpl.desc,
          icon: newTpl.icon,
          front: newTpl.front,
          source: newTpl.source,
          settings: newTpl.settings,
          author,
          user_id: userId
        }])
        .then(async ({ error }) => {
          if (error) {
            console.error("Errore salvataggio online Supabase:", error);
          } else {
            await this.loadOnlineTemplates();
            if (this.screen === "home" && this.homeTab === "community") {
              this.screenRoot.innerHTML = this.homeScreen();
              this.bindHome();
            }
          }
        });

      close();
      snackbar("Modello condiviso con successo nel Mondo!");

      if (this.screen === "home") {
        this.homeTab = "community";
        this.screenRoot.innerHTML = this.homeScreen();
        this.bindHome();
      }
    };
  }

  /* ============================ SETTINGS ============================ */
  settingsScreen(): string {
    const cats: [string, string, string][] = [
      ["aspetto", "palette", "Aspetto"],
      ["editor", "edit_note", "Editor"],
      ["lingua", "translate", "Lingua"],
      ["nuovi", "note_add", "Nuovi documenti"],
      ["account", "account_circle", "Account Nexflamma"],
      ["licenza", "verified_user", "Licenza"],
      ["info", "info", "Informazioni"],
    ];
    return `
    <div class="settings">
      <div class="settings-inner">
        <button class="btn btn--text settings-back" id="setBack">${icon("arrow_back")}Indietro</button>
        <h1 class="settings-title">Impostazioni</h1>
        <div class="settings-layout">
          <nav class="settings-nav" id="setNav">
            ${cats
              .map(
                ([id, ic, label]) =>
                  `<button class="set-nav-item ${id === this.settingsCat ? "is-active" : ""}" data-cat="${id}">${icon(ic, "sm")}<span>${label}</span></button>`
              )
              .join("")}
          </nav>
          <div class="settings-content" id="setContent"></div>
        </div>
      </div>
    </div>`;
  }

  settingsCatHtml(): string {
    const p = this.prefs;
    switch (this.settingsCat) {
      case "aspetto":
        return `<div class="set-card">
          <h3>${icon("palette", "sm")} Aspetto</h3>
          <div class="opt-row"><div class="opt-label"><b>Tema</b><span>Chiaro o scuro</span></div>
            ${segmented("setTheme", [["light", "Chiaro", "light_mode"], ["dark", "Scuro", "dark_mode"]], p.theme)}</div>
          <div class="opt-row"><div class="opt-label"><b>Colore d'accento</b><span>Tinta dell'interfaccia</span></div>
            <div class="accent-row" id="setAccent">
              ${(Object.keys(ACCENTS) as AccentKey[])
                .map(
                  (k) =>
                    `<button class="accent-sw ${k === p.accent ? "is-sel" : ""}" data-accent="${k}" style="--sw:${ACCENTS[k].hex}" data-tip="${ACCENTS[k].name}"></button>`
                )
                .join("")}
            </div></div>
          <div class="opt-row"><div class="opt-label"><b>Densità</b><span>Spaziatura dell'interfaccia</span></div>
            ${segmented("setDensity", [["cozy", "Comoda"], ["compact", "Compatta"]], p.density)}</div>
        </div>`;
      case "editor":
        return `<div class="set-card">
          <h3>${icon("edit_note", "sm")} Editor</h3>
          ${sliderRow("Dimensione font sorgente", "setEdSize", 11, 18, 0.5, p.editorFontSize, " px")}
          <div class="opt-row"><div class="opt-label"><b>A capo automatico</b><span>Manda a capo le righe lunghe</span></div>
            <label class="switch"><input type="checkbox" id="setWrap" ${p.wordWrap ? "checked" : ""}><span class="track"><span class="thumb"></span></span></label></div>
          <div class="opt-row"><div class="opt-label"><b>Salvataggio automatico</b><span>Salva le modifiche in locale mentre digiti</span></div>
            <label class="switch"><input type="checkbox" id="setAutosave" ${p.autosave ? "checked" : ""}><span class="track"><span class="thumb"></span></span></label></div>
        </div>`;
      case "lingua":
        return `<div class="set-card">
          <h3>${icon("translate", "sm")} Lingua e leggibilità</h3>
          <div class="opt-row"><div class="opt-label"><b>Lingua del testo</b><span>Indici di leggibilità e sillabazione</span></div>
            ${segmented("setLang", [["it", "Italiano"], ["en", "English"]], p.language)}</div>
        </div>`;
      case "nuovi":
        return `<div class="set-card">
          <h3>${icon("note_add", "sm")} Nuovi documenti</h3>
          <p class="help" style="margin:0 0 14px">Valori predefiniti applicati ai documenti creati da zero.</p>
          ${fieldSelect("Formato pagina", "setDefPage", [["A3", "A3"], ["A4", "A4"], ["A5", "A5"], ["Letter", "US Letter"], ["Tabloid", "Tabloid"]], p.defPageSize)}
          ${sliderRow("Corpo del testo", "setDefBody", 8, 14, 0.25, p.defBodySize, " pt")}
          ${sliderRow("Interlinea", "setDefLead", 1.0, 2.0, 0.05, p.defLeading, "×")}
        </div>`;
      case "account":
        if (this.supabaseUser) {
          const email = this.supabaseUser.email;
          const roleLabel = this.supabaseProfile?.role === "admin" ? "Amministratore" : "Utente standard";
          const handle = email.startsWith("@") ? email : "@" + email.split("@")[0];
          return `<div class="set-card">
            <h3>${icon("account_circle", "sm")} Account Nexflamma</h3>
            <div class="lic-stat" style="margin-bottom: 14px;">
              <span class="status-chip" data-status="published">Collegato</span>
              <div class="lic-stat-meta">
                <b>${escapeHtml(email)}</b>
                <span>Ruolo: ${roleLabel}</span>
              </div>
            </div>
            <div class="lg-hwid" style="margin-bottom: 18px;">
              <div><span>Identità Autore</span><b>${escapeHtml(handle)}</b></div>
            </div>
            <p class="help" style="margin-bottom:14px">I tuoi modelli verranno pubblicati a questo nome e potrai cancellarli online con lo stesso account.</p>
            <button class="btn btn--outlined btn--sm" id="btnAccLogout">${icon("logout")} Disconnetti account</button>
          </div>`;
        }
        return `<div class="set-card">
          <h3>${icon("account_circle", "sm")} Accedi a Nexflamma</h3>
          <p class="help" style="margin-bottom:14px">Usa le tue credenziali Nexflamma per connettere l'applicazione e pubblicare i modelli online.</p>
          <div class="stack">
            <div class="field">
              <label for="accEmail">Email</label>
              <input type="email" id="accEmail" placeholder="latuaemail@esempio.com">
            </div>
            <div class="field">
              <label for="accPassword">Password</label>
              <input type="password" id="accPassword" placeholder="••••••••">
            </div>
            <button class="btn btn--filled" id="btnAccLogin" style="margin-top:10px">${icon("login")} Accedi con Nexflamma</button>
            <div class="lg-msg" id="accMsg" style="margin-top:10px"></div>
          </div>
        </div>`;
      case "licenza":
        return `<div class="set-card">
          <h3>${icon("vpn_key", "sm")} Stato licenza</h3>
          <div id="licStatus"><p class="help">Verifica in corso…</p></div>
          <label class="lg-label" style="margin-top:14px">Chiave di licenza</label>
          <textarea id="setLicKey" rows="3" spellcheck="false" placeholder="Incolla qui la chiave di licenza…"></textarea>
          <div class="lic-actions">
            <button class="btn btn--filled btn--sm" id="setLicActivate">${icon("key", "sm")}Attiva / Aggiorna</button>
            <button class="btn btn--tonal btn--sm" id="setLicLoad">${icon("folder_open", "sm")}Carica da file</button>
            <button class="btn btn--outlined btn--sm" id="setLicDeact">${icon("link_off", "sm")}Disattiva</button>
          </div>
          <div class="lg-msg" id="setLicMsg"></div>
          <p class="help">Attivazione <b>offline</b> legata a questo dispositivo (HWID).</p>
        </div>
        <div class="set-card legal-card">
          <h3>${icon("local_fire_department", "sm")} Produttore</h3>
          <div class="vendor">
            <div class="vendor-logo">${icon("local_fire_department")}</div>
            <div class="vendor-meta">
              <b>${COMPANY.name}</b>
              <span>${COMPANY.office}</span>
              <span>P.IVA ${COMPANY.vat} · ${COMPANY.rea}</span>
              <span>${COMPANY.email}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn--tonal btn--sm" id="openLicense">${icon("description", "sm")}Leggi la licenza (EULA)</button>
          </div>
          <p class="help">${COPYRIGHT} — Software proprietario. Tutti i diritti riservati.</p>
        </div>`;
      case "info":
      default:
        return `<div class="set-card">
          <h3>${icon("info", "sm")} Informazioni</h3>
          <div class="about-grid">
            <div><span>Prodotto</span><b>Typographus — Editorial Engine</b></div>
            <div><span>Versione</span><b>${COMPANY.version}</b></div>
            <div><span>Runtime</span><b>Electron · Vite · TS</b></div>
            <div><span>Impaginazione</span><b>Paged.js</b></div>
            <div><span>Conversione</span><b>marked · mammoth · JSZip</b></div>
            <div><span>Licenza</span><b>Proprietaria (EULA)</b></div>
          </div>
          <p class="help">Tutti i documenti e le preferenze sono salvati localmente sul tuo dispositivo. ${COPYRIGHT}.</p>
        </div>`;
    }
  }

  renderSettingsCat() {
    const host = document.getElementById("setContent");
    if (!host) return;
    host.innerHTML = this.settingsCatHtml();
    this.bindSettingsControls();
    if (this.settingsCat === "licenza") this.refreshLicensePanel();
    if (this.settingsCat === "account") this.bindAccountControls();
  }

  openLicense() {
    const old = document.getElementById("licenseScrim");
    if (old) old.remove();
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.id = "licenseScrim";
    scrim.innerHTML = `
      <div class="dialog license-dialog" role="dialog" aria-modal="true">
        <div class="lic-head">
          <div class="vendor-logo sm">${icon("local_fire_department")}</div>
          <div>
            <h2>Contratto di licenza (EULA)</h2>
            <p class="help" style="margin:2px 0 0">${COMPANY.product} v${COMPANY.version} · ${COMPANY.name}</p>
          </div>
        </div>
        <div class="lic-body">
          ${EULA_SECTIONS.map(
            (s) => `<div class="lic-sec"><b>${s.n}. ${escapeHtml(s.title)}</b><p>${escapeHtml(s.body)}</p></div>`
          ).join("")}
          <p class="lic-copy">${COPYRIGHT} — ${COMPANY.office} — P.IVA ${COMPANY.vat}</p>
        </div>
        <div class="dialog-actions">
          <button class="btn btn--filled" id="licClose">Ho capito</button>
        </div>
      </div>`;
    document.body.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add("is-open"));
    const close = () => {
      scrim.classList.remove("is-open");
      setTimeout(() => scrim.remove(), 220);
    };
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) close();
    });
    (scrim.querySelector("#licClose") as HTMLElement).onclick = close;
  }

  openMarkdownHelp() {
    const old = document.getElementById("mdHelpScrim");
    if (old) old.remove();
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.id = "mdHelpScrim";
    scrim.innerHTML = `
      <div class="dialog md-help-dialog" role="dialog" aria-modal="true">
        <div class="lic-head">
          <div class="vendor-logo sm" style="background:var(--accent-dim);color:var(--accent)">${icon("help_outline")}</div>
          <div>
            <h2>Guida alla Scrittura (Markdown)</h2>
            <p class="help" style="margin:2px 0 0">Usa questi formati nel testo per impaginare automaticamente.</p>
          </div>
        </div>
        <div class="lic-body" style="max-height:360px;overflow-y:auto;padding-right:8px;display:flex;flex-direction:column;gap:12px;margin:16px 0">
          <div style="border-bottom:1px solid var(--hairline);padding-bottom:10px">
            <h4 style="margin:0 0 6px">Titoli di sezione</h4>
            <div style="display:flex;justify-content:space-between;align-items:center;background:var(--md-surface-container-high);padding:8px 12px;border-radius:var(--r-sm)">
              <code>## Titolo di Sezione</code>
              <button class="btn btn--text btn--sm" data-ins="title">Inserisci</button>
            </div>
          </div>
          <div style="border-bottom:1px solid var(--hairline);padding-bottom:10px">
            <h4 style="margin:0 0 6px">Enfasi e stili</h4>
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--md-surface-container-high);padding:6px 12px;border-radius:var(--r-sm)">
                <span><b>Grassetto:</b> <code>**testo**</code></span>
                <button class="btn btn--text btn--sm" data-ins="format_bold">Inserisci</button>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--md-surface-container-high);padding:6px 12px;border-radius:var(--r-sm)">
                <span><i>Corsivo:</i> <code>_testo_</code></span>
                <button class="btn btn--text btn--sm" data-ins="format_italic">Inserisci</button>
              </div>
            </div>
          </div>
          <div style="border-bottom:1px solid var(--hairline);padding-bottom:10px">
            <h4 style="margin:0 0 6px">Citazioni e frasi in evidenza</h4>
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--md-surface-container-high);padding:6px 12px;border-radius:var(--r-sm)">
                <span>Citazione normale: <code>> testo</code></span>
                <button class="btn btn--text btn--sm" data-ins="format_quote">Inserisci</button>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--md-surface-container-high);padding:6px 12px;border-radius:var(--r-sm)">
                <span>Citazione in evidenza (Pullquote)</span>
                <button class="btn btn--text btn--sm" data-ins="format_size">Inserisci</button>
              </div>
            </div>
          </div>
          <div style="border-bottom:1px solid var(--hairline);padding-bottom:10px">
            <h4 style="margin:0 0 6px">Elementi speciali</h4>
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--md-surface-container-high);padding:6px 12px;border-radius:var(--r-sm)">
                <span>Immagine: <code>![descr](url)</code></span>
                <button class="btn btn--text btn--sm" data-ins="image">Inserisci</button>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--md-surface-container-high);padding:6px 12px;border-radius:var(--r-sm)">
                <span>Nota a piè pagina: <code>[^1]</code></span>
                <button class="btn btn--text btn--sm" data-ins="superscript">Inserisci</button>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--md-surface-container-high);padding:6px 12px;border-radius:var(--r-sm)">
                <span>Link internet: <code>[testo](url)</code></span>
                <button class="btn btn--text btn--sm" data-ins="link">Inserisci</button>
              </div>
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn--filled" id="mdHelpClose">Ho capito</button>
        </div>
      </div>`;
    document.body.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add("is-open"));
    const close = () => {
      scrim.classList.remove("is-open");
      setTimeout(() => scrim.remove(), 220);
    };
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) close();
    });
    byId("mdHelpClose").onclick = close;
    scrim.querySelectorAll<HTMLElement>("[data-ins]").forEach((b) => {
      b.onclick = () => {
        const ed = byId<HTMLTextAreaElement>("editor");
        if (ed) {
          this.applyMd(b.dataset.ins!, ed);
        }
        close();
      };
    });
  }

  bindSettings() {
    byId("setBack").onclick = () => this.goScreen("home");
    this.screenRoot.querySelectorAll<HTMLElement>(".set-nav-item").forEach((b) => {
      b.onclick = () => {
        this.settingsCat = b.dataset.cat!;
        this.screenRoot.querySelectorAll(".set-nav-item").forEach((x) =>
          x.classList.toggle("is-active", x === b)
        );
        this.renderSettingsCat();
      };
    });
    this.renderSettingsCat();
  }

  bindSettingsControls() {
    bindSegmented("setTheme", (v) => {
      this.prefs.theme = v as AppPrefs["theme"];
      this.commitPrefs();
    });
    this.screenRoot.querySelectorAll<HTMLElement>(".accent-sw").forEach((b) => {
      b.onclick = () => {
        this.prefs.accent = b.dataset.accent as AccentKey;
        this.screenRoot.querySelectorAll(".accent-sw").forEach((x) => x.classList.remove("is-sel"));
        b.classList.add("is-sel");
        this.commitPrefs();
      };
    });
    bindSegmented("setDensity", (v) => {
      this.prefs.density = v as AppPrefs["density"];
      this.commitPrefs();
    });
    bindSlider("setEdSize", (n) => {
      this.prefs.editorFontSize = n;
      this.commitPrefs();
    }, " px");
    bindSwitch("setWrap", (c) => {
      this.prefs.wordWrap = c;
      this.commitPrefs();
    });
    bindSwitch("setAutosave", (c) => {
      this.prefs.autosave = c;
      this.commitPrefs();
    });
    bindSegmented("setLang", (v) => {
      this.prefs.language = v as AppPrefs["language"];
      this.commitPrefs();
    });
    bindSelect("setDefPage", (v) => {
      this.prefs.defPageSize = v as Settings["pageSize"];
      this.commitPrefs(false);
    });
    bindSlider("setDefBody", (n) => {
      this.prefs.defBodySize = n;
      this.commitPrefs(false);
    }, " pt");
    bindSlider("setDefLead", (n) => {
      this.prefs.defLeading = n;
      this.commitPrefs(false);
    }, "×");

    const openLic = document.getElementById("openLicense");
    if (openLic) openLic.onclick = () => this.openLicense();
    this.bindLicenseControls();
  }

  bindLicenseControls() {
    const activate = document.getElementById("setLicActivate");
    if (!activate) return; // not the license category
    const msg = byId("setLicMsg");
    const keyEl = byId<HTMLTextAreaElement>("setLicKey");

    if (!desktop?.license) {
      msg.textContent = "La gestione licenza è disponibile solo nell'app desktop.";
      msg.className = "lg-msg";
      activate.setAttribute("disabled", "true");
      byId("setLicDeact").setAttribute("disabled", "true");
      byId("setLicLoad").setAttribute("disabled", "true");
      return;
    }

    activate.onclick = async () => {
      const token = keyEl.value.trim();
      if (!token) {
        msg.textContent = "Inserisci una chiave di licenza.";
        msg.className = "lg-msg err";
        return;
      }
      const res = await desktop.license!.activate(token);
      msg.textContent = res.valid ? "Licenza attivata correttamente." : res.message;
      msg.className = res.valid ? "lg-msg ok" : "lg-msg err";
      if (res.valid) keyEl.value = "";
      this.refreshLicensePanel();
    };

    byId("setLicDeact").onclick = async () => {
      await desktop.license!.deactivate();
      msg.textContent = "Licenza disattivata su questo dispositivo.";
      msg.className = "lg-msg";
      this.refreshLicensePanel();
    };

    byId("setLicLoad").onclick = () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".typographus,.txt,.key,.jwt";
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        keyEl.value = (await f.text()).trim();
        msg.textContent = "Chiave caricata dal file: premi “Attiva / Aggiorna”.";
        msg.className = "lg-msg";
      };
      inp.click();
    };
  }

  bindAccountControls() {
    const loginBtn = document.getElementById("btnAccLogin");
    const logoutBtn = document.getElementById("btnAccLogout");
    const msg = document.getElementById("accMsg");

    if (loginBtn) {
      loginBtn.onclick = async () => {
        const email = byId<HTMLInputElement>("accEmail").value.trim();
        const password = byId<HTMLInputElement>("accPassword").value.trim();

        if (!email || !password) {
          if (msg) {
            msg.textContent = "Inserisci email e password.";
            msg.className = "lg-msg err";
          }
          return;
        }

        if (msg) {
          msg.textContent = "Connessione in corso…";
          msg.className = "lg-msg";
        }

        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;

          this.supabaseUser = data.user;

          const { data: profile } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", data.user.id)
            .single();
          this.supabaseProfile = profile;

          snackbar("Collegato con successo a Nexflamma!");
          this.renderSettingsCat();
        } catch (err: any) {
          if (msg) {
            msg.textContent = "Errore di accesso: " + err.message;
            msg.className = "lg-msg err";
          }
        }
      };
    }

    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        try {
          await supabase.auth.signOut();
          this.supabaseUser = null;
          this.supabaseProfile = null;
          snackbar("Disconnesso con successo.");
          this.renderSettingsCat();
        } catch (err: any) {
          snackbar("Errore durante la disconnessione: " + err.message);
        }
      };
    }
  }

  async refreshLicensePanel() {
    const host = document.getElementById("licStatus");
    if (!host) return;
    if (!desktop?.license) {
      host.innerHTML = `<div class="lic-stat"><span class="status-chip" data-status="draft">Demo</span><div class="lic-stat-meta"><b>Anteprima nel browser</b><span>Apri l'app desktop per attivare una licenza.</span></div></div>`;
      return;
    }
    const st = await desktop.license.status();
    this.licenseStatus = st;
    const cls = st.valid ? "published" : st.message.includes("scaduta") ? "review" : "draft";
    const label = st.valid ? "Attiva" : st.message.includes("scaduta") ? "Scaduta" : "Non attiva";
    const authorHandle = st.email ? (st.email.startsWith("@") ? st.email : "@" + st.email.split("@")[0]) : "@tu";
    host.innerHTML = `
      <div class="lic-stat">
        <span class="status-chip" data-status="${cls}">${label}</span>
        <div class="lic-stat-meta">
          <b>${escapeHtml(st.message)}</b>
          ${st.plan ? `<span>Piano: ${escapeHtml(st.plan)} (${st.plan.toLowerCase() === "admin" ? "Amministratore" : "Utente Standard"})</span>` : ""}
        </div>
      </div>
      <div class="lg-hwid" style="margin-top:12px">
        <div><span>Account collegato</span><b>${escapeHtml(st.email || "Nessun account (Demo)")}</b></div>
      </div>
      <div class="lg-hwid" style="margin-top:4px">
        <div><span>Identità Autore</span><b>${escapeHtml(authorHandle)}</b></div>
      </div>
      <div class="lg-hwid" style="margin-top:12px">
        <div><span>ID dispositivo (HWID)</span><b>${escapeHtml(st.hwid || "—")}</b></div>
        <button class="btn btn--text btn--sm" id="setCopyHwid">${icon("content_copy", "sm")}Copia</button>
      </div>`;
    const copy = document.getElementById("setCopyHwid");
    if (copy)
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(st.hwid);
          snackbar("HWID copiato.");
        } catch {
          /* ignore */
        }
      };
  }

  commitPrefs(reapply = true) {
    if (reapply) applyPrefs(this.prefs);
    savePrefs(this.prefs);
    this.updateTitlebar();
  }
}

/* --------------------------- tiny helpers --------------------------- */
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function tile(value: string, label: string): string {
  return `<div class="metric"><div class="v">${value}</div><div class="k">${label}</div></div>`;
}
function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h fa`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} g fa`;
  return new Date(ts).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}
function fmtMin(min: number): string {
  if (min < 1) return `${Math.max(1, Math.round(min * 60))}<small> s</small>`;
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return `${m}<small> min${s ? " " + s + "s" : ""}</small>`;
}
function slugFile(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "documento"
  );
}

/* control binders */
function bindSlider(id: string, fn: (n: number) => void, unit = "") {
  const el = byId<HTMLInputElement>(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    const out = document.getElementById(`${id}-v`);
    if (out) out.textContent = `${v}${unit}`;
    fn(v);
  });
}
function bindNumber(id: string, fn: (n: number) => void) {
  const el = byId<HTMLInputElement>(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    if (!Number.isNaN(v)) fn(v);
  });
}
function bindSwitch(id: string, fn: (c: boolean) => void) {
  const el = byId<HTMLInputElement>(id);
  if (!el) return;
  el.addEventListener("change", () => fn(el.checked));
}
function bindSelect(id: string, fn: (v: string) => void) {
  const el = byId<HTMLSelectElement>(id);
  if (!el) return;
  el.addEventListener("change", () => fn(el.value));
}
function bindSegmented(id: string, fn: (v: string) => void) {
  const seg = byId(id);
  if (!seg) return;
  seg.querySelectorAll<HTMLElement>("button").forEach((b) => {
    b.onclick = () => {
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("is-active"));
      b.classList.add("is-active");
      fn(b.dataset.v!);
    };
  });
}
function bindSegmentedActive(id: string, value: string) {
  const seg = byId(id);
  if (!seg) return;
  seg.querySelectorAll<HTMLElement>("button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.v === value);
  });
}

function blockHtmlToMd(html: string): string {
  let s = html;
  s = s.replace(/<span style="([^"]*)"[^>]*>(.*?)<\/span>/gi, (_m, styleStr, text) => {
    const styles = styleStr.split(";").map((x) => x.trim()).filter(Boolean);
    const attrs: string[] = [];
    for (const st of styles) {
      const parts = st.split(":");
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase();
        const val = parts.slice(1).join(":").trim();
        if (key === "color") {
          attrs.push(`color: ${val}`);
        } else if (key === "font-family") {
          let foundFont = val;
          for (const [fName, fStack] of Object.entries(FONT_STACKS)) {
            if (fStack.toLowerCase().includes(val.toLowerCase()) || val.toLowerCase().includes(fName.toLowerCase())) {
              foundFont = fName;
              break;
            }
          }
          attrs.push(`font: ${foundFont}`);
        }
      }
    }
    return `[${text}]{${attrs.join("; ")}}`;
  });

  s = s.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
  s = s.replace(/<b>(.*?)<\/b>/gi, "**$1**");
  s = s.replace(/<em>(.*?)<\/em>/gi, "_$1_");
  s = s.replace(/<i>(.*?)<\/i>/gi, "_$1_");
  s = s.replace(/<[^>]+>/g, "");
  
  const temp = document.createElement("textarea");
  temp.innerHTML = s;
  return temp.value;
}

function getBlockMd(tagName: string, innerHtml: string): string {
  const content = blockHtmlToMd(innerHtml);
  if (tagName === "H2") return `## ${content}`;
  if (tagName === "H3") return `### ${content}`;
  if (tagName === "H4") return `#### ${content}`;
  if (tagName === "BLOCKQUOTE") return `> ${content}`;
  if (tagName === "LI") return `- ${content}`;
  return content;
}

export function startApp(root: HTMLElement) {
  new App(root);
}
