/* =========================================================================
   Paraphraser — motore proprietario di trasformazione del testo.

   Progettazione e implementazione originali di Typographus/Nexflamma.
   Non integra, chiama o riproduce codice o algoritmi di servizi di terzi
   (nessuna rete, nessuna dipendenza esterna, nessun modello). È un motore
   basato su regole linguistiche esplicite e trasparenti:

     1. GUARDIE — prima di toccare una parola, l'input viene scandito e ogni
        porzione "intoccabile" (numeri, date, URL, email, citazioni fra
        virgolette, riferimenti bibliografici, markup Markdown, e un
        glossario di termini tecnici/nomi propri forniti dall'utente) viene
        sostituita con un segnaposto opaco e ripristinata identica a fine
        elaborazione.
     2. LESSICO — sostituzione di parole comuni con sinonimi da un dizionario
        curato, con memoria d'uso per evitare di riproporre lo stesso
        sinonimo troppo spesso (anti-ripetizione).
     3. SINTASSI — rotazione dei connettivi, inversione di clausole
        coordinate simmetriche ("A e B" ⇄ "B e A"), scissione di frasi
        troppo lunghe: variano il ritmo senza toccare il contenuto.
     4. LIVELLO — un solo parametro 0..1 scala la probabilità di intervento
        di ognuna delle fasi sopra; a livello 0 il testo esce identico.

   Il motore non lancia mai eccezioni verso il chiamante: ogni fase è isolata
   in try/catch e, in caso di errore, restituisce l'unità di testo originale
   invariata più un avviso in `warnings`.

   Questo modulo NON è, e non si propone come, uno strumento per falsificare
   l'autorialità di un testo o per eludere controlli scolastici, professionali
   o contrattuali: è un riformulatore stilistico generico (varietà lessicale
   e sintattica, riduzione delle ripetizioni), interamente offline.
   ========================================================================= */

export type PLang = "it" | "en";

export interface ParaphraseOptions {
  /** Intensità complessiva, 0 (nessuna) .. 1 (massima). Default 0.5. Usata
   *  come valore di ripiego per `lexicalIntensity`/`structuralIntensity`
   *  quando non specificate separatamente. */
  level?: number;
  /** Quanto sostituire parole con sinonimi (0..1). Default = `level`. */
  lexicalIntensity?: number;
  /** Quanto intervenire su connettivi, ordine delle clausole e lunghezza
   *  delle frasi (0..1). Default = `level`. Indipendente dal lessicale:
   *  puoi chiedere tanta varietà di parole e zero riordino, o viceversa. */
  structuralIntensity?: number;
  lang?: PLang;
  /** Termini (nomi, sigle tecniche, titoli) da lasciare sempre invariati. */
  protectTerms?: string[];
  /** Seme del generatore pseudocasuale: stesso seme ⇒ stesso output (riproducibile). */
  seed?: number;
}

export interface ParaphraseResult {
  text: string;
  /** Quota di parole di contenuto effettivamente sostituite/riordinate (0..1). */
  changedRatio: number;
  /**
   * Stima euristica di conservazione del significato: sovrapposizione (Jaccard
   * pesata) fra le parole di contenuto del testo originale e di quello in
   * uscita. Non è una prova semantica formale — è un indicatore automatico
   * usato anche dai test per impedire regressioni che stravolgano il testo.
   */
  similarity: number;
  warnings: string[];
}

/* ============================ PRNG (mulberry32) ============================
   Generatore deterministico e riproducibile: stesso seed ⇒ stessa sequenza.
   Nessuna libreria esterna, ~10 righe, algoritmo di dominio pubblico. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ================================ GUARDIE ================================ */
const G_OPEN = "";
const G_CLOSE = "";

