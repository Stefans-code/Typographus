/* =========================================================================
   Typographus — application controller.
   ========================================================================= */

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
import { TEMPLATES, type Template } from "./templates";
import { COMPANY, COPYRIGHT, EULA_SECTIONS } from "./legal";
import { compile, toPlainText } from "./typography";
import { detectAI, rewrite, type RewriteMode } from "./aitools";
import { analyze, estimateExtent, type Analysis } from "./metrics";
import { lint } from "./linter";
import { importFile } from "./importers";
import { buildStandaloneHtml, buildToc, downloadBlob, exportEpub, printDocument } from "./exporters";
import { pageDims, renderGalley, renderPaged } from "./paginate";
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
const BRAND_ICON = import.meta.env.BASE_URL + "icon.png";

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
  };
}
const desktop: DesktopBridge | undefined = (window as unknown as { typographus?: DesktopBridge }).typographus;
const IS_ELECTRON = !!desktop;

const RAIL: { id: RailTool; icon: string; label: string }[] = [
  { id: "document", icon: "article", label: "Documento" },
  { id: "layout", icon: "grid_on", label: "Layout" },
  { id: "typography", icon: "match_case", label: "Tipografia" },
  { id: "editoria", icon: "auto_stories", label: "Editoria" },
  { id: "review", icon: "fact_check", label: "Revisione" },
  { id: "ai", icon: "smart_toy", label: "AI" },
  { id: "export", icon: "ios_share", label: "Esporta" },
];

