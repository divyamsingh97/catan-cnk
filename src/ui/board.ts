import { hexCorners, hexToPixel } from "../game/hex";
import { type GameState, type Hex } from "../game/types";

const NS = "http://www.w3.org/2000/svg";

/** Base terrain colours as [light, dark] pairs used to build a soft radial
 *  gradient per tile, giving each hex a subtle hand-painted depth. */
const TERRAIN_GRADIENT: Record<string, [string, string]> = {
  forest: ["#3aa55f", "#256b3b"],
  hills: ["#d06a44", "#a8441f"],
  fields: ["#f2d15c", "#d3a72f"],
  pasture: ["#a6e05f", "#6fb43a"],
  mountains: ["#98a5bb", "#6b788f"],
  desert: ["#ecd9a6", "#cdb075"],
  sea: ["#1c4a86", "#0e2a51"]
};

/** A single emoji glyph drawn as a watermark on each land tile. Original art,
 *  no external assets, crisp on mobile. */
const TERRAIN_ICON: Record<string, string> = {
  forest: "\uD83C\uDF32", // pine tree
  hills: "\uD83E\uDDF1", // brick
  fields: "\uD83C\uDF3E", // sheaf of rice
  pasture: "\uD83D\uDC11", // ram
  mountains: "\u26F0\uFE0F", // mountain
  desert: "\uD83C\uDFDC\uFE0F" // desert
};

/** Number of probability pips shown under a token (dots = ways to roll it). */
const PIP_COUNT: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1
};

const COLOR_FILL: Record<string, string> = {
  red: "#e5484d",
  blue: "#4aa3ff",
  white: "#e8eefb",
  orange: "#f2a900",
  green: "#3dd68c",
  brown: "#a9744f"
};

export interface BoardCallbacks {
  onVertexClick?: (vertexId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onHexClick?: (hexId: string) => void;
}

/**
 * Renders the board to an <svg>. Returns the SVG element. The viewBox is fit to
 * the board bounds so it scales to any screen size (mobile-friendly).
 */
export function renderBoard(g: GameState, cb: BoardCallbacks = {}): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");