class GuardStore {
  private items: string[] = [];
  add(original: string): string {
    const idx = this.items.length;
    this.items.push(original);
    return G_OPEN + idx + G_CLOSE;
  }
  restore(text: string): string {
    return text.replace(/(\d+)/g, (_m, i) => this.items[Number(i)] ?? "");
  }
  /** true se non restano segnaposto orfani (integrità del round-trip). */
  isClean(text: string): boolean {
    return !/[]/.test(text);
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Costruisce l'unica regex "ombrello" applicata in un solo passaggio, così
 *  le porzioni già sostituite (segnaposto) non vengono mai ri-analizzate. */
function buildGuardRegex(protectTerms: string[]): RegExp {
  const parts = [
    "`[^`]*`", // codice inline
    "\\[[^\\]]*\\]\\([^)]*\\)", // link Markdown [testo](url)
    "\\*\\*[^*]*\\*\\*", // **grassetto**
    "__[^_]*__", // __grassetto__
    "\\*[^*\\n]*\\*", // *corsivo*
    "_[^_\\n]*_", // _corsivo_
    "https?:\\/\\/[^\\s)]+", // URL
    "[\\w.+-]+@[\\w-]+\\.[a-zA-Z]{2,}", // email
    '"[^"]*"', // "citazione"
    "«[^»]*»",
    "“[^”]*”",
    "\\([^()]{0,90}\\b(?:19|20)\\d{2}\\b[^()]{0,15}\\)", // (Autore, 2020) — citazione bibliografica
    "\\[\\d+(?:\\s*[-,]\\s*\\d+)*\\]", // [12] / [3-5] / [1,2] — riferimento numerico
    "\\d[\\d.,:/%]*", // numeri, date, percentuali, orari
    "\\b[A-Z]{2,}\\b", // sigle/acronimi (ISO, PDF, HTML…)
  ];
  if (protectTerms.length) {
    const terms = protectTerms
      .map((t) => t.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length) // termini più lunghi prima
      .map(escapeRe);
    if (terms.length) parts.push("\\b(?:" + terms.join("|") + ")\\b");
  }
  return new RegExp(parts.join("|"), "gu");
}

/* =========================== TOKENIZZAZIONE =========================== */
type Token = { kind: "guard" | "word" | "other"; text: string };

const TOKEN_RE = /(\d+)|([\p{L}\p{N}][\p{L}\p{N}'’-]*)|([^\p{L}\p{N}]+)/gu;

function tokenize(sentence: string): Token[] {
  const out: Token[] = [];
  for (const m of sentence.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) out.push({ kind: "guard", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "word", text: m[2] });
    else out.push({ kind: "other", text: m[3] });
  }
  return out;
}

/** Divide il testo in "frase + separatore finale", ricomponibile con join("")
 *  senza perdere un solo carattere di spaziatura. */
function segmentSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?…])(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) out.push(parts[i] + (parts[i + 1] ?? ""));
  return out.filter((s) => s.length > 0);
}

function splitTrailingSpace(piece: string): [string, string] {
  const m = piece.match(/^([\s\S]*?)(\s*)$/);
  return m ? [m[1], m[2]] : [piece, ""];
}

/* preserva il prefisso Markdown di riga (titoli, liste, citazioni) */
function splitLinePrefix(line: string): [string, string] {
  const m = line.match(/^(\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)?)([\s\S]*)$/);
  return m ? [m[1], m[2]] : ["", line];
}

