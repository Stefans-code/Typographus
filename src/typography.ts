/* =========================================================================
   Markdown → editorial HTML compiler with typographic refinements.
   Custom extensions: front-matter masthead, :::pullquote, figures with
   caption/credit, footnotes, lead paragraph + drop cap, smart typography.
   ========================================================================= */

import { marked } from "marked";
import type { EditorialMeta, FrontMatter, Reference, Settings } from "./state";
import { FONT_STACKS } from "./paginate";

marked.setOptions({ gfm: true, breaks: false });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---- Smart typography (IT/EN aware) ---- */
export function smartTypography(input: string): string {
  let s = input;
  s = s.replace(/---/g, "—"); // em dash
  s = s.replace(/(?<!-)--(?!-)/g, "–"); // en dash
  s = s.replace(/\.\.\./g, "…"); // ellipsis
  // double quotes
  s = s.replace(/(^|[\s(\[{<—–])"/g, "$1“");
  s = s.replace(/"/g, "”");
  // single quotes / apostrophes
  s = s.replace(/(^|[\s(\[{<])'/g, "$1‘");
  s = s.replace(/'/g, "’");
  // thin nbsp before high punctuation common in IT/FR typography
  s = s.replace(/ ([;:!?])/g, " $1");
  return s;
}

/* Walk text nodes (skipping code/pre) and apply smart typography. */
function applySmartToDom(root: ParentNode) {
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = (node as Text).parentElement;
      if (p && (p.closest("code") || p.closest("pre"))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const texts: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) texts.push(n as Text);
  for (const t of texts) t.nodeValue = smartTypography(t.nodeValue ?? "");
}

interface CompileResult {
  html: string;
  footnoteCount: number;
  imageCount: number;
  citationCount: number;
}

export interface CompileExtra {
  references?: Reference[];
  meta?: EditorialMeta;
}

export function compile(
  source: string,
  front: FrontMatter,
  settings: Settings,
  extra: CompileExtra = {}
): CompileResult {
  let src = source;
  const references = extra.references ?? [];
  const refByKey = new Map(references.map((r) => [r.key, r]));

  /* 1. Extract footnote definitions: [^id]: text */
  const defs = new Map<string, string>();
  src = src.replace(/^\[\^([^\]]+)\]:\s+(.+)$/gm, (_m, id, text) => {
    defs.set(String(id), String(text).trim());
    return "";
  });

  /* 2. Number + replace footnote references in order of appearance */
  const order: string[] = [];
  src = src.replace(/\[\^([^\]]+)\]/g, (_m, id) => {
    const key = String(id);
    if (!order.includes(key)) order.push(key);
    const num = order.indexOf(key) + 1;
    return `<sup class="fn"><a id="fnref-${num}" href="#fn-${num}">${num}</a></sup>`;
  });

  /* 2.5 Citations [@key] → (Author, Year) linked to the bibliography */
  const cited: string[] = [];
  src = src.replace(/\[@([A-Za-z0-9_:.-]+)\]/g, (_m, key) => {
    const k = String(key);
    const ref = refByKey.get(k);
    if (!ref) return `<span class="cite cite-missing">[@${esc(k)}]</span>`;
    if (!cited.includes(k)) cited.push(k);
    const who = shortAuthor(ref.author);
    return `<a class="cite" href="#ref-${esc(k)}">(${esc(who)}${ref.year ? " " + esc(ref.year) : ""})</a>`;
  });

  /* 2.8 Inline styling: [text]{color: val; font: val; bg: val; size: val; decoration: val; weight: val; style: val} */
  src = src.replace(/\[([^\]]+)\]\{([^\}]+)\}/g, (_m, text, styleStr) => {
    const styles = styleStr.split(";").map((s) => s.trim()).filter(Boolean);
    let cssStyle = "";
    for (const style of styles) {
      const parts = style.split(":");
      if (parts.length < 2) continue;
      const key = parts[0].trim().toLowerCase();
      const val = parts.slice(1).join(":").trim();
      if (key === "color") {
        cssStyle += `color:${val};`;
      } else if (key === "font" || key === "font-family") {
        const stack = FONT_STACKS[val] || val;
        cssStyle += `font-family:${stack};`;
      } else if (key === "bg" || key === "background" || key === "background-color") {
        cssStyle += `background-color:${val};`;
      } else if (key === "size" || key === "font-size") {
        cssStyle += `font-size:${val};`;
      } else if (key === "decoration" || key === "text-decoration") {
        cssStyle += `text-decoration:${val};`;
      } else if (key === "weight" || key === "font-weight") {
        cssStyle += `font-weight:${val};`;
      } else if (key === "style" || key === "font-style") {
        cssStyle += `font-style:${val};`;
      }
    }
    return `<span style="${cssStyle}">${text}</span>`;
  });

  /* 3. Pull-quote fences :::pullquote ... ::: */
  src = src.replace(/^:::pullquote\s*\n([\s\S]*?)\n:::\s*$/gm, (_m, inner) => {
    const html = marked.parseInline(String(inner).trim()) as string;
    return `\n<aside class="pullquote">${html}</aside>\n`;
  });

  /* 4. Base markdown → HTML */
  const rawHtml = marked.parse(src) as string;

  /* 5. DOM post-processing */
  const doc = new DOMParser().parseFromString(`<div id="root">${rawHtml}</div>`, "text/html");
  const root = doc.getElementById("root")!;

  /* 5a. Convert lone-image paragraphs into <figure> with caption/credit */
  let imageCount = 0;
  root.querySelectorAll("p").forEach((p) => {
    const imgs = p.querySelectorAll("img");
    if (imgs.length === 1 && p.textContent?.trim() === "") {
      const img = imgs[0];
      imageCount++;
      const title = img.getAttribute("title") ?? img.getAttribute("alt") ?? "";
      const [captionRaw, creditRaw] = title.split("|").map((x) => x.trim());
      const fig = doc.createElement("figure");
      const src0 = img.getAttribute("src") ?? "";
      if (!src0 || src0 === "placeholder" || src0.startsWith("placeholder")) {
        const ph = doc.createElement("div");
        ph.className = "img-placeholder";
        ph.textContent = "▣  immagine ancorata al testo";
        fig.appendChild(ph);
      } else {
        img.removeAttribute("title");
        fig.appendChild(img.cloneNode(true));
      }
      if (captionRaw) {
        const cap = doc.createElement("figcaption");
        cap.innerHTML = esc(captionRaw);
        if (creditRaw) {
          const cr = doc.createElement("span");
          cr.className = "credit";
          cr.textContent = " " + creditRaw;
          cap.appendChild(cr);
        }
        fig.appendChild(cap);
      }
      p.replaceWith(fig);
    }
  });

  /* 5b. Lead paragraph (first paragraph) */
  const firstP = root.querySelector("p");
  if (firstP) firstP.classList.add("lead", "first");

  /* 5c. Smart typography */
  if (settings.smart) applySmartToDom(root);

  /* 5d. Make block elements editable for on-page preview editing */
  root.querySelectorAll("p, h2, h3, h4, li, blockquote").forEach((el) => {
    el.setAttribute("contenteditable", "true");
    el.setAttribute("data-body-block", "true");
    el.setAttribute("spellcheck", "false");
  });

  /* 6. Footnotes block */
  let footnotesHtml = "";
  if (order.length) {
    const items = order
      .map((id, i) => {
        const num = i + 1;
        const text = defs.get(id) ?? "<em>nota mancante</em>";
        const t = settings.smart ? smartTypography(text) : text;
        return `<li id="fn-${num}"><a href="#fnref-${num}" class="fn-back">${num}.</a> ${marked.parseInline(t)}</li>`;
      })
      .join("");
    footnotesHtml = `<section class="doc-notes"><h3 class="notes-title">Note</h3><ol class="notes">${items}</ol></section>`;
  }

  /* 6b. Bibliography (academic publishing) */
  const bibliographyHtml = buildBibliography(references, settings);

  /* 6c. Colophon (book publishing) */
  const colophonHtml = extra.meta?.genColophon ? buildColophon(extra.meta, front, settings) : "";

  /* 7. Masthead from front-matter */
  const mast = buildMasthead(front, settings);

  const flowClass = `doc-flow`;
  const html = `${mast}<div class="${flowClass}">${root.innerHTML}</div>${footnotesHtml}${bibliographyHtml}${colophonHtml}`;

  return { html, footnoteCount: order.length, imageCount, citationCount: cited.length };
}

function shortAuthor(author: string): string {
  if (!author) return "s.n.";
  // "Cognome, Nome" → "Cognome"; "Nome Cognome" → last word
  if (author.includes(",")) return author.split(",")[0].trim();
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function buildBibliography(refs: Reference[], settings: Settings): string {
  const valid = refs.filter((r) => r.author || r.title);
  if (!valid.length) return "";
  const sm = (s: string) => (settings.smart ? smartTypography(s) : s);
  const sorted = [...valid].sort((a, b) => shortAuthor(a.author).localeCompare(shortAuthor(b.author)));
  const items = sorted
    .map((r) => {
      const lead = [r.author, r.year ? `(${r.year})` : ""].filter(Boolean).map(esc).join(" ");
      const parts = [
        lead,
        r.title ? `<i>${esc(sm(r.title))}</i>` : "",
        r.publisher ? esc(r.publisher) : "",
      ].filter(Boolean);
      return `<li id="ref-${esc(r.key)}" class="ref-entry">${parts.join(". ")}.</li>`;
    })
    .join("");
  return `<section class="doc-bibliography"><h3 class="notes-title">Bibliografia</h3><ul class="references">${items}</ul></section>`;
}

function buildColophon(meta: EditorialMeta, front: FrontMatter, settings: Settings): string {
  const sm = (s: string) => (settings.smart ? smartTypography(s) : s);
  const rows: string[] = [];
  if (front.headline) rows.push(`<div class="colo-title">${esc(sm(front.headline))}</div>`);
  if (meta.edition) rows.push(`<div>${esc(meta.edition)}</div>`);
  if (meta.publisher) rows.push(`<div>${esc(meta.publisher)}${meta.collection ? " · " + esc(meta.collection) : ""}</div>`);
  if (meta.isbn) rows.push(`<div>ISBN ${esc(meta.isbn)}</div>`);
  const cp = meta.copyright || (meta.year ? `© ${esc(meta.year)}` : "");
  if (cp) rows.push(`<div>${esc(cp)}</div>`);
  if (meta.rights) rows.push(`<div class="colo-rights">${esc(meta.rights)}</div>`);
  if (!rows.length) return "";
  return `<section class="colophon"><div class="colophon-mark">✳</div>${rows.join("")}</section>`;
}

function buildMasthead(front: FrontMatter, settings: Settings): string {
  const sm = (s: string) => (settings.smart ? smartTypography(s) : s);
  const kicker = front.kicker || "Occhiello";
  const headline = front.headline || "Titolo principale";
  const deck = front.deck || "Sommario dell'articolo";
  const author = front.author || "Nome dell'autore";
  
  return `
  <header class="masthead">
    <div class="kicker ${!front.kicker ? "is-empty" : ""}" contenteditable="true" data-field="kicker" spellcheck="false">${esc(kicker)}</div>
    <h1 class="headline ${!front.headline ? "is-empty" : ""}" contenteditable="true" data-field="headline" spellcheck="false">${esc(sm(headline))}</h1>
    <p class="deck ${!front.deck ? "is-empty" : ""}" contenteditable="true" data-field="deck" spellcheck="false">${esc(sm(deck))}</p>
    <div class="byline">
      <span><b class="${!front.author ? "is-empty" : ""}" contenteditable="true" data-field="author" spellcheck="false">${esc(author)}</b></span>
      ${front.dateline ? `<span>${esc(front.dateline)}</span>` : `<span>${esc(new Date().toLocaleDateString("it"))}</span>`}
    </div>
  </header>`;
}

/* Plain text extraction for metrics (strips markdown + front-matter refs) */
export function toPlainText(source: string): string {
  let s = source;
  s = s.replace(/^\[\^([^\]]+)\]:\s+.+$/gm, ""); // footnote defs
  s = s.replace(/:::pullquote\s*\n([\s\S]*?)\n:::/gm, "$1");
  s = s.replace(/`{1,3}[^`]*`{1,3}/g, " "); // inline/block code
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // images
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → text
  s = s.replace(/\[\^[^\]]+\]/g, ""); // footnote refs
  s = s.replace(/^#{1,6}\s+/gm, ""); // headings
  s = s.replace(/^>\s?/gm, ""); // blockquotes
  s = s.replace(/[*_~]{1,3}/g, ""); // emphasis marks
  s = s.replace(/^[-*+]\s+/gm, ""); // list bullets
  s = s.replace(/\|/g, " ");
  return s.replace(/ | /g, " ").trim();
}
