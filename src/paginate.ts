/* =========================================================================
   Rendering pipeline:
   - Galley: one continuous sheet with live grid/margin/baseline overlays.
   - Paged: real pagination via Paged.js (@page size, margins, bleed,
     crop+registration marks, running heads, page numbers).
   ========================================================================= */

import { Previewer } from "pagedjs";
import type { DocState, Settings } from "./state";
import { PAGE_PRESETS } from "./state";

export function pageDims(s: Settings): { w: number; h: number } {
  const preset = s.pageSize === "Custom" ? null : PAGE_PRESETS[s.pageSize];
  let w = preset ? preset.w : s.pageW;
  let h = preset ? preset.h : s.pageH;
  if (s.orientation === "landscape") [w, h] = [h, w];
  return { w, h };
}

export function docClass(s: Settings): string {
  return "doc" + (s.dropcap ? " dropcap" : "");
}

export function docStyleVars(s: Settings): string {
  return [
    `--body-size:${s.bodySize}pt`,
    `--leading:${s.leading}`,
    `--text-align:${s.align}`,
    `--hyphens:${s.hyphens ? "auto" : "manual"}`,
    `--liga:${s.ligatures ? 1 : 0}`,
    `--oldstyle:${s.oldstyle ? 1 : 0}`,
    `--para-indent:${s.paraIndent}em`,
    `--orphans:${s.orphans}`,
    `--widows:${s.widows}`,
    `--cols:${s.columns}`,
    `--col-gap:${s.columnGap}mm`,
    `--col-rule:${s.columnRule ? "1px solid #ccc" : "none"}`,
  ].join(";");
}

function paperStyleVars(s: Settings): string {
  const { w, h } = pageDims(s);
  return [
    `--page-w:${w}mm`,
    `--page-h:${h}mm`,
    `--mt:${s.marginTop}mm`,
    `--mr:${s.marginRight}mm`,
    `--mb:${s.marginBottom}mm`,
    `--ml:${s.marginLeft}mm`,
    `--col-gap:${s.columnGap}mm`,
    `--baseline-step:${s.baselineStep}px`,
    `--bleed:${s.bleed}mm`,
    docStyleVars(s),
  ].join(";");
}

function gridOverlay(s: Settings): string {
  if (!s.showMargins && !s.showColumns && !s.showBaseline && !s.showGolden) return "";
  const cols =
    s.showColumns && s.columns > 1
      ? `<div class="cols">${Array.from({ length: s.columns }, () => "<i></i>").join("")}</div>`
      : "";
  return `<div class="grid-overlay">
    ${s.showMargins ? '<div class="margin-box"></div>' : ""}
    ${cols}
    ${s.showBaseline ? '<div class="baseline"></div>' : ""}
    ${s.showGolden ? '<div class="golden"></div>' : ""}
  </div>`;
}

/* ---- Galley (continuous) ---- */
export function renderGalley(container: HTMLElement, docHtml: string, s: Settings) {
  container.innerHTML = `
    <div class="paper${s.showBleed ? " show-bleed" : ""}" style="${paperStyleVars(s)}">
      ${gridOverlay(s)}
      <div class="${docClass(s)}" data-cols="${s.columns}" style="${docStyleVars(s)}">${docHtml}</div>
    </div>`;
}

/* ---- Paged.js @page rules ---- */
export function pageCss(state: DocState): string {
  const s = state.settings;
  const { w, h } = pageDims(s);
  const marksBlock = s.marks ? `bleed: ${s.bleed}mm; marks: crop cross;` : "";
  const runHeadText = (state.front.section || state.title || "").replace(/"/g, '\\"');
  const pageNum = s.pageNumbers
    ? `@bottom-center { content: counter(page); font-family: "Roboto Flex", sans-serif; font-size: 8pt; color: #999; }`
    : "";
  const runHead = s.runningHead
    ? `@top-center { content: "${runHeadText}"; font-family: "Roboto Flex", sans-serif; font-size: 7.5pt; letter-spacing: 1px; text-transform: uppercase; color: #aaa; }`
    : "";
  return `
    @page {
      size: ${w}mm ${h}mm;
      margin: ${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm;
      ${marksBlock}
      ${pageNum}
      ${runHead}
    }
    @page :first { @top-center { content: none; } }
    .pagedjs_page .doc { ${docStyleVars(s)} }
  `;
}

let renderToken = 0;

export async function renderPaged(
  container: HTMLElement,
  docHtml: string,
  state: DocState
): Promise<number> {
  const token = ++renderToken;
  container.innerHTML = "";
  const s = state.settings;
  const content = `<div class="${docClass(s)}" data-cols="${s.columns}" style="${docStyleVars(s)}">${docHtml}</div>`;

  try {
    const previewer = new Previewer();
    const flow = await previewer.preview(content, [{ _: pageCss(state) }], container);
    if (token !== renderToken) {
      container.innerHTML = ""; // a newer render superseded us
      return 0;
    }
    return flow.total as number;
  } catch (err) {
    if (token !== renderToken) return 0;
    container.innerHTML = `<div style="padding:24px;color:var(--md-on-surface)">Impaginazione non riuscita: ${(err as Error).message}</div>`;
    return 0;
  }
}
