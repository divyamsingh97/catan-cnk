// Core data model for Catan: Cities & Knights.
// Coordinates use an axial hex system (see hex.ts). Vertices and edges are
// derived from hex coordinates so the same intersection is always one id.

// ---------------------------------------------------------------------------
// Resources & commodities
// ---------------------------------------------------------------------------

/** The five base land resources. */
export type Resource = "brick" | "wood" | "wheat" | "sheep" | "ore";

/** Cities & Knights commodities (upgraded outputs of forest/mountain/field). */
export type Commodity = "cloth" | "coin" | "paper";

export const RESOURCES: Resource[] = ["brick", "wood", "wheat", "sheep", "ore"];
export const COMMODITIES: Commodity[] = ["cloth", "coin", "paper"];

/** A bag of resources/commodities a player holds. */
export type ResourceBag = Record<Resource, number>;
export type CommodityBag = Record<Commodity, number>;

export function emptyResources(): ResourceBag {
  return { brick: 0, wood: 0, wheat: 0, sheep: 0, ore: 0 };
}
export function emptyCommodities(): CommodityBag {
  return { cloth: 0, coin: 0, paper: 0 };
}

// ---------------------------------------------------------------------------
// Hex tiles
// ---------------------------------------------------------------------------

/** Terrain types. "sea" tiles ring the board and may carry harbors. */
export type Terrain =
  | "forest" // wood
  | "hills" // brick
  | "fields" // wheat
  | "pasture" // sheep
  | "mountains" // ore
  | "desert"
  | "sea";

/** Which resource a terrain produces (null for desert/sea). */
export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  forest: "wood",
  hills: "brick",
  fields: "wheat",
  pasture: "sheep",
  mountains: "ore",
  desert: null,
  sea: null
};

/**
 * Terrains that yield a COMMODITY (in addition to a resource) when a CITY is
 * adjacent in Cities & Knights: forest->cloth? No. Correct mapping:
 *   mountains(ore)  -> coin
 *   forest(wood)    -> paper
 *   pasture(sheep)  -> cloth
 * Hills(brick) and Fields(wheat) give a second resource of the same kind to a
 * city instead of a commodity.
 */
export const TERRAIN_COMMODITY: Partial<Record<Terrain, Commodity>> = {
  mountains: "coin",
  forest: "paper",
  pasture: "cloth"
};

export interface Hex {
  id: string; // axial "q,r"
  q: number;
  r: number;
  terrain: Terrain;
  /** Dice number 2-12 (no 7); undefined for desert/sea. */
  number?: number;
  /** True if this hex currently has the robber. */
  robber?: boolean;
  /** Sea hexes only: harbor on this tile, if any. */
  harbor?: Harbor;
}

export interface Harbor {
  /** "any" = 3:1 generic port; otherwise a specific resource 2:1 port. */
  kind: Resource | "any";
  /** The two vertex ids the harbor connects to (where a settlement uses it). */
  vertices: [string, string];
}

// ---------------------------------------------------------------------------
// Vertices (intersections) & edges (roads)
// ---------------------------------------------------------------------------

export type BuildingType = "settlement" | "city";

export interface Building {
  type: BuildingType;
  owner: PlayerColor;
  /** City wall present (C&K) — raises hand-limit when robber/barbarian hits. */
  wall?: boolean;
  /** A metropolis sits on a city; only one per discipline exists globally. */
  metropolis?: Discipline;
}

export interface Vertex {
  id: string;
  /** Pixel position for rendering (computed from hexes). */
  x: number;
  y: number;
  building?: Building;
  /** Harbor kind available at this vertex, if any. */
  harbor?: Resource | "any";
}

export interface Edge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Road owner, if built. */
  road?: PlayerColor;
  /** A ship (not used in base C&K, reserved for Seafarers). */
  ship?: PlayerColor;
}

// ---------------------------------------------------------------------------
// Cities & Knights specifics
// ---------------------------------------------------------------------------

/** The three city-improvement disciplines, tied to the three commodities. */
export type Discipline = "trade" | "politics" | "science";

export const DISCIPLINE_COMMODITY: Record<Discipline, Commodity> = {
  trade: "cloth",
  politics: "coin",
  science: "paper"
};

/** Knight ranks: basic(1), strong(2), mighty(3). */
export type KnightRank = 1 | 2 | 3;

export interface Knight {
  id: string;
  owner: PlayerColor;
  rank: KnightRank;
  active: boolean;
  /** Vertex the knight occupies. */
  vertex: string;
  /** True if it has already acted this turn (move/displace). */
  usedThisTurn?: boolean;
}

/** Progress card decks correspond to disciplines. */
export type ProgressDeck = Discipline;

export type ProgressCard =
  // Trade (cloth)
  | "merchant"
  | "merchantfleet"
  | "mastermerchant"
  | "resourcemonopoly"
  | "trademonopoly"
  | "commercialharbor"
  // Politics (coin)
  | "bishop"
  | "constitution" // VP card (kept face-up, worth 1 VP)
  | "deserter"
  | "diplomat"
  | "intrigue"
  | "saboteur"
  | "spy"
  | "warlord"
  | "wedding"
  // Science (paper)
  | "alchemist"
  | "crane"
  | "engineer"
  | "inventor"
  | "irrigation"
  | "medicine"
  | "mining"
  | "printer"
  | "roadbuilding"
  | "smith";

