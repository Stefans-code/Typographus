/* =========================================================================
   Central application state — document, app preferences, document library.
   ========================================================================= */

export type ViewMode = "galley" | "paged";
export type RailTool = "document" | "layout" | "typography" | "editoria" | "review" | "ai" | "export";
export type Screen = "home" | "editor" | "settings";

export interface FrontMatter {
  kicker: string;
  headline: string;
  deck: string;
  author: string;
  dateline: string;
  section: string;
}

export interface Settings {
  /* page geometry */
  pageSize: "A4" | "A5" | "A3" | "Letter" | "Tabloid" | "Custom";
  pageW: number;
  pageH: number;
  orientation: "portrait" | "landscape";
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  bleed: number;
  marks: boolean;
  columns: 1 | 2 | 3;
  columnGap: number;
  columnRule: boolean;

  /* typography */
  bodyFont: string;
  headingFont: string;
  textColor: string;
  /* masthead (template parts) styling — empty string = inherit default */
  headlineFont: string;
  headlineColor: string;
  kickerFont: string;
  kickerColor: string;
  deckFont: string;
  deckColor: string;
  bodySize: number;
  leading: number;
  align: "justify" | "left";
  hyphens: boolean;
  ligatures: boolean;
  oldstyle: boolean;
  dropcap: boolean;
  smart: boolean;
  paraIndent: number;
  orphans: number;
  widows: number;

  /* grids */
  showMargins: boolean;
  showColumns: boolean;
  showBaseline: boolean;
  showGolden: boolean;
  baselineStep: number;
  showBleed: boolean;

  /* page furniture */
  pageNumbers: boolean;
  runningHead: boolean;

  /* color / output */
  cmykPreview: boolean;
  iccProfile: string;

  /* copyfitting */
  targetWords: number;

  /* citations: "author-date" — (Autore, Anno) inline, bibliografia alfabetica;
     "numeric" — [1] inline nell'ordine di prima citazione, bibliografia numerata
     nello stesso ordine (stile IEEE/Vancouver, comune nelle tesi STEM). */
  citationStyle: "author-date" | "numeric";
}

export type EditorialStatus = "draft" | "review" | "approved" | "published";

export const STATUS_LABELS: Record<EditorialStatus, string> = {
  draft: "Bozza",
  review: "In revisione",
  approved: "Approvato",
  published: "Pubblicato",
};

export interface EditorialMeta {
  isbn: string;
  publisher: string;
  collection: string;
  edition: string;
  year: string;
  copyright: string;
  rights: string;
  subjects: string;
  genColophon: boolean;
}

export interface Reference {
  key: string;
  author: string;
  title: string;
  year: string;
  publisher: string;
}

export const defaultMeta: EditorialMeta = {
  isbn: "",
  publisher: "",
  collection: "",
  edition: "",
  year: "",
  copyright: "",
  rights: "",
  subjects: "",
  genColophon: false,
};

export interface DocState {
  id: string;
  title: string;
  source: string;
  front: FrontMatter;
  settings: Settings;
  status: EditorialStatus;
  meta: EditorialMeta;
  references: Reference[];
}

/* ----------------------------- App preferences ----------------------------- */
export type AccentKey = "ink" | "ice" | "azure" | "emerald" | "amber" | "magenta" | "flame";

export interface AppPrefs {
  theme: "dark" | "light";
  accent: AccentKey;
  density: "cozy" | "compact";
  editorFontSize: number;
  wordWrap: boolean;
  language: "it" | "en";
  autosave: boolean;
  /* defaults applied to new documents */
  defPageSize: Settings["pageSize"];
  defBodySize: number;
  defLeading: number;
}

export const ACCENTS: Record<AccentKey, { name: string; hex: string; strong: string; on: string; rgb: string }> = {
  ink: { name: "Inchiostro", hex: "#c94f4a", strong: "#a83d39", on: "#fff9f2", rgb: "201, 79, 74" },
  ice: { name: "Blu ghiaccio", hex: "#5ea6ff", strong: "#3d8bff", on: "#051a31", rgb: "94, 166, 255" },
  azure: { name: "Azzurro", hex: "#38bdf8", strong: "#0ea5e9", on: "#04222e", rgb: "56, 189, 248" },
  emerald: { name: "Smeraldo", hex: "#34d399", strong: "#10b981", on: "#04261b", rgb: "52, 211, 153" },
  amber: { name: "Ambra", hex: "#f5a524", strong: "#e08e00", on: "#2a1c00", rgb: "245, 165, 36" },
  magenta: { name: "Magenta", hex: "#e879f9", strong: "#d946ef", on: "#2c0b32", rgb: "232, 121, 249" },
  flame: { name: "Nexflamma", hex: "#ff5f1f", strong: "#ff3d00", on: "#ffffff", rgb: "255, 95, 31" },
};

export const defaultPrefs: AppPrefs = {
  theme: "light",
  accent: "ink",
  density: "cozy",
  editorFontSize: 13.5,
  wordWrap: true,
  language: "it",
  autosave: true,
  defPageSize: "A4",
  defBodySize: 10.5,
  defLeading: 1.5,
};

export const PAGE_PRESETS: Record<string, { w: number; h: number }> = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Letter: { w: 215.9, h: 279.4 },
  Tabloid: { w: 279.4, h: 431.8 },
};

