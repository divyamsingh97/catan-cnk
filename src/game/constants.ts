import type { Commodity, Resource } from "./types";

export type CostBag = Partial<Record<Resource | Commodity, number>>;

/** Building / action costs. */
export const COSTS = {
  road: { brick: 1, wood: 1 } as CostBag,
  settlement: { brick: 1, wood: 1, wheat: 1, sheep: 1 } as CostBag,
  city: { wheat: 2, ore: 3 } as CostBag,
  cityWall: { brick: 2 } as CostBag,
  knightBuild: { ore: 1, sheep: 1 } as CostBag, // build a new basic knight
  knightActivate: { wheat: 1 } as CostBag,
  knightPromote: { ore: 1, sheep: 1 } as CostBag
} as const;

/**
 * City improvement cost: to reach level N in a discipline you pay N commodities
 * of that discipline (1 for level 1, 2 for level 2, ... 5 for level 5).
 */
export function improvementCost(targetLevel: number): number {
  return targetLevel;
}

/** Hand limit before a 7 forces discarding (doubled with a city wall). */
export const BASE_HAND_LIMIT = 7;

/** Max city-improvement level per discipline. */
export const MAX_IMPROVEMENT = 5;

/** Improvement level at which a city may become a metropolis. */
export const METROPOLIS_LEVEL = 4;

/** Barbarians attack when their track reaches this. */
export const BARBARIAN_TARGET = 7;

/** Points to win Cities & Knights. */
export const TARGET_POINTS = 13;