  const verts = Object.values(g.vertices);
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  const pad = 48;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...ys) - minY + pad;
  svg.setAttribute("viewBox", `${minX} ${minY} ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // ---- Gradients + filters (defined once) ----
  svg.appendChild(buildDefs());

  // ---- Hex tiles ----
  for (const hex of Object.values(g.hexes)) {
    drawHex(svg, hex, cb);
  }

  // ---- Roads (edges) ----
  for (const e of Object.values(g.edges)) {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(e.x1));
    line.setAttribute("y1", String(e.y1));
    line.setAttribute("x2", String(e.x2));
    line.setAttribute("y2", String(e.y2));
    line.setAttribute("stroke", e.road ? COLOR_FILL[e.road] : "transparent");
    line.setAttribute("stroke-width", e.road ? "8" : "16");
    line.setAttribute("stroke-linecap", "round");
    line.style.cursor = cb.onEdgeClick ? "pointer" : "default";
    if (!e.road) line.setAttribute("opacity", "0"); // invisible hit target
    if (cb.onEdgeClick) line.addEventListener("click", () => cb.onEdgeClick!(e.id));
    svg.appendChild(line);
  }

  // ---- Vertices (settlements/cities + click targets) ----
  for (const v of Object.values(g.vertices)) {
    const node = document.createElementNS(NS, "g");
    if (v.building) {
      const shape = document.createElementNS(
        NS,
        v.building.type === "city" ? "rect" : "circle"
      );
      if (v.building.type === "city") {
        shape.setAttribute("x", String(v.x - 9));
        shape.setAttribute("y", String(v.y - 9));
        shape.setAttribute("width", "18");
        shape.setAttribute("height", "18");
        shape.setAttribute("rx", "3");
      } else {
        shape.setAttribute("cx", String(v.x));
        shape.setAttribute("cy", String(v.y));
        shape.setAttribute("r", "9");
      }
      shape.setAttribute("fill", COLOR_FILL[v.building.owner]);
      shape.setAttribute("stroke", "#0008");
      shape.setAttribute("stroke-width", "2");
      node.appendChild(shape);
    } else if (cb.onVertexClick) {
      const hit = document.createElementNS(NS, "circle");
      hit.setAttribute("cx", String(v.x));
      hit.setAttribute("cy", String(v.y));
      hit.setAttribute("r", "12");
      hit.setAttribute("fill", "#ffffff22");
      hit.style.cursor = "pointer";
      node.appendChild(hit);
    }
    if (cb.onVertexClick) node.addEventListener("click", () => cb.onVertexClick!(v.id));
    svg.appendChild(node);
  }

  return svg as SVGSVGElement;
}

/** Builds the <defs> block with one radial gradient per terrain plus a soft
 *  drop shadow used by the number tokens. */
function buildDefs(): SVGDefsElement {
  const defs = document.createElementNS(NS, "defs");

  for (const terrain of Object.keys(TERRAIN_GRADIENT)) {
    const [light, dark] = TERRAIN_GRADIENT[terrain];
    const grad = document.createElementNS(NS, "radialGradient");
    grad.setAttribute("id", `g-${terrain}`);
    grad.setAttribute("cx", "50%");
    grad.setAttribute("cy", "36%");
    grad.setAttribute("r", "78%");
    const s1 = document.createElementNS(NS, "stop");
    s1.setAttribute("offset", "0%");
    s1.setAttribute("stop-color", light);
    const s2 = document.createElementNS(NS, "stop");
    s2.setAttribute("offset", "100%");
    s2.setAttribute("stop-color", dark);
    grad.append(s1, s2);
    defs.appendChild(grad);
  }

  const filter = document.createElementNS(NS, "filter");
  filter.setAttribute("id", "tokenShadow");
  filter.setAttribute("x", "-40%");
  filter.setAttribute("y", "-40%");
  filter.setAttribute("width", "180%");
  filter.setAttribute("height", "180%");
  const shadow = document.createElementNS(NS, "feDropShadow");
  shadow.setAttribute("dx", "0");
  shadow.setAttribute("dy", "1");
  shadow.setAttribute("stdDeviation", "1.2");
  shadow.setAttribute("flood-color", "#00000055");
  filter.appendChild(shadow);
  defs.appendChild(filter);

  return defs;
}

function drawHex(
  svg: SVGSVGElement,
  hex: Hex,
  cb: BoardCallbacks
): void {
  const center = hexToPixel(hex.q, hex.r);
  const corners = hexCorners(center);
  const poly = document.createElementNS(NS, "polygon");
  poly.setAttribute("points", corners.map((p) => `${p.x},${p.y}`).join(" "));
  poly.setAttribute("fill", `url(#g-${hex.terrain})`);
  poly.setAttribute("stroke", hex.terrain === "sea" ? "#0a2547" : "#0c1a30");
  poly.setAttribute("stroke-width", "3");
  poly.setAttribute("stroke-linejoin", "round");
  if (cb.onHexClick) {
    poly.style.cursor = "pointer";
    poly.addEventListener("click", () => cb.onHexClick!(hex.id));
  }
  svg.appendChild(poly);

  // Resource icon watermark (land tiles only)
  const icon = TERRAIN_ICON[hex.terrain];
  if (icon) {
    const glyph = document.createElementNS(NS, "text");
    glyph.setAttribute("x", String(center.x));
    glyph.setAttribute("y", String(hex.number !== undefined ? center.y - 12 : center.y));
    glyph.setAttribute("class", "hex-icon");
    glyph.textContent = icon;
    svg.appendChild(glyph);
  }

  // Number token with probability pips
  if (hex.number !== undefined) {
    const cy = center.y + 16;
    const red = hex.number === 6 || hex.number === 8;

    const bg = document.createElementNS(NS, "circle");
    bg.setAttribute("cx", String(center.x));
    bg.setAttribute("cy", String(cy));
    bg.setAttribute("r", "17");
    bg.setAttribute("class", "token-bg");
    bg.setAttribute("filter", "url(#tokenShadow)");
    svg.appendChild(bg);

    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(center.x));
    t.setAttribute("y", String(cy - 3));
    t.setAttribute("font-size", "16");
    t.setAttribute("class", red ? "hex-number red" : "hex-number");
    t.textContent = String(hex.number);
    svg.appendChild(t);

    const pips = PIP_COUNT[hex.number] ?? 0;
    if (pips > 0) {
      const gap = 4;
      const startX = center.x - ((pips - 1) * gap) / 2;
      for (let i = 0; i < pips; i++) {
        const pip = document.createElementNS(NS, "circle");
        pip.setAttribute("cx", String(startX + i * gap));
        pip.setAttribute("cy", String(cy + 8));
        pip.setAttribute("r", "1.6");
        pip.setAttribute("fill", red ? "#c0392b" : "#3a2a12");
        svg.appendChild(pip);
      }
    }
  }

  // Robber pawn
  if (hex.robber) {
    const pawn = document.createElementNS(NS, "g");
    const bx = center.x;
    const by = hex.number !== undefined ? center.y - 10 : center.y;
    const head = document.createElementNS(NS, "circle");
    head.setAttribute("cx", String(bx));
    head.setAttribute("cy", String(by - 7));
    head.setAttribute("r", "5");
    head.setAttribute("fill", "#1a1a1a");
    head.setAttribute("stroke", "#ffffffaa");
    head.setAttribute("stroke-width", "1.2");
    const body = document.createElementNS(NS, "path");
    body.setAttribute(
      "d",
      `M ${bx - 8} ${by + 9} Q ${bx - 8} ${by - 1} ${bx} ${by - 2} Q ${bx + 8} ${by - 1} ${bx + 8} ${by + 9} Z`
    );
    body.setAttribute("fill", "#1a1a1a");
    body.setAttribute("stroke", "#ffffffaa");
    body.setAttribute("stroke-width", "1.2");
    body.setAttribute("stroke-linejoin", "round");
    pawn.append(body, head);
    svg.appendChild(pawn);
  }
}

export { COLOR_FILL };
