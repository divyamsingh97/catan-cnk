import { hexCorners, hexToPixel, pointId } from "./hex";
import type { GameState } from "./types";

/**
 * Derived adjacency for the board, computed from geometry. Vertex ids are
 * point ids ("gx:gy"); edge ids are "vidA|vidB" (sorted). This lets us recover
 * which hexes touch a vertex, and which vertices/edges are adjacent, without
 * storing the graph in Firestore.
 */
export interface Adjacency {
  /** vertex id -> hex ids that touch it (1..3). */
  vertexHexes: Map<string, string[]>;
  /** vertex id -> incident edge ids. */
  vertexEdges: Map<string, string[]>;
  /** vertex id -> neighbouring vertex ids (one road away). */
  vertexNeighbors: Map<string, string[]>;
  /** edge id -> its two endpoint vertex ids. */
  edgeEnds: Map<string, [string, string]>;
}

export function buildAdjacency(g: GameState): Adjacency {
  const vertexHexes = new Map<string, string[]>();
  const vertexEdges = new Map<string, string[]>();
  const vertexNeighbors = new Map<string, string[]>();
  const edgeEnds = new Map<string, [string, string]>();

  // vertex -> hexes
  for (const hex of Object.values(g.hexes)) {
    const corners = hexCorners(hexToPixel(hex.q, hex.r));
    for (const c of corners) {
      const vid = pointId(c);
      if (!g.vertices[vid]) continue;
      const arr = vertexHexes.get(vid) ?? [];
      if (!arr.includes(hex.id)) arr.push(hex.id);
      vertexHexes.set(vid, arr);
    }
  }

  // edges -> endpoints, and vertex adjacency
  for (const e of Object.values(g.edges)) {
    const [a, b] = e.id.split("|") as [string, string];
    edgeEnds.set(e.id, [a, b]);

    pushUnique(vertexEdges, a, e.id);
    pushUnique(vertexEdges, b, e.id);
    pushUnique(vertexNeighbors, a, b);
    pushUnique(vertexNeighbors, b, a);
  }

  return { vertexHexes, vertexEdges, vertexNeighbors, edgeEnds };
}

function pushUnique(map: Map<string, string[]>, key: string, val: string): void {
  const arr = map.get(key) ?? [];
  if (!arr.includes(val)) arr.push(val);
  map.set(key, arr);
}

/** Owner of a building at a vertex, or undefined. */
export function vertexOwner(g: GameState, vid: string): string | undefined {
  return g.vertices[vid]?.building?.owner
    ? colorToUid(g, g.vertices[vid]!.building!.owner)
    : undefined;
}

/** Maps a player color back to a uid (colors are unique per game). */
export function colorToUid(g: GameState, color: string): string | undefined {
  return g.order.find((uid) => g.players[uid].color === color);
}