/** The barbarian ship advances each time the event die shows the ship. */
export interface Barbarians {
  /** 0..7 ; reaches the city at 7, then attacks and resets. */
  position: number;
  /** How many times the barbarians have attacked (history/flavor). */
  attacks: number;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export type PlayerColor = "red" | "blue" | "white" | "orange" | "green" | "brown";

export const PLAYER_COLORS: PlayerColor[] = [
  "red",
  "blue",
  "white",
  "orange",
  "green",
  "brown"
];

export interface PlayerState {
  uid: string;
  name: string;
  color: PlayerColor;
  connected: boolean;

  resources: ResourceBag;
  commodities: CommodityBag;

  /** City-improvement levels per discipline (0..5). */
  improvements: Record<Discipline, number>;

  /** Progress cards in hand. */
  progressCards: ProgressCard[];

  /** Victory-point progress cards kept face-up (Constitution, Printer). */
  vpCards: number;

  /** Pieces still available to build. */
  pieces: {
    roads: number;
    settlements: number;
    cities: number;
    knights: number; // physical knight pieces left
    walls: number; // city wall pieces left (max 3)
  };

  /** Public victory points (hidden VPs like some cards tracked separately). */
  victoryPoints: number;
  /** Defender-of-Catan VP chips earned by repelling the barbarians. */
  defenderPoints: number;

  /** Has the metropolis for a discipline (worth 2 VP, max one per discipline). */
  metropolis: Partial<Record<Discipline, boolean>>;

  /** Special cards. */
  hasLongestRoad: boolean;
  /** Merchant (from Trade deck) currently parked here for 2:1, if any. */
  hasMerchant: boolean;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type GamePhase =
  | "lobby"
  | "setup1" // first settlement + road, in player order
  | "setup2" // second settlement + road, reverse order
  | "play"
  | "finished";

/** What the current player must do right now. */
export type TurnStep =
  | "setupSettlement" // initial placement: place a settlement
  | "setupRoad" // initial placement: place a road next to it
  | "roll" // must roll dice (production + event die)
  | "main" // build / trade / play cards / move knights / end turn
  | "discard" // players over hand limit must discard after a 7
  | "moveRobber"
  | "stealChoice"
  | "barbarianResolve"
  | "moveKnight"
  | "chaseRobberOrKnight";

export interface DiceRoll {
  /** Two production dice (red + yellow). */
  white: number;
  red: number;
  /** Event die face. */
  event: EventDie;
}

/** Cities & Knights event die: 3 barbarian-ship faces + 3 colored faces. */
export type EventDie = "ship" | "trade" | "politics" | "science";

export interface GameState {
  id: string;
  phase: GamePhase;
  createdBy: string;
  createdAt: number;
  name: string;

  /** uids in seating order. */
  order: string[];
  players: Record<string, PlayerState>;

  /** Board geometry. */
  hexes: Record<string, Hex>;
  vertices: Record<string, Vertex>;
  edges: Record<string, Edge>;

  /** Whose turn (index into `order`). */
  current: number;
  step: TurnStep;
  lastRoll?: DiceRoll;

  /** Seconds allowed per turn (0 = no limit). Chosen when the game starts. */
  turnTimer: number;
  /** Epoch ms when the current play-phase turn must end (undefined = no clock). */
  turnDeadline?: number;

  /** Robber location (hex id). */
  robberHex: string;

  /** Cities & Knights global state. */
  barbarians: Barbarians;
  knights: Record<string, Knight>;
  /** Remaining progress cards per deck (we draw from the top). */
  decks: Record<ProgressDeck, ProgressCard[]>;
  /** Which metropolis (if any) is claimed, and by whom. */
  metropolisOwner: Partial<Record<Discipline, string>>;

  longestRoadOwner?: string;

  winner?: string;
  /** Points needed to win (C&K standard is 13). */
  targetPoints: number;

  /** Transient: uids that still owe discards after a 7 (uid -> count). */
  pendingDiscards?: Record<string, number>;
  /** Transient: candidate uids the roller may steal from after moving robber. */
  robberVictims?: string[];
  /** During setup, the vertex just placed (so the road must touch it). */
  lastSetupVertex?: string;

  /** Merchant piece (Trade progress card): hex it sits on + owner uid. */
  merchantHex?: string;
  merchantOwner?: string;
  /** Merchant Fleet: 2:1 on one resource/commodity for the owner this turn. */
  fleet?: { uid: string; type: string };
  /** Road Building / setup: free roads remaining for a uid this turn. */
  freeRoads?: { uid: string; count: number };
  /** Alchemist: pre-set production dice for the next roll this turn. */
  alchemistDice?: { white: number; red: number };

  /** Open player-to-player trade offer made by the active player this turn. */
  tradeOffer?: {
    from: string;
    give: Partial<Record<Resource | Commodity, number>>;
    want: Partial<Record<Resource | Commodity, number>>;
    responses: Record<string, "accept" | "reject">;
  };

  /** Cumulative count of each dice sum (2..12) rolled this game. Drives the
   *  self-balancing dice so totals track the real 2d6 bell curve. */
  rollCounts?: Record<number, number>;
  /** Cumulative resource+commodity units produced per uid, used to nudge the
   *  balanced dice toward fairness across players' hex placements. */
  productionTally?: Record<string, number>;

  /** Monotonic version for optimistic concurrency / change detection. */
  version: number;
  /** Human-readable recent events for the side log. */
  ticker: string[];
}

/** The minimal lobby document shown before a game starts. */
export interface LobbyGame {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  phase: GamePhase;
  playerIds: string[];
  playerNames: string[];
  maxPlayers: number;
}
