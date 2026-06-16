/* =========================================================================
   Export: print-ready PDF (browser), standalone HTML, valid EPUB 3.
   Includes automatic Table of Contents generation.
   ========================================================================= */

import JSZip from "jszip";
import type { DocState } from "./state";

export interface TocEntry {
  id: string;
  level: number;
  text: string;
}

function slugify(s: string, i: number): string {
  const base = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base || "sez"}-${i}`;
}

/* Add ids to headings and return the TOC + updated HTML fragment. */
export function buildToc(docHtml: string): { html: string; toc: TocEntry[] } {
  const host = document.createElement("div");
  host.innerHTML = docHtml;
  const toc: TocEntry[] = [];
  host.querySelectorAll("h1, h2, h3").forEach((h, i) => {
    const level = Number(h.tagName.substring(1));
    const text = h.textContent?.trim() || "";
    let id = h.id;
    if (!id) {
      id = slugify(text, i);
      h.id = id;
    }
    toc.push({ id, level, text });
  });
  return { html: host.innerHTML, toc };
}

/* ---- PDF via the browser print pipeline (CMYK/bleed/marks preserved by paged.js) ---- */
export function printDocument() {
  window.print();
}

/* ---- Serialize HTML fragment to well-formed XHTML for EPUB ---- */
function toXhtml(fragmentHtml: string): string {
  const host = document.createElement("div");
  host.innerHTML = fragmentHtml;
  const ser = new XMLSerializer();
  return Array.from(host.childNodes)
    .map((n) => ser.serializeToString(n))
    .join("\n")
    .replace(/ xmlns="[^"]*"/g, ""); // strip per-node xmlns; added on <html>
}

const EPUB_CSS = `
@namespace epub "http://www.idpf.org/2007/ops";
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.55; margin: 0 1em; color: #15191c; }
h1, h2, h3 { font-family: Georgia, serif; line-height: 1.15; }
.masthead .kicker { text-transform: uppercase; letter-spacing: 2px; font-size: .8em; color: #0a6; font-weight: 700; }
.masthead .headline { font-size: 1.9em; margin: .2em 0; }
.masthead .deck { font-style: italic; color: #444; }
.masthead .byline { font-size: .85em; color: #555; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: .4em 0; }
p { margin: 0 0 .8em; text-align: justify; hyphens: auto; }
.pullquote { font-size: 1.3em; font-weight: 600; color: #036; border-top: 2px solid; border-bottom: 2px solid; padding: .4em 0; margin: 1em 0; }
figure { margin: 1em 0; }
figure img { max-width: 100%; }
figcaption { font-size: .8em; color: #666; }
.img-placeholder { background: #eee; padding: 2em; text-align: center; color: #999; }
sup.fn { font-size: .7em; }
.doc-notes { font-size: .85em; border-top: 1px solid #ccc; margin-top: 2em; }
`;

function xhtmlDoc(title: string, bodyInner: string, lang: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${bodyInner}
</body>
</html>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function exportEpub(state: DocState, compiledDocHtml: string): Promise<Blob> {
  const lang = "it";
  const { html: htmlWithIds, toc } = buildToc(compiledDocHtml);
  const author = state.front.author.replace(/^di\s+/i, "").trim() || "Anonimo";
  const id = uuid();
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const meta = state.meta;
  const subjectTags = (meta.subjects || "")
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `\n    <dc:subject>${escapeXml(s)}</dc:subject>`)
    .join("");

  const zip = new JSZip();
  // mimetype must be first & stored (uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const oebps = zip.folder("OEBPS")!;
  oebps.file("style.css", EPUB_CSS);

  // Title page
  const titlePage = `<section epub:type="titlepage" class="masthead">
    <p class="kicker">${escapeXml(state.front.kicker)}</p>
    <h1 class="headline">${escapeXml(state.front.headline || state.title)}</h1>
    <p class="deck">${escapeXml(state.front.deck)}</p>
    <p class="byline">${escapeXml(state.front.author)} · ${escapeXml(state.front.dateline)}</p>
  </section>`;
  oebps.file("title.xhtml", xhtmlDoc(state.title, titlePage, lang));

  // Main content
  oebps.file("content.xhtml", xhtmlDoc(state.title, toXhtml(htmlWithIds), lang));

  // EPUB3 navigation document
  const navList = toc.length
    ? toc
        .map((t) => `<li><a href="content.xhtml#${t.id}">${escapeXml(t.text)}</a></li>`)
        .join("\n")
    : `<li><a href="content.xhtml">${escapeXml(state.title)}</a></li>`;
  const nav = `<nav epub:type="toc" id="toc"><h1>Indice</h1><ol>
${navList}
</ol></nav>`;
  oebps.file("nav.xhtml", xhtmlDoc("Indice", nav, lang));

  // EPUB2 NCX (back-compat)
  const navPoints = (toc.length ? toc : [{ id: "", text: state.title, level: 1 }])
    .map(
      (t, i) => `<navPoint id="np-${i}" playOrder="${i + 1}">
  <navLabel><text>${escapeXml(t.text)}</text></navLabel>
  <content src="content.xhtml${t.id ? "#" + t.id : ""}"/>
</navPoint>`
    )
    .join("\n");
  oebps.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:${id}"/></head>
<docTitle><text>${escapeXml(state.title)}</text></docTitle>
<navMap>
${navPoints}
</navMap>
</ncx>`
  );

  // OPF package
  oebps.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${meta.isbn ? `urn:isbn:${escapeXml(meta.isbn.replace(/[^0-9Xx]/g, ""))}` : `urn:uuid:${id}`}</dc:identifier>
    <dc:title>${escapeXml(state.title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:publisher>${escapeXml(meta.publisher || "Typographus")}</dc:publisher>${
      meta.year ? `\n    <dc:date>${escapeXml(meta.year)}</dc:date>` : ""
    }${meta.rights || meta.copyright ? `\n    <dc:rights>${escapeXml(meta.rights || meta.copyright)}</dc:rights>` : ""}${subjectTags}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="title"/>
    <itemref idref="content"/>
  </spine>
</package>`
  );

  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
}

/* ---- Standalone HTML export ---- */
export function buildStandaloneHtml(state: DocState, compiledDocHtml: string): string {
  const { html, toc } = buildToc(compiledDocHtml);
  const tocHtml = toc.length
    ? `<nav class="toc"><h2>Indice</h2><ul>${toc
        .map((t) => `<li class="lvl-${t.level}"><a href="#${t.id}">${t.text}</a></li>`)
        .join("")}</ul></nav>`
    : "";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${state.title}</title>
<style>${EPUB_CSS} body{max-width:42em;margin:2em auto;padding:0 1em}.toc{border:1px solid #ddd;padding:1em;border-radius:8px;margin-bottom:2em}.toc .lvl-3{margin-left:1.2em;font-size:.9em}</style>
</head><body>${tocHtml}<article class="doc">${html}</article></body></html>`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
