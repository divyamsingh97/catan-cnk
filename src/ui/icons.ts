/** Original inline-SVG icons for the five resources and three commodities.
 *  Zero external assets; crisp at any size. Used in the hand panel, trades,
 *  and city-improvement tracks. */
import type { Commodity, Resource } from "../game/types";

const ICONS: Record<Resource | Commodity, string> = {
  // ---- resources ----
  wood: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="10.5" y="15" width="3" height="6" rx="1" fill="#7a4a26"/><path d="M12 2 L19 12 H5 Z" fill="#2f8f4e"/><path d="M12 7 L17.5 15 H6.5 Z" fill="#3aa55f"/></svg>`,
  brick: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="1.5" fill="#c45a3a" stroke="#8f3f28" stroke-width="1.4"/><path d="M12 7v4M3 11h18M7.5 11v3M16.5 11v3" stroke="#8f3f28" stroke-width="1.2" fill="none"/></svg>`,
  wheat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v15" stroke="#b8901f" stroke-width="1.6"/><g fill="#e7c24a" stroke="#c99a2e" stroke-width="0.6"><ellipse cx="12" cy="6" rx="2" ry="3.2"/><ellipse cx="8" cy="10" rx="1.7" ry="3" transform="rotate(-32 8 10)"/><ellipse cx="16" cy="10" rx="1.7" ry="3" transform="rotate(32 16 10)"/><ellipse cx="8" cy="15" rx="1.7" ry="3" transform="rotate(-32 8 15)"/><ellipse cx="16" cy="15" rx="1.7" ry="3" transform="rotate(32 16 15)"/></g></svg>`,
  sheep: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#eef2f7"><circle cx="9" cy="10" r="3"/><circle cx="13" cy="9" r="3.2"/><circle cx="16" cy="11" r="3"/><ellipse cx="12" cy="13" rx="6.5" ry="4.5"/><circle cx="7" cy="13" r="2.6"/></g><circle cx="6.5" cy="12" r="2.4" fill="#5b6472"/><circle cx="5.8" cy="11.6" r="0.5" fill="#fff"/><rect x="9" y="17" width="1.4" height="3" rx="0.5" fill="#5b6472"/><rect x="14" y="17" width="1.4" height="3" rx="0.5" fill="#5b6472"/></svg>`,
  ore: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17 L9 8 L15 7 L20 14 L16 20 L8 20 Z" fill="#8791a3" stroke="#5b6577" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 8 L15 7 L13 13 Z" fill="#aab3c2"/><path d="M13 13 L20 14 L16 20 Z" fill="#6b7486"/></svg>`,
  // ---- commodities ----
  cloth: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="10" rx="1.5" fill="#c45ba0"/><path d="M4 10h16M4 13.5h16" stroke="#e29ac8" stroke-width="1.2"/><path d="M8 7v10M14 7v10" stroke="#a83f85" stroke-width="0.9" opacity="0.55"/></svg>`,
  coin: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="#e7b23a" stroke="#b8891f" stroke-width="1.5"/><circle cx="12" cy="12" r="5.2" fill="none" stroke="#b8891f" stroke-width="1"/><path d="M12 8 L15 12 L12 16 L9 12 Z" fill="#f4d27a" stroke="#b8891f" stroke-width="0.8"/></svg>`,
  paper: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="1.5" fill="#eef4fb" stroke="#9db6d0" stroke-width="1.3"/><path d="M9 8h6M9 11h6M9 14h4" stroke="#6a90bd" stroke-width="1.2"/></svg>`
};

/** Returns the raw SVG markup for a resource/commodity. */
export function iconSvg(kind: Resource | Commodity): string {
  return ICONS[kind] ?? "";
}

/** Builds an inline icon element sized to `size` px. */
export function iconEl(kind: Resource | Commodity, size = 18): HTMLElement {
  const span = document.createElement("span");
  span.className = "ico";
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.title = kind;
  span.innerHTML = ICONS[kind] ?? "";
  return span;
}

/** Icon followed by a count, e.g. 🐑 3 — used in the hand and player panels. */
export function iconCount(kind: Resource | Commodity, count: number, size = 18): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "ico-count";
  wrap.title = `${kind}: ${count}`;
  wrap.appendChild(iconEl(kind, size));
  const n = document.createElement("span");
  n.className = "ico-count-n";
  n.textContent = String(count);
  wrap.appendChild(n);
  return wrap;
}