function matchCase(original: string, replacement: string): string {
  if (!original) return replacement;
  if (original === original.toUpperCase() && original !== original.toLowerCase()) return replacement.toUpperCase();
  if (/^\p{Lu}/u.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

/* ================================ LESSICO ================================
   Sinonimi curati manualmente: gruppi di 2-4 varianti per parole comuni
   (connettivi, verbi, avverbi, aggettivi). Elenco volutamente conservativo:
   solo parole a basso rischio di alterare il significato in contesto. */
const LEXICON: Record<PLang, Record<string, string[]>> = {
  it: {
    utilizzare: ["usare", "impiegare", "adoperare"],
    utilizza: ["usa", "impiega", "adopera"],
    effettuare: ["fare", "compiere", "svolgere"],
    ottenere: ["avere", "ricavare", "conseguire"],
    mostrare: ["mostrare", "evidenziare", "far vedere"],
    // NB genere/numero: le opzioni di ogni voce devono avere la STESSA
    // desinenza della chiave (invariabile "-e" con invariabile; "-o"/"-a"
    // solo con la stessa forma) per non rompere l'accordo con l'articolo
    // o il nome che l'aggettivo accompagna (mai visibile al motore).
    importante: ["importante", "rilevante", "notevole"], // tutte invariabili (-e)
    grande: ["grande", "notevole", "rilevante"], // tutte invariabili (-e)
    piccolo: ["piccolo", "ridotto", "modesto"], // tutte maschile singolare, come la chiave
    veloce: ["veloce", "celere"], // tutte invariabili (-e)
    lento: ["lento", "graduale", "moderato"], // maschile singolare / invariabile, coerenti con la chiave
    semplice: ["semplice", "elementare", "lineare"], // tutte invariabili (-e)
    aiutare: ["aiutare", "assistere", "supportare"],
    creare: ["creare", "realizzare", "costruire"],
    migliorare: ["migliorare", "perfezionare", "affinare"],
    cambiare: ["cambiare", "modificare", "trasformare"],
    iniziare: ["iniziare", "cominciare", "avviare"],
    terminare: ["terminare", "concludere", "finire"],
    aumentare: ["aumentare", "incrementare", "accrescere"],
    diminuire: ["diminuire", "ridurre", "calare"],
    tuttavia: ["tuttavia", "però", "ciò nonostante"],
    però: ["però", "tuttavia", "ma"],
    pertanto: ["pertanto", "quindi", "perciò"],
    quindi: ["quindi", "dunque", "pertanto"],
    inoltre: ["inoltre", "in aggiunta", "per di più"],
    infatti: ["infatti", "in effetti", "difatti"],
    esempio: ["esempio", "caso"], // entrambi maschili, come la chiave
    problema: ["problema", "inconveniente"], // entrambi maschili (problema è irregolare: -a ma maschile)
    soluzione: ["soluzione", "risposta"], // entrambi femminili, come la chiave
    risultato: ["risultato", "esito"], // entrambi maschili
    metodo: ["metodo", "approccio", "procedimento"], // tutti maschili
    permettere: ["permettere", "consentire"],
    richiedere: ["richiedere", "necessitare di"],
    considerare: ["considerare", "valutare", "tenere conto di"],
    indicare: ["indicare", "segnalare"],
    fondamentale: ["fondamentale", "essenziale", "cruciale"], // tutte invariabili (-e)
    diverso: ["diverso", "differente"], // differente è invariabile: sostituto sicuro per un originale maschile singolare
    simile: ["simile", "paragonabile"], // tutte invariabili (-e)
    necessario: ["necessario", "indispensabile", "essenziale"], // invariabili, sostituto sicuro del maschile singolare
    possibile: ["possibile", "plausibile"], // invariabili (-e)
    attuale: ["attuale", "corrente"], // invariabili (-e)
    comune: ["comune", "frequente"], // invariabili (-e)
    evidente: ["evidente", "palese"], // invariabili (-e)
    utile: ["utile", "funzionale"], // invariabili (-e)
    // verbi (nessun problema di accordo di genere)
    pensare: ["pensare", "credere", "ritenere"],
    dire: ["dire", "affermare", "dichiarare"],
    vedere: ["vedere", "osservare", "notare"],
    trovare: ["trovare", "individuare", "rintracciare"],
    continuare: ["continuare", "proseguire"],
    provare: ["provare", "tentare"],
    decidere: ["decidere", "scegliere"],
    spiegare: ["spiegare", "chiarire", "illustrare"],
    descrivere: ["descrivere", "raccontare", "narrare"],
    sviluppare: ["sviluppare", "elaborare"],
    includere: ["includere", "comprendere"],
    ridurre: ["ridurre", "contenere", "limitare"],
    garantire: ["garantire", "assicurare"],
    offrire: ["offrire", "proporre", "fornire"],
    rappresentare: ["rappresentare", "costituire"],
    rimanere: ["rimanere", "restare"],
    diventare: ["diventare", "divenire"],
    dimostrare: ["dimostrare", "evidenziare"],
    // avverbi (invariabili per natura, nessun rischio di accordo)
    spesso: ["spesso", "frequentemente"],
    sempre: ["sempre", "costantemente"],
    solo: ["solo", "soltanto", "unicamente"],
    circa: ["circa", "approssimativamente"],
    molto: ["molto", "parecchio"],
    già: ["già", "ormai"],
    // sostantivi: opzioni sempre dello stesso genere della chiave
    azienda: ["azienda", "impresa", "società"], // femminili
    lavoro: ["lavoro", "impiego", "mestiere"], // maschili
    tempo: ["tempo", "periodo"], // maschili
    modo: ["modo", "sistema"], // maschili ("sistema" è maschile pur finendo in -a)
    parte: ["parte", "porzione", "sezione"], // femminili
    punto: ["punto", "aspetto", "elemento"], // maschili
    idea: ["idea", "nozione"], // femminili
    mondo: ["mondo", "universo"], // maschili
  },
  en: {
    utilize: ["use", "employ", "apply"],
    use: ["use", "employ"],
    obtain: ["get", "obtain", "acquire"],
    show: ["show", "reveal", "demonstrate"],
    important: ["important", "significant", "notable"],
    big: ["large", "big", "considerable"],
    small: ["small", "minor", "modest"],
    fast: ["fast", "quick", "rapid"],
    slow: ["slow", "gradual"],
    difficult: ["difficult", "complex", "hard"],
    simple: ["simple", "straightforward", "plain"],
    help: ["help", "assist", "support"],
    create: ["create", "build", "produce"],
    improve: ["improve", "refine", "enhance"],
    change: ["change", "modify", "alter"],
    begin: ["begin", "start"],
    end: ["end", "finish", "conclude"],
    increase: ["increase", "raise", "grow"],
    decrease: ["decrease", "reduce", "lower"],
    however: ["however", "yet", "nevertheless"],
    therefore: ["therefore", "thus", "so"],
    moreover: ["moreover", "in addition", "besides"],
    indeed: ["indeed", "in fact"],
    example: ["example", "instance"],
    problem: ["problem", "issue", "difficulty"],
    solution: ["solution", "fix", "remedy"],
    result: ["result", "outcome"],
    method: ["method", "approach", "procedure"],
    allow: ["allow", "let", "enable"],
    require: ["require", "need"],
    consider: ["consider", "weigh", "take into account"],
    indicate: ["indicate", "point out", "show"],
    key: ["key", "essential", "crucial"],
    different: ["different", "distinct"],
    similar: ["similar", "alike", "comparable"],
    necessary: ["necessary", "essential"],
    plausible: ["possible", "plausible"],
    current: ["current", "present"],
    frequent: ["common", "frequent"],
    obvious: ["obvious", "evident"],
    functional: ["useful", "functional"],
    think: ["think", "believe", "reckon"],
    say: ["say", "state", "mention"],
    see: ["see", "notice", "observe"],
    find: ["find", "locate"],
    continue: ["continue", "proceed"],
    try: ["try", "attempt"],
    decide: ["decide", "choose"],
    explain: ["explain", "clarify"],
    describe: ["describe", "outline"],
    develop: ["develop", "elaborate"],
    reduce: ["reduce", "limit"],
    guarantee: ["guarantee", "ensure"],
    offer: ["offer", "provide"],
    represent: ["represent", "constitute"],
    remain: ["remain", "stay"],
    become: ["become", "turn into"],
    demonstrate: ["demonstrate", "prove"],
    often: ["often", "frequently"],
    always: ["always", "constantly"],
    only: ["only", "merely"],
    about: ["about", "roughly"],
    today: ["today", "nowadays"],
    very: ["very", "quite"],
    already: ["already", "by now"],
    company: ["company", "firm"],
    job: ["job", "occupation"],
    time: ["time", "period"],
    way: ["way", "manner"],
    part: ["part", "portion", "section"],
    point: ["point", "aspect"],
    idea: ["idea", "notion"],
    world: ["world", "globe"],
  },
};

/* connettivi raggruppati: la rotazione sceglie un membro diverso dal gruppo
   invece del sinonimo "a caso", per evitare cadenze ripetute frase-dopo-frase */
const CONNECTIVE_GROUPS: Record<PLang, string[][]> = {
  it: [
    ["però", "tuttavia", "ma", "invece"],
    ["quindi", "perciò", "dunque", "così"],
    ["inoltre", "in più", "e poi", "oltre a questo"],
    ["infatti", "in effetti", "difatti"],
    ["ad esempio", "per esempio"],
  ],
  en: [
    ["but", "however", "yet"],
    ["so", "therefore", "thus", "hence"],
    ["also", "moreover", "in addition", "besides"],
    ["indeed", "in fact"],
    ["for example", "for instance"],
  ],
};

const STOPWORDS: Record<PLang, Set<string>> = {
  it: new Set(
    "il lo la i gli le un uno una di a da in con su per tra fra e o ma se che chi cui non più come anche dove quando perché questo questa questi queste è sono era essere ha hanno del della dei delle al alla ai alle si ci ne lo la li le mi ti".split(
      " "
    )
  ),
  en: new Set(
    "the a an of to in on for with and or but if that which who this these those is are was be has have it its as at by from not more most also into do does did".split(
      " "
    )
  ),
};

/* ============================ MOTORE PRINCIPALE ============================ */

interface Ctx {
  lang: PLang;
  lexical: number; // intensità sostituzione lessicale, 0..1
  structural: number; // intensità connettivi/riordino/scissione, 0..1
  rand: () => number;
  usage: Map<string, number>; // uso cumulativo dei sinonimi/connettivi scelti
  connLast: Map<number, string>; // ultimo connettivo scelto per gruppo
  warnings: string[];
  changed: number;
  totalWords: number;
  prevStart: string; // prima parola (lowercase) dell'ultima frase elaborata
  repeatStartStreak: number; // quante frasi di fila iniziano con la stessa parola
}

function lexProbability(intensity: number): number {
  return Math.max(0, Math.min(1, intensity)) * 0.75;
}
function connProbability(intensity: number): number {
  return Math.max(0, Math.min(1, intensity)) * 0.85;
}
function reorderProbability(intensity: number): number {
  return Math.max(0, Math.min(1, intensity)) * 0.35;
}

/* parole "chiuse" (articoli/dimostrativi/pronomi) troppo comuni per essere nel
   lessico: se aprono tre frasi di fila, vale la pena forzare un riordino per
   variare l'incipit, invece di lasciarlo identico frase dopo frase. */
const CLOSED_STARTERS: Record<PLang, Set<string>> = {
  it: new Set(["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "questo", "questa", "questi", "queste", "esso", "essa"]),
  en: new Set(["the", "a", "an", "this", "that", "these", "those", "it"]),
};

function pickFromTier(options: string[], usage: Map<string, number>, rand: () => number): string {
  let best = Infinity;
  for (const o of options) best = Math.min(best, usage.get(o.toLowerCase()) ?? 0);
  const tier = options.filter((o) => (usage.get(o.toLowerCase()) ?? 0) === best);
  return tier[Math.floor(rand() * tier.length) % tier.length];
}

function transformWord(word: string, isSentenceStart: boolean, isProperNoun: boolean, ctx: Ctx): string {
  ctx.totalWords++;
  if (isProperNoun) return word; // protetto: mai toccato
  const key = word.toLowerCase();
  const options = LEXICON[ctx.lang][key];
  if (!options || !options.length) return word;
  if (ctx.rand() > lexProbability(ctx.lexical)) return word;
  const candidates = options.filter((o) => o.toLowerCase() !== key);
  if (!candidates.length) return word;
  const choice = pickFromTier(candidates, ctx.usage, ctx.rand);
  ctx.usage.set(choice.toLowerCase(), (ctx.usage.get(choice.toLowerCase()) ?? 0) + 1);
  ctx.changed++;
  const out = matchCase(word, choice);
  return isSentenceStart ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

/** Sostituisce, con probabilità scalata dal livello, un connettivo con un
 *  altro membro dello stesso gruppo semantico ancora poco usato. Opera a
 *  livello di stringa (case-insensitive, ai margini di parola) perché alcuni
 *  connettivi sono locuzioni ("ad esempio", "for instance"). */
function rotateConnectives(sentence: string, ctx: Ctx): string {
  const groups = CONNECTIVE_GROUPS[ctx.lang];
  let out = sentence;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    for (const phrase of group) {
      const re = new RegExp("\\b" + escapeRe(phrase) + "\\b", "i");
      const m = out.match(re);
      if (!m) continue;
      if (ctx.rand() > connProbability(ctx.structural)) break;
      const last = ctx.connLast.get(gi);
      const alt = group.filter((p) => p.toLowerCase() !== phrase.toLowerCase() && p.toLowerCase() !== (last ?? "").toLowerCase());
      const pool = alt.length ? alt : group.filter((p) => p.toLowerCase() !== phrase.toLowerCase());
      if (!pool.length) break;
      const choice = pickFromTier(pool, ctx.usage, ctx.rand);
      ctx.connLast.set(gi, choice.toLowerCase());
      ctx.usage.set(choice.toLowerCase(), (ctx.usage.get(choice.toLowerCase()) ?? 0) + 1);
      out = out.replace(re, matchCase(m[0], choice));
      ctx.changed++;
      break;
    }
  }
  return out;
}

/** Inverte due clausole coordinate simmetriche ("A, e B." -> "B, e A.").
 *  Limitato al connettivo "e"/"and", l'unico dove l'ordine non porta quasi
 *  mai un'implicazione logica/temporale (a differenza di "ma"/"but",
 *  "quindi"/"so", lasciati sempre nell'ordine originale). */
function reorderClauses(sentence: string, ctx: Ctx, force = false): string {
  if (!force && ctx.rand() > reorderProbability(ctx.structural)) return sentence;
  const re =
    ctx.lang === "it"
      ? /^([\s\S]{8,90}?),\s+e\s+([\s\S]{8,90}?)([.!?…]?)(\s*)$/u
      : /^([\s\S]{8,90}?),\s+and\s+([\s\S]{8,90}?)([.!?…]?)(\s*)$/u;
  const m = sentence.match(re);
  if (!m) return sentence;
  const [, a, b, term, trail] = m;
  // evita di invertire se una delle due parti contiene un segnaposto di
  // citazione/numero a cavallo del taglio: più sicuro lasciare invariato.
  if (a.includes(G_OPEN) && b.includes(G_OPEN)) {
    // entrambe hanno guardie: comunque sicuro (le guardie sono opache),
    // procedi normalmente.
  }
  const conj = ctx.lang === "it" ? "e" : "and";
  const bCap = b.charAt(0).toUpperCase() + b.slice(1);
  const aLow = a.charAt(0).toLowerCase() + a.slice(1);
  ctx.changed++;
  return `${bCap}, ${conj} ${aLow}${term}${trail}`;
}

/** Scinde in due frasi una frase lunga, per spezzare la cadenza quando il
 *  livello di trasformazione è alto. Preferisce il punto e virgola (sempre
 *  sicuro: unisce già due proposizioni autonome) e ricade sulla virgola
 *  seguita da una congiunzione coordinante. */
function splitLongSentence(sentence: string, ctx: Ctx): string {
  if (ctx.structural < 0.2) return sentence;
  const wc = (sentence.match(/[\p{L}\p{N}]+/gu) || []).length;
  const threshold = Math.round(30 - ctx.structural * 12); // 30..18 parole
  if (wc < threshold) return sentence;
  if (ctx.rand() > ctx.structural) return sentence;

  const semi = sentence.match(/;\s+/);
  if (semi && semi.index !== undefined) {
    const before = sentence.slice(0, semi.index);
    let after = sentence.slice(semi.index + semi[0].length);
    after = after.charAt(0).toUpperCase() + after.slice(1);
    ctx.changed++;
    return before.replace(/\s*$/, "") + ". " + after;
  }

  const conj = ctx.lang === "it" ? "e|ma|però|mentre|oppure|ovvero|nonché" : "and|but|while|or|nor";
  const re = new RegExp("([^,]{20,}),\\s+(" + conj + ")\\s+", "iu");
  const m = sentence.match(re);
  if (!m) return sentence;
  const idx = (m.index ?? 0) + m[1].length;
  const before = sentence.slice(0, idx).replace(/,\s*$/, "");
  const rest = sentence.slice(idx).replace(new RegExp("^,?\\s*(" + conj + ")\\s+", "iu"), "");
  const after = rest.charAt(0).toUpperCase() + rest.slice(1);
  ctx.changed++;
  return before.replace(/\s*$/, "") + ". " + after;
}

function transformSentence(rawSentence: string, ctx: Ctx): string {
  const [core, trail] = splitTrailingSpace(rawSentence);
  if (!core.trim()) return rawSentence;
  try {
    const tokens = tokenize(core);
    let wordIndex = 0;
    let firstWord = "";
    const rebuilt = tokens
      .map((tok) => {
        if (tok.kind !== "word") return tok.text;
        const isStart = wordIndex === 0;
        if (isStart) firstWord = tok.text.toLowerCase();
        const isProper = !isStart && /^\p{Lu}/u.test(tok.text) && tok.text.toLowerCase() !== tok.text;
        wordIndex++;
        return transformWord(tok.text, isStart, isProper, ctx);
      })
      .join("");

    // varietà degli incipit: se questa frase inizia come le precedenti con
    // un articolo/dimostrativo (mai nel lessico, quindi mai variato dalla
    // sostituzione lessicale), dopo due ripetizioni forza — se la struttura
    // lo permette — il riordino di clausole per cambiare la prima parola.
    const repeated = firstWord && firstWord === ctx.prevStart && CLOSED_STARTERS[ctx.lang].has(firstWord);
    ctx.repeatStartStreak = repeated ? ctx.repeatStartStreak + 1 : 0;
    const forceReorder = ctx.structural > 0 && ctx.repeatStartStreak >= 2;

    let out = rebuilt;
    out = rotateConnectives(out, ctx);
    out = reorderClauses(out, ctx, forceReorder);
    out = splitLongSentence(out, ctx);

    const newFirst = (out.match(/[\p{L}\p{N}'’-]+/u) || [""])[0].toLowerCase();
    ctx.prevStart = newFirst;
    if (newFirst !== firstWord) ctx.repeatStartStreak = 0; // il riordino (o altro) ha già variato l'incipit

    return out + trail;
  } catch (e) {
    ctx.warnings.push("Frase saltata per un errore interno: restituita invariata.");
    return rawSentence;
  }
}

function transformParagraphBody(body: string, ctx: Ctx): string {
  const sentences = segmentSentences(body);
  return sentences.map((s) => transformSentence(s, ctx)).join("");
}

/* ------------------------------ similarity ------------------------------ */
function contentWordBag(text: string, lang: PLang): Map<string, number> {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []) as string[];
  const bag = new Map<string, number>();
  for (const w of words) {
    if (STOPWORDS[lang].has(w)) continue;
    bag.set(w, (bag.get(w) ?? 0) + 1);
  }
  return bag;
}

function weightedJaccard(a: Map<string, number>, b: Map<string, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  if (!keys.size) return 1;
  let inter = 0;
  let union = 0;
  for (const k of keys) {
    const av = a.get(k) ?? 0;
    const bv = b.get(k) ?? 0;
    inter += Math.min(av, bv);
    union += Math.max(av, bv);
  }
  return union === 0 ? 1 : inter / union;
}

/** Corregge l'elisione dell'articolo quando una sostituzione lessicale
 *  introduce una parola che inizia per vocale dopo "il/lo/la/una"
 *  (es. "il inconveniente" → "l'inconveniente"). Tocca solo l'articolo,
 *  mai il contenuto: sicura da applicare sull'intero testo già ricomposto. */
function fixItalianElision(text: string): string {
  return text
    .replace(/\b(Il|il|Lo|lo|La|la)\s+(?=[aeiouAEIOUàèéìòù])/gu, (_m, art: string) => (/^[A-Z]/.test(art) ? "L'" : "l'"))
    .replace(/\b(Una|una)\s+(?=[aeiouAEIOUàèéìòù])/gu, (_m, art: string) => (/^[A-Z]/.test(art) ? "Un'" : "un'"));
}

/* ================================ API ================================ */
export function paraphrase(source: string, opts: ParaphraseOptions = {}): ParaphraseResult {
  const lang: PLang = opts.lang ?? "it";
  const level = Math.max(0, Math.min(1, opts.level ?? 0.5));
  const lexical = Math.max(0, Math.min(1, opts.lexicalIntensity ?? level));
  const structural = Math.max(0, Math.min(1, opts.structuralIntensity ?? level));
  const protectTerms = opts.protectTerms ?? [];
  const warnings: string[] = [];

  if (!source || !source.trim()) {
    return { text: source ?? "", changedRatio: 0, similarity: 1, warnings: [] };
  }

  try {
    const seed = opts.seed ?? hashSeed(source + "|" + lang);
    const store = new GuardStore();
    const guardRe = buildGuardRegex(protectTerms);
    let guarded: string;
    try {
      guarded = source.replace(guardRe, (m) => store.add(m));
    } catch (e) {
      warnings.push("Impossibile applicare le protezioni: procedo senza sostituzioni lessicali sensibili.");
      guarded = source;
    }

    const ctx: Ctx = {
      lang,
      lexical,
      structural,
      rand: mulberry32(seed),
      usage: new Map(),
      connLast: new Map(),
      warnings,
      changed: 0,
      totalWords: 0,
      prevStart: "",
      repeatStartStreak: 0,
    };

    const lines = guarded.split("\n");
    const outLines: string[] = [];
    let inFence = false;
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        outLines.push(line);
        continue;
      }
      if (inFence || /^\s*$/.test(line)) {
        outLines.push(line);
        continue;
      }
      try {
        const [prefix, body] = splitLinePrefix(line);
        if (!body.trim()) {
          outLines.push(line);
          continue;
        }
        outLines.push(prefix + transformParagraphBody(body, ctx));
      } catch (e) {
        warnings.push("Riga saltata per un errore interno: restituita invariata.");
        outLines.push(line);
      }
    }

    let result = store.restore(outLines.join("\n"));
    if (!store.isClean(result)) {
      warnings.push("Rilevato un segnaposto di protezione non ripristinato: restituito il testo originale per sicurezza.");
      return { text: source, changedRatio: 0, similarity: 1, warnings };
    }
    if (lang === "it" && lexical > 0) result = fixItalianElision(result);

    const changedRatio = ctx.totalWords > 0 ? Math.min(1, ctx.changed / ctx.totalWords) : 0;
    const similarity = weightedJaccard(contentWordBag(source, lang), contentWordBag(result, lang));

    return { text: result, changedRatio, similarity, warnings };
  } catch (e) {
    return {
      text: source,
      changedRatio: 0,
      similarity: 1,
      warnings: ["Errore interno del riformulatore: restituito il testo originale invariato."],
    };
  }
}
