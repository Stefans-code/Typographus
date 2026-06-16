/* =========================================================================
   Import: Markdown (.md), plain text (.txt), Word (.docx via mammoth).
   ========================================================================= */

import mammoth from "mammoth";

export interface ImportResult {
  title: string;
  source: string;
  note?: string;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export async function importFile(file: File): Promise<ImportResult> {
  const ext = (file.name.split(".").pop() || "").toLowerCase();

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
