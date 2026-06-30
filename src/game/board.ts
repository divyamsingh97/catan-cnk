import {
  axialId,
  edgeId,
  hexCorners,
  hexToPixel,
  landSpiral,
  pointId,
  type Point
} from "./hex";
import { mulberry32, shuffle } from "./rng";
import type { Edge, Hex, Terrain, Vertex } from "./types";

/** Terrain multiset for the standard 19-tile board. */
const TERRAIN_BAG: Terrain[] = [
  "forest", "forest", "forest", "forest",
  "pasture", "pasture", "pasture", "pasture",
  "fields", "fields", "fields", "fields",
  "hills", "hills", "hills",
  "mountains", "mountains", "mountains",
  "desert"
];

/** Number-token multiset (18 tokens; desert gets none). */
const NUMBER_BAG: number[] = [
  2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
];

/** "Red" high-probability numbers that may not be adjacent to each other. */
const RED = new Set([6, 8]);

export interface BoardData {
  hexes: Record<string, Hex>;
  vertices: Record<string, Vertex>;
  edges: Record<string, Edge>;
  robberHex: string;
}

/**
 * Builds a full standard board (land + number tokens + harbors + derived
 * vertices/edges) deterministically from `seed`. Re-rolls token placement a
 * bounded number of times to avoid adjacent red (6/8) tiles.
 */
export function generateBoard(seed: number): BoardData {
  const rng = mulberry32(seed);
  const coords = landSpiral();
  const terrains = shuffle(TERRAIN_BAG, rng);

  // 1) Assign terrain to each spiral coordinate.
  const hexes: Record<string, Hex> = {};
  coords.forEach((c, i) => {
    const id = axialId(c.q, c.r);
    hexes[id] = {
      id,
      q: c.q,
      r: c.r,
      terrain: terrains[i],
      robber: false
    };
  });

  // 2) Place number tokens along the spiral, skipping the desert. Validate the
  //    no-adjacent-red constraint; if it fails, reshuffle numbers and retry.
  let robberHex = "";
  for (let attempt = 0; attempt < 200; attempt++) {
    const numbers = shuffle(NUMBER_BAG, rng);
    let ni = 0;
    for (const c of coords) {
      const h = hexes[axialId(c.q, c.r)];
      if (h.terrain === "desert") {
        h.number = undefined;
        h.robber = true;
        robberHex = h.id;
      } else {
        h.number = numbers[ni++];
      }
    }
    if (validRedSpacing(hexes)) break;
    // else loop and try a different number arrangement
  }

  // 3) Derive vertices and edges from the land hexes (shared corners merge).
  const vertices: Record<string, Vertex> = {};
  const edges: Record<string, Edge> = {};
  for (const h of Object.values(hexes)) {
    const center = hexToPixel(h.q, h.r);
    const corners = hexCorners(center);
    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      registerVertex(vertices, a);
      registerVertex(vertices, b);
      registerEdge(edges, a, b);
    }
  }

  // 4) Harbors around the coast.
  assignHarbors(hexes, vertices, seed);

  return { hexes, vertices, edges, robberHex };
}

function registerVertex(vertices: Record<string, Vertex>, p: Point): void {
  const id = pointId(p);
  if (!vertices[id]) {
    vertices[id] = { id, x: p.x, y: p.y };
  }
}

function registerEdge(edges: Record<string, Edge>, a: Point, b: Point): void {
  const id = edgeId(a, b);
  if (!edges[id]) {
    edges[id] = { id, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
}

/** True if no two red (6/8) numbered hexes touch. */
function validRedSpacing(hexes: Record<string, Hex>): boolean {
  const list = Object.values(hexes);
  for (const h of list) {
    if (h.number === undefined || !RED.has(h.number)) continue;
    for (const other of list) {
      if (other === h) continue;
      if (other.number === undefined || !RED.has(other.number)) continue;
      if (areAdjacent(h, other)) return false;
    }
  }
  return true;
}

function areAdjacent(a: Hex, b: Hex): boolean {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  // Axial neighbours have one of these six differences.
  return (
    (dq === 1 && dr === 0) ||
    (dq === 1 && dr === -1) ||
    (dq === 0 && dr === -1) ||
    (dq === -1 && dr === 0) ||
    (dq === -1 && dr === 1) ||
    (dq === 0 && dr === 1)
  );
}

/**
 * Harbor layout. The standard board has 9 harbors: 4 generic 3:1 ports and one
 * 2:1 port for each of the 5 resources. We place them on outer (coastal)
 * vertices spaced around the perimeter. The exact ring positions are derived
 * from the perimeter vertices sorted by angle around the board center.
 */
function assignHarbors(
  hexes: Record<string, Hex>,
  vertices: Record<string, Vertex>,
  seed: number
): void {
  void hexes;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const harborKinds = shuffle(
    ["any", "any", "any", "any", "brick", "wood", "wheat", "sheep", "ore"] as const,
    rng
  );

  // Perimeter vertices = those that belong to fewer than 3 hexes. We approximate
  // by taking the outermost vertices (largest distance from center), then sort
  // them by angle and pick 9 evenly spaced anchor points; each harbor occupies
  // two adjacent perimeter vertices.
  const verts = Object.values(vertices);
  const cx = avg(verts.map((v) => v.x));
  const cy = avg(verts.map((v) => v.y));
  const withAngle = verts
    .map((v) => ({
      v,
      d: Math.hypot(v.x - cx, v.y - cy),
      a: Math.atan2(v.y - cy, v.x - cx)
    }))
    .sort((p, q) => q.d - p.d);

  // Take the outer ~30 vertices (the coastline) and order them by angle.
  const coast = withAngle.slice(0, 30).sort((p, q) => p.a - q.a);
  const n = coast.length;
  for (let i = 0; i < harborKinds.length; i++) {
    const idx = Math.round((i * n) / harborKinds.length) % n;
    const a = coast[idx].v;
    const b = coast[(idx + 1) % n].v;
    a.harbor = harborKinds[i];
    b.harbor = harborKinds[i];
  }
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
