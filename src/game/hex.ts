// Pointy-top hexagon geometry using axial coordinates (q, r).
// We derive shared vertex/edge ids from rounded pixel positions so that the
// same physical corner shared by 3 hexes always maps to one vertex id.

export const HEX_SIZE = 56; // circumradius in px (center -> corner)

export interface Point {
  x: number;
  y: number;
}

/** Center pixel of a pointy-top hex at axial (q, r). */
export function hexToPixel(q: number, r: number): Point {
  const x = HEX_SIZE * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = HEX_SIZE * (1.5 * r);
  return { x, y };
}

/** The 6 corner points of a pointy-top hex (clockwise from the top). */
export function hexCorners(center: Point): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    pts.push({
      x: center.x + HEX_SIZE * Math.cos(angle),
      y: center.y + HEX_SIZE * Math.sin(angle)
    });
  }
  return pts;
}

/** Stable id for a point, snapped to a grid to merge shared corners. */
export function pointId(p: Point): string {
  const gx = Math.round(p.x / 4);
  const gy = Math.round(p.y / 4);
  return `${gx}:${gy}`;
}

/** Stable id for an undirected edge between two points. */
export function edgeId(a: Point, b: Point): string {
  const ia = pointId(a);
  const ib = pointId(b);
  return ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
}

/** Axial directions for the 6 neighbours of a hex. */
export const HEX_DIRECTIONS: Array<{ q: number; r: number }> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

export function neighbor(q: number, r: number, dir: number): { q: number; r: number } {
  const d = HEX_DIRECTIONS[dir];
  return { q: q + d.q, r: r + d.r };
}

export function axialId(q: number, r: number): string {
  return `${q},${r}`;
}

/**
 * The standard 3-4 player Catan land layout is a hex of radius 2 (19 land
 * tiles). Returns axial coords for land tiles in spiral order so number tokens
 * can be placed along the classic A..R spiral.
 */
export function landSpiral(): Array<{ q: number; r: number }> {
  // Hand-ordered spiral starting top-left, going clockwise, for radius-2 board.
  // Ring coords (axial) for radius 2:
  const ring2 = [
    { q: 0, r: -2 },
    { q: 1, r: -2 },
    { q: 2, r: -2 },
    { q: 2, r: -1 },
    { q: 2, r: 0 },
    { q: 1, r: 1 },
    { q: 0, r: 2 },
    { q: -1, r: 2 },
    { q: -2, r: 2 },
    { q: -2, r: 1 },
    { q: -2, r: 0 },
    { q: -1, r: -1 }
  ];
  const ring1 = [
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 }
  ];
  const center = [{ q: 0, r: 0 }];
  return [...ring2, ...ring1, ...center];
}

/** All axial coords within `radius` of the origin (includes the sea ring). */
export function hexDisk(radius: number): Array<{ q: number; r: number }> {
  const out: Array<{ q: number; r: number }> = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= radius) {
        out.push({ q, r });
      }
    }
  }
  return out;
}
