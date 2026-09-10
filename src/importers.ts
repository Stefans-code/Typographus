/* =========================================================================
   Import: Markdown (.md), plain text (.txt), Word (.docx via mammoth),
   PDF (.pdf via pdf.js — heuristic reconstruction, see importPdf below).
   All client-side, fully offline: no native/Python dependency.
   ========================================================================= */

import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ImportResult {
  title: string;
  source: string;
  note?: string;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** PDF → Markdown, heuristic (no OCR, no formula recognition): groups text
 *  items into lines by vertical position, then classifies each line as a
 *  heading or body text by comparing its font size to the document's median
 *  body size. Good enough for plain reports/theses; tables, multi-column
 *  layouts and mathematical notation are not reconstructed — review the
 *  result before relying on it. */
async function importPdf(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;

  type Line = { text: string; size: number };
  const lines: Line[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map<number, { parts: string[]; size: number }>();
    for (const item of content.items as { str?: string; transform?: number[] }[]) {
      const str = item.str;
      if (!str || !str.trim() || !item.transform) continue;
      const size = Math.hypot(item.transform[0], item.transform[1]) || item.transform[3] || 12;
      const yKey = Math.round(item.transform[5] / 2) * 2; // bucket nearby baselines together
      const bucket = byY.get(yKey) ?? { parts: [], size };
      bucket.parts.push(str);
      byY.set(yKey, bucket);
    }
    // PDF y-coordinates grow upward: sort descending for reading order (top → bottom).
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      const { parts, size } = byY.get(y)!;
      const text = parts.join(" ").replace(/\s+/g, " ").trim();
      if (text) lines.push({ text, size });
    }
    if (p < doc.numPages) lines.push({ text: "", size: 0 }); // page break → paragraph break
  }

  // Body size = the font size with the most characters set in it (not the
  // median line size — a short document can have as many heading lines as
  // body lines, which skews a naive median toward the heading size).
  const charsBySize = new Map<number, number>();
  for (const l of lines) if (l.size) charsBySize.set(l.size, (charsBySize.get(l.size) ?? 0) + l.text.length);
  let bodySize = 12;
  let bestChars = -1;
  for (const [size, chars] of charsBySize) {
    if (chars > bestChars) {
      bestChars = chars;
      bodySize = size;
    }
  }

  const mdLines = lines.map((l) => {
    if (!l.text) return "";
    const ratio = l.size / bodySize;
    if (ratio >= 1.5) return `# ${l.text}`;
    if (ratio >= 1.2) return `## ${l.text}`;
    return l.text;
  });

  // merge consecutive body lines into paragraphs; headings stay on their own line
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(para.join(" "));
    para = [];
  };
  for (const ln of mdLines) {
    if (!ln) flush();
    else if (ln.startsWith("#")) {
      flush();
      out.push(ln);
    } else para.push(ln);
  }
  flush();

  return {
    title: baseName(file.name),
    source: out.join("\n\n"),
    note: "PDF importato con estrazione euristica (titoli riconosciuti dalla dimensione del carattere): rivedi la struttura — tabelle, colonne multiple e formule non vengono ricostruite.",
  };
}

export async function importFile(file: File): Promise<ImportResult> {
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (ext === "pdf") return importPdf(file);

  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    // convertToMarkdown exists at runtime but is absent from the shipped types.
    const result = await (mammoth as unknown as {
      convertToMarkdown: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string; messages: unknown[] }>;
    }).convertToMarkdown({ arrayBuffer });
    return {
      title: baseName(file.name),
      source: result.value.trim(),
      note: result.messages.length
        ? `DOCX importato con ${result.messages.length} avvisi di conversione.`
        : "DOCX importato.",
    };
  }

  const text = await file.text();
  if (ext === "txt") {
    // Normalize hard-wrapped plain text into Markdown paragraphs:
    // blank lines separate paragraphs; single newlines are soft wraps.
    const source = text
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map((para) => para.replace(/\n/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
    return { title: baseName(file.name), source, note: "Testo semplice importato." };
  }

  // .md / .markdown / fallback
  return { title: baseName(file.name), source: text.replace(/\r\n/g, "\n").trim() };
}
