import { hexCorners, hexToPixel } from "../game/hex";
import { TERRAIN_RESOURCE, type GameState, type Hex } from "../game/types";

const NS = "http://www.w3.org/2000/svg";

const TERRAIN_FILL: Record<string, string> = {
  forest: "#2f8f4e",
  hills: "#c45a3a",
  fields: "#e7c24a",
  pasture: "#8fd14f",
  mountains: "#7d8aa0",
  desert: "#d8c08a",
  sea: "#15355f"
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

function drawHex(
  svg: SVGSVGElement,
  hex: Hex,
  cb: BoardCallbacks
): void {
  const center = hexToPixel(hex.q, hex.r);
  const corners = hexCorners(center);
  const poly = document.createElementNS(NS, "polygon");
  poly.setAttribute("points", corners.map((p) => `${p.x},${p.y}`).join(" "));
  poly.setAttribute("fill", TERRAIN_FILL[hex.terrain] ?? "#333");
  poly.setAttribute("stroke", "#0c1a30");
  poly.setAttribute("stroke-width", "3");
  if (cb.onHexClick) {
    poly.style.cursor = "pointer";
    poly.addEventListener("click", () => cb.onHexClick!(hex.id));
  }
  svg.appendChild(poly);

  // Number token
  if (hex.number !== undefined) {
    const bg = document.createElementNS(NS, "circle");
    bg.setAttribute("cx", String(center.x));
    bg.setAttribute("cy", String(center.y));
    bg.setAttribute("r", "16");
    bg.setAttribute("class", "token-bg");
    svg.appendChild(bg);

    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(center.x));
    t.setAttribute("y", String(center.y));
    t.setAttribute("font-size", "16");
    const red = hex.number === 6 || hex.number === 8;
    t.setAttribute("class", red ? "hex-number red" : "hex-number");
    t.textContent = String(hex.number);
    svg.appendChild(t);
  }

  // Resource label (small)
  const res = TERRAIN_RESOURCE[hex.terrain];
  if (res) {
    const lbl = document.createElementNS(NS, "text");
    lbl.setAttribute("x", String(center.x));
    lbl.setAttribute("y", String(center.y + 30));
    lbl.setAttribute("class", "hex-label");
    lbl.textContent = res;
    svg.appendChild(lbl);
  }

  // Robber
  if (hex.robber) {
    const r = document.createElementNS(NS, "circle");
    r.setAttribute("cx", String(center.x));
    r.setAttribute("cy", String(center.y));
    r.setAttribute("r", "12");
    r.setAttribute("fill", "#111");
    r.setAttribute("stroke", "#000");
    r.setAttribute("opacity", "0.8");
    svg.appendChild(r);
  }
}

export { COLOR_FILL };
