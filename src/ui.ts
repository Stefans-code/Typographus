/* =========================================================================
   Small UI helpers — Material-flavoured building blocks & utilities.
   ========================================================================= */

export const icon = (name: string, cls = "") => `<span class="msi ${cls}">${name}</span>`;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: number | undefined;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  }) as T;
}

/* ---- form fragments ---- */
export function fieldText(label: string, id: string, value: string, placeholder = ""): string {
  return `<div class="field"><label for="${id}">${label}</label>
    <input type="text" id="${id}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></div>`;
}

export function fieldNumber(label: string, id: string, value: number, min?: number, max?: number, step = 1): string {
  return `<div class="field"><label for="${id}">${label}</label>
    <input type="number" id="${id}" value="${value}" ${min !== undefined ? `min="${min}"` : ""} ${
    max !== undefined ? `max="${max}"` : ""
  } step="${step}"></div>`;
}

export function fieldSelect(label: string, id: string, options: [string, string][], value: string): string {
  return `<div class="field"><label for="${id}">${label}</label>
    <select id="${id}">${options
    .map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`)
    .join("")}</select></div>`;
}

export function sliderRow(label: string, id: string, min: number, max: number, step: number, value: number, unit = ""): string {
  return `<div class="field"><label for="${id}">${label}</label>
    <div class="slider-row">
      <input class="slider" type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
      <span class="slider-value" id="${id}-v">${value}${unit}</span>
    </div></div>`;
}

export function switchRow(label: string, sub: string, id: string, checked: boolean): string {
  return `<div class="opt-row"><div class="opt-label"><b>${label}</b>${sub ? `<span>${sub}</span>` : ""}</div>
    <label class="switch"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}><span class="track"><span class="thumb"></span></span></label></div>`;
}

export function segmented(id: string, options: [string, string, string?][], active: string): string {
  return `<div class="segmented" id="${id}">${options
    .map(
      ([v, l, ic]) =>
        `<button data-v="${v}" class="${v === active ? "is-active" : ""}">${ic ? icon(ic, "sm") : ""}${l ? `<span>${l}</span>` : ""}</button>`
    )
    .join("")}</div>`;
}

/* ---- transient UI ---- */
let snackHost: HTMLElement | null = null;
export function snackbar(message: string, actionLabel?: string, onAction?: () => void) {
  if (!snackHost) {
    snackHost = document.createElement("div");
    snackHost.className = "snackbar-host";
    document.body.appendChild(snackHost);
  }
  const el = document.createElement("div");
  el.className = "snackbar";
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (actionLabel) {
    const b = document.createElement("button");
    b.textContent = actionLabel;
    b.onclick = () => {
      onAction?.();
      el.remove();
    };
    el.appendChild(b);
  }
  snackHost.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* circular gauge (0–100) */
export function gaugeSvg(value: number, max = 100, label = ""): string {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const dash = c * pct;
  return `<svg class="ring" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--md-surface-container-highest)" stroke-width="6"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--md-primary)" stroke-width="6"
      stroke-linecap="round" stroke-dasharray="${dash} ${c}" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle">${label || value}</text>
  </svg>`;
}