export const defaultSettings: Settings = {
  pageSize: "A4",
  pageW: 210,
  pageH: 297,
  orientation: "portrait",
  marginTop: 22,
  marginRight: 20,
  marginBottom: 24,
  marginLeft: 20,
  bleed: 3,
  marks: true,
  columns: 1,
  columnGap: 6,
  columnRule: false,
  bodyFont: "serif",
  headingFont: "display",
  textColor: "#18181a",
  headlineFont: "",
  headlineColor: "",
  kickerFont: "",
  kickerColor: "",
  deckFont: "",
  deckColor: "",
  bodySize: 10.5,
  leading: 1.5,
  align: "justify",
  hyphens: true,
  ligatures: true,
  oldstyle: false,
  dropcap: true,
  smart: true,
  paraIndent: 1.1,
  orphans: 2,
  widows: 2,
  showMargins: true,
  showColumns: false,
  showBaseline: false,
  showGolden: false,
  baselineStep: 15,
  showBleed: false,
  pageNumbers: true,
  runningHead: true,
  cmykPreview: false,
  iccProfile: "ISO Coated v2 (ECI) — FOGRA39",
  targetWords: 900,
  citationStyle: "author-date",
};

/* ----------------------------- persistence keys ----------------------------- */
const LIB_KEY = "typographus.library.v1";
const CUR_KEY = "typographus.current.v1";
const PREFS_KEY = "typographus.prefs.v1";

export function newId(): string {
  return "doc-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

/* ----------------------------- preferences I/O ----------------------------- */
export function loadPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaultPrefs, ...(JSON.parse(raw) as Partial<AppPrefs>) } : { ...defaultPrefs };
  } catch {
    return { ...defaultPrefs };
  }
}
export function savePrefs(p: AppPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
export function applyPrefs(p: AppPrefs) {
  const root = document.documentElement;
  root.setAttribute("data-theme", p.theme);
  root.setAttribute("data-density", p.density);
  root.setAttribute("lang", p.language);
  const a = ACCENTS[p.accent];
  root.style.setProperty("--accent", a.hex);
  root.style.setProperty("--accent-strong", a.strong);
  root.style.setProperty("--accent-dim", `rgba(${a.rgb}, 0.16)`);
  root.style.setProperty("--on-accent", a.on);
  root.style.setProperty("--md-primary-rgb", a.rgb);
  root.style.setProperty("--editor-size", `${p.editorFontSize}px`);
  root.style.setProperty("--editor-wrap", p.wordWrap ? "pre-wrap" : "pre");
}

/* ----------------------------- document library ----------------------------- */
export interface DocRecord extends DocState {
  updatedAt: number;
}

export function listLibrary(): DocRecord[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    const list = raw ? (JSON.parse(raw) as DocRecord[]) : [];
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}
function writeLibrary(list: DocRecord[]) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
export function upsertLibrary(doc: DocState) {
  const list = listLibrary();
  const rec: DocRecord = { ...doc, updatedAt: Date.now() };
  const i = list.findIndex((d) => d.id === doc.id);
  if (i >= 0) list[i] = rec;
  else list.unshift(rec);
  writeLibrary(list);
}
export function getFromLibrary(id: string): DocState | null {
  const d = listLibrary().find((x) => x.id === id);
  if (!d) return null;
  return {
    id: d.id,
    title: d.title,
    source: d.source,
    front: { ...d.front },
    settings: { ...defaultSettings, ...d.settings },
    status: d.status ?? "draft",
    meta: { ...defaultMeta, ...(d.meta ?? {}) },
    references: Array.isArray(d.references) ? d.references : [],
  };
}
export function deleteFromLibrary(id: string) {
  writeLibrary(listLibrary().filter((d) => d.id !== id));
}
export function setCurrentId(id: string) {
  try {
    localStorage.setItem(CUR_KEY, id);
  } catch {
    /* ignore */
  }
}
export function getCurrentId(): string | null {
  try {
    return localStorage.getItem(CUR_KEY);
  } catch {
    return null;
  }
}

/* ----------------------------- store ----------------------------- */
type Listener = (s: DocState) => void;

class Store {
  state: DocState;
  private listeners = new Set<Listener>();

  constructor(initial: DocState) {
    this.state = initial;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
    if (loadPrefs().autosave) {
      this.persist();
    }
  }

  persistForce() {
    this.persist();
  }

  set(patch: Partial<DocState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  replace(doc: DocState) {
    this.state = doc;
    setCurrentId(doc.id);
    this.emit();
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.state = { ...this.state, settings: { ...this.state.settings, [key]: value } };
    this.emit();
  }

  setFront<K extends keyof FrontMatter>(key: K, value: FrontMatter[K]) {
    this.state = { ...this.state, front: { ...this.state.front, [key]: value } };
    this.emit();
  }

  setMeta<K extends keyof EditorialMeta>(key: K, value: EditorialMeta[K]) {
    this.state = { ...this.state, meta: { ...this.state.meta, [key]: value } };
    this.emit();
  }

  setReferences(refs: Reference[]) {
    this.state = { ...this.state, references: refs };
    this.emit();
  }

  private persist() {
    upsertLibrary(this.state);
    setCurrentId(this.state.id);
  }

  /* Resolve the document to open on launch (current → most recent → seed). */
  static initial(seed: DocState): DocState {
    const lib = listLibrary();
    if (lib.length) {
      const cur = getCurrentId();
      const found = (cur && getFromLibrary(cur)) || getFromLibrary(lib[0].id);
      if (found) return found;
    }
    upsertLibrary(seed);
    setCurrentId(seed.id);
    return seed;
  }
}

export { Store };