class App {
  store: Store;
  prefs: AppPrefs;
  screen: Screen = "home";
  tool: RailTool = "document";
  view: ViewMode = "galley";
  zoom = 0.62;
  sourceOpen = true;
  inspectorOpen = true;
  lastCompiled = { html: "", footnoteCount: 0, imageCount: 0, citationCount: 0 };

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
  async boot() {
    if (desktop?.license) {
      try {
        const st = await desktop.license.status();
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
      <input type="file" id="fileInput" accept=".md,.markdown,.txt,.docx" style="display:none">
    `;
    this.screenRoot = byId("screenRoot");
    this.fileInput = byId("fileInput");
    this.bindTitlebar();
    this.bindFileInput();
    this.goScreen(this.screen);
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
        <section class="pane source-pane" id="sourcePane">${this.sourcePane()}</section>
        <section class="pane preview-pane">
          ${this.previewHead()}
          <div class="preview-scroll" id="previewScroll"><div class="preview-stage" id="stage"></div></div>
        </section>
        <aside class="inspector" id="inspector">
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

    this.zoom = this.fitZoomValue();
    this.renderInspector();
    this.renderPreview();
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
          <span class="dot" data-tip="Salvato in locale"></span>
          <input id="docTitle" type="text" value="${escapeHtml(this.store.state.title)}" spellcheck="false">
        </div>
        <div class="screen-label off-editor" id="screenLabel"></div>
      </div>
      <div class="tb-right">
        <button class="icon-btn editor-only" id="toggleSource" data-tip="Mostra/nascondi sorgente">${icon("dock_to_right")}</button>
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
    const tools: [string, string, string][] = [
      ["format_bold", "**", "Grassetto"],
      ["format_italic", "_", "Corsivo"],
      ["title", "## ", "Titolo"],
      ["format_quote", "> ", "Citazione"],
      ["format_size", ":::pullquote", "Pull quote"],
      ["image", "image", "Immagine"],
      ["superscript", "[^n]", "Nota"],
      ["link", "link", "Link"],
      ["format_list_bulleted", "- ", "Elenco"],
    ];
    return `
      <div class="pane-head">
        <span class="pane-title">${icon("code", "sm")} Sorgente · Markdown</span>
        <span class="spacer"></span>
      </div>
      <div class="md-toolbar" id="mdToolbar">
        ${tools
          .map(
            ([ic, , tip], i) =>
              `${i === 5 || i === 2 ? '<span class="sep"></span>' : ""}<button class="icon-btn" data-md="${ic}" data-tip="${tip}">${icon(ic, "sm")}</button>`
          )
          .join("")}
      </div>
      <textarea class="editor" id="editor" spellcheck="false" placeholder="Scrivi o incolla il tuo testo in Markdown…">${escapeHtml(
        this.store.state.source
      )}</textarea>`;
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
      <button class="icon-btn ${this.s.showColumns || this.s.showMargins ? "is-active" : ""}" id="gridQuick" data-tip="Griglia">${icon("grid_4x4")}</button>
      <button class="icon-btn ${this.s.cmykPreview ? "is-active" : ""}" id="cmykQuick" data-tip="Anteprima CMYK">${icon("palette")}</button>
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
    byId("toggleSource").onclick = () => {
      if (this.screen !== "editor") return;
      this.sourceOpen = !this.sourceOpen;
      byId("workspace").classList.toggle("source-collapsed", !this.sourceOpen);
      setTimeout(() => this.applyZoom(), 260);
    };
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
    ed.addEventListener("input", () => {
      this.store.set({ source: ed.value });
      this.schedule();
      this.updateReviewReadouts();
    });
    byId("mdToolbar")
      .querySelectorAll<HTMLElement>("[data-md]")
      .forEach((b) => (b.onclick = () => this.applyMd(b.dataset.md!, ed)));
  }

  bindPreviewHead() {
    bindSegmented("viewSeg", (v) => {
      this.view = v as ViewMode;
      this.renderPreview();
    });
    byId("zoomOut").onclick = () => this.setZoom(this.zoom - 0.08);
    byId("zoomIn").onclick = () => this.setZoom(this.zoom + 0.08);
    byId("zoomFit").onclick = () => this.setZoom(this.fitZoomValue());
    byId("gridQuick").onclick = () => {
      const on = !(this.s.showMargins || this.s.showColumns);
      this.store.setSetting("showMargins", on);
      if (this.s.columns > 1) this.store.setSetting("showColumns", on);
      byId("gridQuick").classList.toggle("is-active", on);
      this.refreshAfterSetting();
    };
    byId("cmykQuick").onclick = () => {
      this.store.setSetting("cmykPreview", !this.s.cmykPreview);
      byId("cmykQuick").classList.toggle("is-active", this.s.cmykPreview);
      this.updateCmyk();
    };
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
    this.tool = tool;
    this.root.querySelectorAll<HTMLElement>(".rail-item").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.tool === tool)
    );
    this.renderInspector();
  }

  applyMd(kind: string, ed: HTMLTextAreaElement) {
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
      case "image":
        insert = `\n![${sel || "descrizione"}](placeholder "Didascalia | Foto: Autore")\n`;
        break;
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
    if (this.view === "galley") {
      renderGalley(this.stage, compiled.html, this.s);
      this.pageCounter.textContent = "bozza continua";
    } else {
      // Paged.js measures real geometry while laying out: a CSS transform on
      // an ancestor corrupts those measurements, so paginate at scale 1 and
      // apply zoom only to the finished pages.
      this.stage.style.transform = "scale(1)";
      this.pageCounter.textContent = "impagino…";
      const total = await this.runPaged(compiled.html);
      this.pageCounter.textContent = total ? `${total} ${total === 1 ? "pagina" : "pagine"}` : "—";
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
        <h3>${icon("insights", "sm")} A colpo d'occhio</h3>
        <div class="metric-grid" id="docQuick"></div>
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
    this.updateDocQuick();
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
      <div class="section">
        <h3>${icon("text_fields", "sm")} Corpo del testo</h3>
        <div class="stack">
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
        <div id="refList"></div>
        <button class="btn btn--tonal" id="addRef" style="width:100%;margin-top:8px">${icon("add")}Aggiungi riferimento</button>
        <p class="help">Cita nel testo con <code>[@chiave]</code> → diventa <em>(Autore anno)</em> e genera automaticamente la sezione Bibliografia. ${refs.length ? `${refs.length} riferimenti.` : ""}</p>
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

  /* ---- panel: AI tools (local · offline) ---- */
  panelAI(): string {
    return `
      <div class="section">
        <h3>${icon("policy", "sm")} Rilevatore AI · Umano vs AI</h3>
        <div class="stack">
          <button class="btn btn--filled" id="aiAnalyze" style="width:100%">${icon("frame_inspect")}Analizza il testo</button>
          <div id="aiResult"></div>
          <p class="help">Stima <b>euristica locale</b> (stilometria): nessun modello esterno, 100% offline. Indicativa, non probatoria.</p>
        </div>
      </div>
      <div class="section">
        <h3>${icon("auto_fix_high", "sm")} Riscrittore</h3>
        <div class="stack">
          ${segmented("aiMode", [["humanize", "Umanizza"], ["simplify", "Semplifica"], ["formal", "Formale"]], "humanize")}
          <button class="btn btn--tonal" id="aiRewrite" style="width:100%">${icon("autorenew")}Riscrivi il testo</button>
          <div id="aiRewriteWrap" style="display:none">
            <div class="field"><label>Risultato</label><textarea id="aiRewriteOut" rows="8" spellcheck="false"></textarea></div>
            <div style="display:flex;gap:8px">
              <button class="btn btn--filled btn--sm" id="aiApply">${icon("check")}Applica al documento</button>
              <button class="btn btn--outlined btn--sm" id="aiCopy">${icon("content_copy")}Copia</button>
            </div>
          </div>
          <p class="help">Riscrittura <b>locale basata su regole</b>: rimuove i cliché da LLM, varia il ritmo, semplifica o formalizza. Offline.</p>
        </div>
      </div>`;
  }
  bindAI() {
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
        <h3>${icon("toc", "sm")} Indice generale</h3>
        <div id="tocPreview"></div>
      </div>`;
  }
  bindExport() {
    bindSelect("icc", (v) => this.store.setSetting("iccProfile", v));
    bindSwitch("cmykExp", (c) => {
      this.store.setSetting("cmykPreview", c);
      byId("cmykQuick").classList.toggle("is-active", c);
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

      <section class="home-sec">
        <h2>${icon("dashboard_customize", "sm")} Inizia da un modello</h2>
        <div class="tpl-grid">
          ${TEMPLATES.map(
            (t) => `<button class="tpl-card" data-tpl="${t.id}">
              <span class="tpl-ic">${icon(t.icon)}</span>
              <b>${escapeHtml(t.name)}</b>
              <span class="tpl-desc">${escapeHtml(t.desc)}</span>
            </button>`
          ).join("")}
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
    this.screenRoot.querySelectorAll<HTMLElement>(".tpl-card").forEach((c) => {
      c.onclick = () => {
        const t = TEMPLATES.find((x) => x.id === c.dataset.tpl);
        if (t) this.newFromTemplate(t);
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

  /* ============================ SETTINGS ============================ */
  settingsScreen(): string {
    const p = this.prefs;
    return `
    <div class="settings">
      <div class="settings-inner">
        <button class="btn btn--text settings-back" id="setBack">${icon("arrow_back")}Indietro</button>
        <h1 class="settings-title">Impostazioni</h1>

        <div class="set-card">
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
        </div>

        <div class="set-card">
          <h3>${icon("edit_note", "sm")} Editor</h3>
          ${sliderRow("Dimensione font sorgente", "setEdSize", 11, 18, 0.5, p.editorFontSize, " px")}
          <div class="opt-row"><div class="opt-label"><b>A capo automatico</b><span>Manda a capo le righe lunghe</span></div>
            <label class="switch"><input type="checkbox" id="setWrap" ${p.wordWrap ? "checked" : ""}><span class="track"><span class="thumb"></span></span></label></div>
        </div>

        <div class="set-card">
          <h3>${icon("translate", "sm")} Lingua e leggibilità</h3>
          <div class="opt-row"><div class="opt-label"><b>Lingua del testo</b><span>Indici di leggibilità e sillabazione</span></div>
            ${segmented("setLang", [["it", "Italiano"], ["en", "English"]], p.language)}</div>
        </div>

        <div class="set-card">
          <h3>${icon("note_add", "sm")} Nuovi documenti</h3>
          <p class="help" style="margin:0 0 14px">Valori predefiniti applicati ai documenti creati da zero.</p>
          ${fieldSelect(
            "Formato pagina",
            "setDefPage",
            [
              ["A3", "A3"],
              ["A4", "A4"],
              ["A5", "A5"],
              ["Letter", "US Letter"],
              ["Tabloid", "Tabloid"],
            ],
            p.defPageSize
          )}
          ${sliderRow("Corpo del testo", "setDefBody", 8, 14, 0.25, p.defBodySize, " pt")}
          ${sliderRow("Interlinea", "setDefLead", 1.0, 2.0, 0.05, p.defLeading, "×")}
        </div>

        <div class="set-card">
          <h3>${icon("info", "sm")} Informazioni</h3>
          <div class="about-grid">
            <div><span>Versione</span><b>Typographus ${COMPANY.version}</b></div>
            <div><span>Runtime</span><b>Electron · Vite · TypeScript</b></div>
            <div><span>Impaginazione</span><b>Paged.js</b></div>
            <div><span>Conversione</span><b>marked · mammoth · JSZip</b></div>
          </div>
          <p class="help" style="margin-bottom:14px">Tutti i documenti e le preferenze sono salvati localmente sul tuo dispositivo.</p>
        </div>

        <div class="set-card legal-card">
          <h3>${icon("verified_user", "sm")} Licenza e produttore</h3>
          <div class="vendor">
            <div class="vendor-logo">${icon("local_fire_department")}</div>
            <div class="vendor-meta">
              <b>${COMPANY.name}</b>
              <span>${COMPANY.office}</span>
              <span>P.IVA ${COMPANY.vat} · ${COMPANY.rea}</span>
              <span>${COMPANY.email}</span>
            </div>
          </div>
          <div class="about-grid" style="margin-top:14px">
            <div><span>Prodotto</span><b>Typographus — Editorial Engine</b></div>
            <div><span>Licenza</span><b>Proprietaria (EULA)</b></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="btn btn--tonal btn--sm" id="openLicense">${icon("description", "sm")}Leggi la licenza (EULA)</button>
          </div>
          <p class="help">${COPYRIGHT} — Tutti i diritti riservati. Software proprietario distribuito da Nexflamma.</p>
        </div>
      </div>
    </div>`;
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

  bindSettings() {
    byId("setBack").onclick = () => this.goScreen("home");
    byId("openLicense").onclick = () => this.openLicense();

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

export function startApp(root: HTMLElement) {
  new App(root);
}
