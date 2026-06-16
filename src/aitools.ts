/* =========================================================================
   AI tools — fully local & offline.
   1) Rilevatore: stima euristica "Umano % / AI %" da segnali stilometrici.
   2) Riscrittore: parafrasi basata su regole (umanizza / semplifica / formale).

   NOTA: nessun modello neurale e nessuna rete. Sono euristiche stilometriche
   trasparenti (non probatorie). Funzionano interamente in locale.
   ========================================================================= */

export type Lang = "it" | "en";

/* ---- AI cliché / connective phrases (over-represented in LLM prose) ---- */
const CLICHE: Record<Lang, string[]> = {
  it: [
    "in conclusione", "in sintesi", "è importante notare", "è importante sottolineare",
    "vale la pena notare", "in questo articolo", "in questo contesto", "d'altra parte",
    "in primo luogo", "in secondo luogo", "inoltre", "tuttavia", "pertanto", "di conseguenza",
    "in definitiva", "nel mondo di oggi", "nell'era digitale", "gioca un ruolo", "un ruolo cruciale",
    "è fondamentale", "non solo", "ma anche", "in altre parole", "approfondiamo", "esploriamo",
    "ricca esperienza", "in continua evoluzione", "punto di svolta", "sfruttare", "ecosistema",
  ],
  en: [
    "in conclusion", "in summary", "it is important to note", "it's important to note",
    "it is worth noting", "in this article", "in today's world", "in the digital age",
    "plays a crucial role", "a wide range of", "delve", "dive into", "moreover", "furthermore",
    "however", "therefore", "as a result", "on the other hand", "firstly", "secondly",
    "not only", "but also", "in other words", "leverage", "ecosystem", "game-changer",
    "navigating the", "ever-evolving", "rich tapestry", "underscore", "robust",
  ],
};

/* very common words → "predictability" proxy */
const COMMON: Record<Lang, Set<string>> = {
  it: new Set(
    "il lo la i gli le un uno una di a da in con su per tra fra e o ma se che chi cui non più come anche dove quando perché questo questa questi queste è sono era essere ha hanno del della dei delle al alla ai alle".split(
      " "
    )
  ),
  en: new Set(
    "the a an of to in on for with and or but if that which who this these those is are was be has have it its as at by from not more most as well also into".split(
      " "
    )
  ),
};

export interface AiSignal {
  label: string;
  detail: string;
  value: number; // 0–100 "AI-ness" for this signal
  weight: number;
}

export interface AiResult {
  aiScore: number;
  humanScore: number;
  verdict: string;
  signals: AiSignal[];
  words: number;
  reliable: boolean;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}
function wordsOf(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []) as string[];
}
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const mapRange = (x: number, a: number, b: number) => clamp(((x - a) / (b - a)) * 100);

