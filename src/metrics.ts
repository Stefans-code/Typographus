/* =========================================================================
   Editorial metrics: readability (Gulpease / Flesch), reading time,
   sentence statistics and copyfitting (does the piece fit the space?).
   ========================================================================= */

import type { Settings } from "./state";
import { PAGE_PRESETS } from "./state";

export interface Analysis {
  words: number;
  characters: number; // letters in words
  charactersAll: number; // incl. spaces
  sentences: number;
  paragraphs: number;
  avgWordsPerSentence: number;
  avgCharsPerWord: number;
  gulpease: number;
  gulpeaseLabel: string;
  gulpeaseAudience: string;
  flesch: number;
  fleschLabel: string;
  readingMin: number; // silent reading
  speakingMin: number; // spoken aloud
}

function countSyllablesEN(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}
/* Italian vowel-group syllable estimate (good enough for indices) */
function countSyllablesIT(word: string): number {
  const w = word.toLowerCase();
  const groups = w.match(/[aeiouàèéìòùy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function analyze(text: string, lang: "it" | "en" = "it"): Analysis {
  const clean = text.replace(/\s+/g, " ").trim();
  const wordTokens = clean.length ? clean.split(/\s+/) : [];
  const words = wordTokens.length;
  const characters = wordTokens.join("").replace(/[^\p{L}\p{N}]/gu, "").length;
  const charactersAll = clean.length;
  const sentences = Math.max(1, (text.match(/[.!?…]+(\s|$)/g) || []).length);
  const paragraphs = Math.max(1, (text.split(/\n{2,}/).filter((p) => p.trim()).length));

  const syllCounter = lang === "it" ? countSyllablesIT : countSyllablesEN;
  const syllables = wordTokens.reduce((a, w) => a + syllCounter(w), 0);

  const avgWordsPerSentence = words ? words / sentences : 0;
  const avgCharsPerWord = words ? characters / words : 0;

  /* Indice Gulpease (Italian): 89 + (300·frasi − 10·lettere) / parole */
  const gulpease = words
    ? Math.max(0, Math.min(100, Math.round(89 + (300 * sentences - 10 * characters) / words)))
    : 0;

  /* Flesch Reading Ease (works generically) */
  const flesch = words
    ? Math.round(206.835 - 1.015 * avgWordsPerSentence - 84.6 * (syllables / words))
    : 0;

  return {
    words,
    characters,
    charactersAll,
    sentences,
    paragraphs,
    avgWordsPerSentence: round1(avgWordsPerSentence),
    avgCharsPerWord: round1(avgCharsPerWord),
    gulpease,
    gulpeaseLabel: gulpeaseLabel(gulpease),
    gulpeaseAudience: gulpeaseAudience(gulpease),
    flesch,
    fleschLabel: fleschLabel(flesch),
    readingMin: words / 200, // ~200 wpm silent reading
    speakingMin: words / 150, // ~150 wpm read aloud
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function gulpeaseLabel(g: number): string {
  if (g >= 80) return "Molto facile";
  if (g >= 60) return "Facile";
  if (g >= 40) return "Medio";
  if (g >= 20) return "Difficile";
  return "Molto difficile";
}
function gulpeaseAudience(g: number): string {
  if (g >= 80) return "Leggibile con licenza elementare";
  if (g >= 60) return "Leggibile con licenza media";
  if (g >= 40) return "Leggibile con diploma superiore";
  return "Richiede istruzione universitaria";
}
function fleschLabel(f: number): string {
  if (f >= 90) return "Molto facile";
  if (f >= 70) return "Facile";
  if (f >= 50) return "Discreta";
  if (f >= 30) return "Complessa";
  return "Molto complessa";
}

/* ---- Copyfitting: estimate printed extent independent of pagination ---- */
export interface CopyfitEstimate {
  estPages: number;
  charsPerLine: number;
  linesPerPage: number;
  fillPct: number; // of one page text block, last page
}

export function estimateExtent(charactersAll: number, settings: Settings): CopyfitEstimate {
  const preset = settings.pageSize === "Custom" ? null : PAGE_PRESETS[settings.pageSize];
  let pw = preset ? preset.w : settings.pageW;
  let ph = preset ? preset.h : settings.pageH;
  if (settings.orientation === "landscape") [pw, ph] = [ph, pw];

  const textWmm = pw - settings.marginLeft - settings.marginRight;
  const textHmm = ph - settings.marginTop - settings.marginBottom;

  // mm → pt
  const mmToPt = 72 / 25.4;
  const colWpt = ((textWmm * mmToPt) / settings.columns) - (settings.columns - 1) * 4;
  const textHpt = textHmm * mmToPt;

  const avgCharWidthPt = settings.bodySize * 0.5; // average glyph advance
  const charsPerLine = Math.max(10, Math.floor(colWpt / avgCharWidthPt));
  const lineHeightPt = settings.bodySize * settings.leading;
  const linesPerCol = Math.max(1, Math.floor(textHpt / lineHeightPt));
  const linesPerPage = linesPerCol * settings.columns;

  const totalLines = charactersAll / charsPerLine;
  const estPages = Math.max(1, totalLines / linesPerPage);
  const lastPageLines = totalLines % linesPerPage;
  const fillPct = Math.round((lastPageLines / linesPerPage) * 100);

  return {
    estPages: Math.round(estPages * 10) / 10,
    charsPerLine,
    linesPerPage,
    fillPct: estPages < 1 ? Math.round(estPages * 100) : fillPct,
  };
}
