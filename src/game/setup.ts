import { generateBoard } from "./board";
import { randomSeed, shuffle, mulberry32 } from "./rng";
import {
  emptyCommodities,
  emptyResources,
  PLAYER_COLORS,
  type Discipline,
  type GameState,
  type PlayerState,
  type ProgressCard,
  type ProgressDeck
} from "./types";

/** Full progress-card decks for Cities & Knights (counts per card). */
const DECK_DEFS: Record<ProgressDeck, Array<[ProgressCard, number]>> = {
  trade: [
    ["commercialharbor", 2],
    ["mastermerchant", 2],
    ["merchant", 6],
    ["merchantfleet", 2],
    ["resourcemonopoly", 4],
    ["trademonopoly", 2]
  ],
  politics: [
    ["bishop", 2],
    ["constitution", 1],
    ["deserter", 2],
    ["diplomat", 2],
    ["intrigue", 2],
    ["saboteur", 2],
    ["spy", 3],
    ["warlord", 2],
    ["wedding", 2]
  ],
  science: [
    ["alchemist", 2],
    ["crane", 2],
    ["engineer", 1],
    ["inventor", 2],
    ["irrigation", 2],
    ["medicine", 2],
    ["mining", 2],
    ["printer", 1],
    ["roadbuilding", 2],
    ["smith", 2]
  ]
};

function buildDeck(deck: ProgressDeck, rng: () => number): ProgressCard[] {
  const cards: ProgressCard[] = [];
  for (const [card, count] of DECK_DEFS[deck]) {
    for (let i = 0; i < count; i++) cards.push(card);
  }
  return shuffle(cards, rng);
}

function newPlayer(uid: string, name: string, color: PlayerState["color"]): PlayerState {
  const improvements: Record<Discipline, number> = {
    trade: 0,
    politics: 0,
    science: 0
  };
  return {
    uid,
    name,
    color,
    connected: true,
    resources: emptyResources(),
    commodities: emptyCommodities(),
    improvements,
    progressCards: [],
    vpCards: 0,
    pieces: { roads: 15, settlements: 5, cities: 4, knights: 6, walls: 3 },
    victoryPoints: 0,
    defenderPoints: 0,
    metropolis: {},
    hasLongestRoad: false,
    hasMerchant: false
  };
}

export interface NewGameInput {
  id: string;
  name: string;
  createdBy: string;
  players: Array<{ uid: string; name: string }>;
  seed?: number;
  /** Seconds allowed per turn (0 = no limit). */
  turnTimer?: number;
}

/** Assembles a fresh GameState ready to begin the setup phase. */
export function createGameState(input: NewGameInput): GameState {
  const seed = input.seed ?? randomSeed();
  const board = generateBoard(seed);
  const rng = mulberry32(seed ^ 0x1234567);

  const order = input.players.map((p) => p.uid);
  const players: Record<string, PlayerState> = {};
  input.players.forEach((p, i) => {
    players[p.uid] = newPlayer(p.uid, p.name, PLAYER_COLORS[i]);
  });

  return {
    id: input.id,
    name: input.name,
    phase: "setup1",
    createdBy: input.createdBy,
    createdAt: Date.now(),
    order,
    players,
    hexes: board.hexes,
    vertices: board.vertices,
    edges: board.edges,
    current: 0,
    step: "setupSettlement",
    robberHex: board.robberHex,
    turnTimer: input.turnTimer ?? 0,
    barbarians: { position: 0, attacks: 0 },
    knights: {},
    decks: {
      trade: buildDeck("trade", rng),
      politics: buildDeck("politics", rng),
      science: buildDeck("science", rng)
    },
    metropolisOwner: {},
    targetPoints: 13,
    version: 1,
    ticker: [`Game created. Seed ${seed}.`]
  };
}