export function detectAI(text: string, lang: Lang = "it"): AiResult {
  const clean = text.replace(/`{1,3}[^`]*`{1,3}/g, " ").trim();
  const sentences = splitSentences(clean);
  const words = wordsOf(clean);
  const wc = words.length;

  if (wc < 40) {
    return {
      aiScore: 0,
      humanScore: 0,
      verdict: "Testo troppo breve per una stima affidabile (min. ~40 parole).",
      signals: [],
      words: wc,
      reliable: false,
    };
  }

  /* 1) Burstiness — varianza della lunghezza delle frasi (umano = alta) */
  const lens = sentences.map((s) => wordsOf(s).length).filter((n) => n > 0);
  const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length || 1);
  const cv = mean ? Math.sqrt(variance) / mean : 0; // coefficient of variation
  // cv basso ⇒ ritmo uniforme ⇒ più "AI"
  const sigUniform = clamp(mapRange(0.62 - cv, 0, 0.5));

  /* 2) Cliché / connettivi tipici da LLM */
  const lc = " " + clean.toLowerCase() + " ";
  let clicheHits = 0;
  for (const p of CLICHE[lang]) {
    const re = new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
    clicheHits += (lc.match(re) || []).length;
  }
  const clichePer100 = (clicheHits / wc) * 100;
  const sigCliche = clamp(clichePer100 * 22);

  /* 3) Ripetitività — incipit di frase ripetuti + trigrammi ripetuti */
  const starts = sentences.map((s) => wordsOf(s).slice(0, 3).join(" ")).filter(Boolean);
  const dupStarts = starts.length - new Set(starts).size;
  const trigrams: Record<string, number> = {};
  for (let i = 0; i < words.length - 2; i++) {
    const t = words[i] + " " + words[i + 1] + " " + words[i + 2];
    trigrams[t] = (trigrams[t] || 0) + 1;
  }
  const repeatedTri = Object.values(trigrams).filter((n) => n > 1).length;
  const sigRepeat = clamp((dupStarts / Math.max(1, sentences.length)) * 240 + (repeatedTri / Math.max(1, wc)) * 600);

  /* 4) Lessico prevedibile — quota di parole molto comuni + povertà di hapax */
  const commonCount = words.filter((w) => COMMON[lang].has(w)).length;
  const commonRatio = commonCount / wc;
  const unique = new Set(words).size;
  const ttr = unique / wc; // type-token ratio
  const sigPredict = clamp(mapRange(commonRatio, 0.3, 0.62) * 0.6 + mapRange(0.62 - ttr, 0, 0.45) * 0.4);

  /* 5) Lunghezza media nella "fascia LLM" (frasi medio-lunghe e regolari) */
  const sigBand = clamp(mean >= 16 && mean <= 26 ? 70 - Math.abs(mean - 21) * 4 : 25);

  const signals: AiSignal[] = [
    { label: "Uniformità ritmica", detail: "Bassa varianza nella lunghezza delle frasi", value: Math.round(sigUniform), weight: 0.32 },
    { label: "Frasi cliché AI", detail: `${clicheHits} espressioni tipiche da LLM`, value: Math.round(sigCliche), weight: 0.26 },
    { label: "Ripetitività", detail: "Incipit e trigrammi ricorrenti", value: Math.round(sigRepeat), weight: 0.18 },
    { label: "Lessico prevedibile", detail: "Alta frequenza di parole comuni", value: Math.round(sigPredict), weight: 0.16 },
    { label: "Cadenza delle frasi", detail: `Media ${mean.toFixed(0)} parole/frase`, value: Math.round(sigBand), weight: 0.08 },
  ];

  const aiScore = Math.round(signals.reduce((a, s) => a + s.value * s.weight, 0));
  const humanScore = 100 - aiScore;
  const verdict =
    aiScore >= 70
      ? "Probabilmente generato o fortemente assistito da AI"
      : aiScore >= 45
      ? "Segnali misti: possibile assistenza AI"
      : aiScore >= 25
      ? "Prevalentemente umano con tratti regolari"
      : "Probabilmente scritto da una persona";

  return { aiScore, humanScore, verdict, signals, words: wc, reliable: true };
}

/* ============================ REWRITER ============================ */
export type RewriteMode = "humanize" | "simplify" | "formal";

/* cliché → sostituzioni più naturali (o rimozione) */
const CLICHE_FIX: Record<Lang, [RegExp, string][]> = {
  it: [
    [/\bin conclusione,?\s*/gi, ""],
    [/\bin sintesi,?\s*/gi, ""],
    [/\bè importante (notare|sottolineare) che\s*/gi, ""],
    [/\bvale la pena notare che\s*/gi, ""],
    [/\bdi conseguenza\b/gi, "così"],
    [/\bpertanto\b/gi, "quindi"],
    [/\btuttavia\b/gi, "ma"],
    [/\binoltre\b/gi, "e poi"],
    [/\bin primo luogo\b/gi, "prima"],
    [/\bin secondo luogo\b/gi, "poi"],
    [/\bsfruttare\b/gi, "usare"],
    [/\bin continua evoluzione\b/gi, "che cambia in fretta"],
  ],
  en: [
    [/\bin conclusion,?\s*/gi, ""],
    [/\bin summary,?\s*/gi, ""],
    [/\bit('s| is) important to note that\s*/gi, ""],
    [/\bit('s| is) worth noting that\s*/gi, ""],
    [/\bmoreover\b/gi, "also"],
    [/\bfurthermore\b/gi, "and"],
    [/\bhowever\b/gi, "but"],
    [/\btherefore\b/gi, "so"],
    [/\bas a result\b/gi, "so"],
    [/\bleverage\b/gi, "use"],
    [/\bdelve into\b/gi, "look at"],
    [/\butilize\b/gi, "use"],
  ],
};

/* sinonimi per semplificazione (parola complessa → semplice) */
const SIMPLIFY: Record<Lang, [RegExp, string][]> = {
  it: [
    [/\butilizzare\b/gi, "usare"],
    [/\beffettuare\b/gi, "fare"],
    [/\bmodalità\b/gi, "modo"],
    [/\bal fine di\b/gi, "per"],
    [/\bnonostante ciò\b/gi, "comunque"],
    [/\bin virtù di\b/gi, "grazie a"],
    [/\bmedesimo\b/gi, "stesso"],
    [/\bottenere\b/gi, "avere"],
  ],
  en: [
    [/\butilize\b/gi, "use"],
    [/\bin order to\b/gi, "to"],
    [/\bcommence\b/gi, "start"],
    [/\bterminate\b/gi, "end"],
    [/\bnumerous\b/gi, "many"],
    [/\bobtain\b/gi, "get"],
    [/\bapproximately\b/gi, "about"],
  ],
};

/* informale → formale */
const FORMALIZE: Record<Lang, [RegExp, string][]> = {
  it: [
    [/\bun sacco di\b/gi, "molti"],
    [/\bun po'\b/gi, "leggermente"],
    [/\bfare i conti con\b/gi, "affrontare"],
    [/\bgrande\b/gi, "rilevante"],
    [/\bcosì\b/gi, "pertanto"],
  ],
  en: [
    [/\ba lot of\b/gi, "numerous"],
    [/\bkind of\b/gi, "somewhat"],
    [/\bget\b/gi, "obtain"],
    [/\bbig\b/gi, "significant"],
    [/\bso\b/gi, "therefore"],
  ],
};

function preserveMarkdownPrefix(line: string): [string, string] {
  const m = line.match(/^(\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)?)([\s\S]*)$/);
  return m ? [m[1], m[2]] : ["", line];
}

function applyMap(text: string, map: [RegExp, string][]): string {
  let out = text;
  for (const [re, rep] of map) out = out.replace(re, rep);
  return out;
}

/* split very long sentences for "humanize" */
function varySentences(text: string): string {
  return text.replace(/([^.!?…]{140,}?),\s+(e|ma|che|però|mentre|and|but|while)\s+/gi, "$1. ");
}

function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])\s*([a-zàèéìòù])/g, (_m, p, c) => p + " " + c.toUpperCase())
    .replace(/^\s*([a-zàèéìòù])/, (_m, c) => c.toUpperCase())
    .trim();
}

export function rewrite(source: string, mode: RewriteMode, lang: Lang = "it"): string {
  const lines = source.split("\n");
  return lines
    .map((line) => {
      if (/^```/.test(line) || /^\s*$/.test(line)) return line; // code fences / blank
      const [prefix, body] = preserveMarkdownPrefix(line);
      if (!body.trim()) return line;
      // skip inline-code-only or link-heavy lines lightly
      let out = body;
      if (mode === "humanize") {
        out = applyMap(out, CLICHE_FIX[lang]);
        out = varySentences(out);
      } else if (mode === "simplify") {
        out = applyMap(out, CLICHE_FIX[lang]);
        out = applyMap(out, SIMPLIFY[lang]);
        out = varySentences(out);
      } else {
        out = applyMap(out, FORMALIZE[lang]);
      }
      out = tidy(out);
      return prefix + out;
    })
    .join("\n");
}
