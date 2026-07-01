import { buildAdjacency, type Adjacency } from "./graph";
import {
  BARBARIAN_TARGET,
  BASE_HAND_LIMIT,
  COSTS,
  improvementCost,
  MAX_IMPROVEMENT,
  METROPOLIS_LEVEL,
  type CostBag
} from "./constants";
import {
  DISCIPLINE_COMMODITY,
  RESOURCES,
  COMMODITIES,
  TERRAIN_COMMODITY,
  TERRAIN_RESOURCE,
  type Commodity,
  type Discipline,
  type EventDie,
  type GameState,
  type Knight,
  type PlayerState,
  type ProgressCard,
  type ProgressDeck,
  type Resource
} from "./types";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: "setupSettlement"; vertex: string }
  | { type: "setupRoad"; edge: string }
  | { type: "roll" }
  | { type: "discard"; give: CostBag }
  | { type: "moveRobber"; hex: string }
  | { type: "steal"; target: string }
  | { type: "buildRoad"; edge: string }
  | { type: "buildSettlement"; vertex: string }
  | { type: "buildCity"; vertex: string }
  | { type: "buildWall"; vertex: string }
  | { type: "buildKnight"; vertex: string }
  | { type: "activateKnight"; knightId: string }
  | { type: "promoteKnight"; knightId: string }
  | { type: "moveKnight"; knightId: string; to: string }
  | { type: "displaceKnight"; knightId: string; to: string }
  | { type: "chaseRobber"; knightId: string; hex: string }
  | { type: "buyImprovement"; discipline: Discipline }
  | { type: "bankTrade"; give: Resource | Commodity; get: Resource | Commodity }
  | { type: "proposeTrade"; give: CostBag; want: CostBag }
  | { type: "respondTrade"; accept: boolean }
  | { type: "confirmTrade"; partner: string }
  | { type: "cancelTrade" }
  | { type: "playProgress"; card: ProgressCard; params?: ProgressParams }
  | { type: "endTurn" }
  | { type: "timeout" };

/** Parameters a progress card may need (only the relevant ones are read). */
export interface ProgressParams {
  resource?: Resource;
  commodity?: Commodity;
  tradeType?: Resource | Commodity; // merchant fleet
  hex?: string;
  hex2?: string;
  vertex?: string;
  edge?: string;
  targetUid?: string;
  knightId?: string;
  cardIndex?: number;
  discipline?: Discipline;
  white?: number;
  red?: number;
}

export class RuleError extends Error {}

/** Applies an action by `uid`, returning a new state. Throws RuleError if illegal. */
export function applyAction(state: GameState, action: Action, uid: string): GameState {
  const g: GameState = structuredClone(state);
  const adj = buildAdjacency(g);

  switch (action.type) {
    case "setupSettlement":
      doSetupSettlement(g, adj, uid, action.vertex);
      break;
    case "setupRoad":
      doSetupRoad(g, adj, uid, action.edge);
      break;
    case "roll":
      doRoll(g, adj, uid);
      break;
    case "discard":
      doDiscard(g, uid, action.give);
      break;
    case "moveRobber":
      doMoveRobber(g, adj, uid, action.hex);
      break;
    case "steal":
      doSteal(g, uid, action.target);
      break;
    case "buildRoad":
      doBuildRoad(g, adj, uid, action.edge, false);
      break;
    case "buildSettlement":
      doBuildSettlement(g, adj, uid, action.vertex, false);
      break;
    case "buildCity":
      doBuildCity(g, uid, action.vertex);
      break;
    case "buildWall":
      doBuildWall(g, uid, action.vertex);
      break;
    case "buildKnight":
      doBuildKnight(g, adj, uid, action.vertex);
      break;
    case "activateKnight":
      doActivateKnight(g, uid, action.knightId);
      break;
    case "promoteKnight":
      doPromoteKnight(g, uid, action.knightId);
      break;
    case "moveKnight":
      doMoveKnight(g, adj, uid, action.knightId, action.to);
      break;
    case "displaceKnight":
      doDisplaceKnight(g, adj, uid, action.knightId, action.to);
      break;
    case "chaseRobber":
      doChaseRobber(g, adj, uid, action.knightId, action.hex);
      break;
    case "buyImprovement":
      doBuyImprovement(g, uid, action.discipline);
      break;
    case "bankTrade":
      doBankTrade(g, adj, uid, action.give, action.get);
      break;
    case "proposeTrade":
      doProposeTrade(g, uid, action.give, action.want);
      break;
    case "respondTrade":
      doRespondTrade(g, uid, action.accept);
      break;
    case "confirmTrade":
      doConfirmTrade(g, uid, action.partner);
      break;
    case "cancelTrade":
      doCancelTrade(g, uid);
      break;
    case "playProgress":
      playProgress(g, adj, uid, action.card, action.params ?? {});
      break;
    case "endTurn":
      doEndTurn(g, uid);
      break;
    case "timeout":
      doTimeout(g, adj, uid);
      break;
    default:
      throw new RuleError("Unknown action.");
  }

  recomputeVictoryPoints(g);
  checkWinner(g);
  // Reward staying active: each action the current player takes during their
  // own turn nudges their clock forward a little (capped at a full turn).
  if (action.type !== "endTurn" && action.type !== "timeout") {
    bumpTurnDeadline(g, uid);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Guards & resource helpers
// ---------------------------------------------------------------------------

function currentUid(g: GameState): string {
  return g.order[g.current];
}

function requireTurn(g: GameState, uid: string): void {
  if (currentUid(g) !== uid) throw new RuleError("It's not your turn.");
}

function requireStep(g: GameState, step: GameState["step"]): void {
  if (g.step !== step) throw new RuleError(`You can't do that now (step: ${g.step}).`);
}

function isResource(k: Resource | Commodity): k is Resource {
  return (RESOURCES as readonly string[]).includes(k);
}

function bagGet(p: PlayerState, k: Resource | Commodity): number {
  return isResource(k) ? p.resources[k] : p.commodities[k as Commodity];
}

function bagAdd(p: PlayerState, k: Resource | Commodity, n: number): void {
  if (isResource(k)) p.resources[k] += n;
  else p.commodities[k as Commodity] += n;
}

function canAfford(p: PlayerState, cost: CostBag): boolean {
  return Object.entries(cost).every(
    ([k, n]) => bagGet(p, k as Resource | Commodity) >= (n ?? 0)
  );
}

function pay(p: PlayerState, cost: CostBag): void {
  if (!canAfford(p, cost)) throw new RuleError("Not enough resources.");
  for (const [k, n] of Object.entries(cost)) {
    bagAdd(p, k as Resource | Commodity, -(n ?? 0));
  }
}

function handCount(p: PlayerState): number {
  return (
    Object.values(p.resources).reduce((a, b) => a + b, 0) +
    Object.values(p.commodities).reduce((a, b) => a + b, 0)
  );
}

function log(g: GameState, msg: string): void {
  g.ticker.push(msg);
  if (g.ticker.length > 200) g.ticker.shift();
}

// ---------------------------------------------------------------------------
// Setup phase
// ---------------------------------------------------------------------------

function doSetupSettlement(g: GameState, adj: Adjacency, uid: string, vid: string): void {
  requireTurn(g, uid);
  requireStep(g, "setupSettlement");
  const v = g.vertices[vid];
  if (!v) throw new RuleError("No such spot.");
  if (v.building) throw new RuleError("That spot is taken.");
  // Distance rule: no adjacent settlement/city.
  for (const n of adj.vertexNeighbors.get(vid) ?? []) {
    if (g.vertices[n]?.building) throw new RuleError("Too close to another building.");
  }
  const p = g.players[uid];
  // Cities & Knights: the FIRST setup placement is a settlement, the SECOND
  // (in setup2) is a city — which also yields the starting production.
  if (g.phase === "setup2") {
    v.building = { type: "city", owner: p.color };
    p.pieces.cities--;
    g.lastSetupVertex = vid;
    grantVertexProduction(g, adj, vid);
    g.step = "setupRoad";
    log(g, `${p.name} placed a city.`);
    return;
  }
  v.building = { type: "settlement", owner: p.color };
  p.pieces.settlements--;
  g.lastSetupVertex = vid;
  g.step = "setupRoad";
  log(g, `${p.name} placed a settlement.`);
}

function doSetupRoad(g: GameState, adj: Adjacency, uid: string, eid: string): void {
  requireTurn(g, uid);
  requireStep(g, "setupRoad");
  const e = g.edges[eid];
  if (!e) throw new RuleError("No such road spot.");
  if (e.road) throw new RuleError("That road is taken.");
  const ends = adj.edgeEnds.get(eid);
  if (!ends || !ends.includes(g.lastSetupVertex ?? "")) {
    throw new RuleError("Road must touch the settlement you just placed.");
  }
  const p = g.players[uid];
  e.road = p.color;
  p.pieces.roads--;
  g.lastSetupVertex = undefined;
  advanceSetup(g);
}

/** Advances the snake-draft setup order. */
function advanceSetup(g: GameState): void {
  const n = g.order.length;
  if (g.phase === "setup1") {
    if (g.current < n - 1) {
      g.current++;
    } else {
      // last player places again to start setup2 (snake)
      g.phase = "setup2";
    }
    g.step = "setupSettlement";
  } else if (g.phase === "setup2") {
    if (g.current > 0) {
      g.current--;
      g.step = "setupSettlement";
    } else {
      // setup complete
      g.phase = "play";
      g.current = 0;
      g.step = "roll";
      resetTurnDeadline(g);
      log(g, "Setup complete. Let the game begin!");
    }
  }
}

// ---------------------------------------------------------------------------
// Rolling dice, production & the event die
// ---------------------------------------------------------------------------

/** Real 2d6 sum frequencies out of 36 (the target bell curve). */
const SUM_FREQ: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1
};
const SUM_TOTAL = 36;
const BELL_K = 1.8; // pull cumulative counts toward the bell curve
const FAIR_K = 0.6; // favour under-producing players a little

function rollEventDie(): EventDie {
  // 3 ship faces, 1 each of trade/politics/science.
  const faces: EventDie[] = ["ship", "ship", "ship", "trade", "politics", "science"];
  return faces[Math.floor(Math.random() * 6)];
}

/** Which uids benefit (and how much) if `sum` is rolled, from current board
 *  placements — settlement = 1, city = 2 per adjacent producing hex. */
function benefitBySum(g: GameState, adj: Adjacency, sum: number): Map<string, number> {
  const out = new Map<string, number>();
  if (sum === 7) return out;
  for (const hex of Object.values(g.hexes)) {
    if (hex.number !== sum || hex.robber) continue;
    if (!TERRAIN_RESOURCE[hex.terrain]) continue;
    for (const [vid, hexes] of adj.vertexHexes) {
      if (!hexes.includes(hex.id)) continue;
      const b = g.vertices[vid]?.building;
      if (!b) continue;
      const uid = g.order.find((u) => g.players[u].color === b.owner);
      if (!uid) continue;
      out.set(uid, (out.get(uid) ?? 0) + (b.type === "city" ? 2 : 1));
    }
  }
  return out;
}

/** Picks a dice sum with weights that (a) pull cumulative counts toward the
 *  real 2d6 distribution and (b) gently favour players who have produced the
 *  least so far, then splits it into a plausible white+red pair. */
function chooseBalancedRoll(
  g: GameState,
  adj: Adjacency
): { white: number; red: number; sum: number } {
  const counts = g.rollCounts ?? {};
  let totalRolls = 0;
  for (let n = 2; n <= 12; n++) totalRolls += counts[n] ?? 0;

  const tally = g.productionTally ?? {};
  const produced = g.order.map((u) => tally[u] ?? 0);
  const avg = produced.length ? produced.reduce((a, b) => a + b, 0) / produced.length : 0;
  const behind: Record<string, number> = {};
  for (const u of g.order) behind[u] = Math.max(0, avg - (tally[u] ?? 0));

  const sums: number[] = [];
  const weights: number[] = [];
  for (let n = 2; n <= 12; n++) {
    const p0 = SUM_FREQ[n] / SUM_TOTAL;
    const expected = (totalRolls + 1) * p0;
    const actual = counts[n] ?? 0;
    const deficit = (expected - actual) / (expected + 1); // >0 when under-rolled
    const bell = Math.max(0.15, 1 + BELL_K * deficit);

    let fairScore = 0;
    for (const [uid, amt] of benefitBySum(g, adj, n)) fairScore += amt * (behind[uid] ?? 0);
    const fair = Math.max(0.4, 1 + FAIR_K * (fairScore / (avg + 1)));

    sums.push(n);
    weights.push(p0 * bell * fair);
  }

  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let sum = 7;
  for (let i = 0; i < sums.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      sum = sums[i];
      break;
    }
  }

  const combos: Array<[number, number]> = [];
  for (let w = 1; w <= 6; w++) {
    const rd = sum - w;
    if (rd >= 1 && rd <= 6) combos.push([w, rd]);
  }
  const [white, red] = combos[Math.floor(Math.random() * combos.length)];
  return { white, red, sum };
}

function doRoll(g: GameState, adj: Adjacency, uid: string): void {
  requireTurn(g, uid);
  requireStep(g, "roll");
  let white: number;
  let red: number;
  if (g.alchemistDice) {
    white = g.alchemistDice.white;
    red = g.alchemistDice.red;
    g.alchemistDice = undefined;
    log(g, `${g.players[uid].name} used the Alchemist to set the dice.`);
  } else {
    const roll = chooseBalancedRoll(g, adj);
    white = roll.white;
    red = roll.red;
  }
  const event = rollEventDie();
  g.lastRoll = { white, red, event };
  const sum = white + red;
  if (!g.rollCounts) g.rollCounts = {};
  g.rollCounts[sum] = (g.rollCounts[sum] ?? 0) + 1;
  log(g, `${g.players[uid].name} rolled ${white}+${red}=${sum} (event: ${event}).`);

  // 1) Event die first (barbarians / progress cards).
  resolveEventDie(g, event, red);

  // 2) Production or robber.
  if (sum === 7) {
    if (g.barbarians.attacks > 0) {
      beginSevenFlow(g);
      return; // stay in discard/robber flow
    }
    log(g, "A 7 was rolled, but the robber is not active until the barbarians attack.");
    g.step = "main";
    return;
  }

  produce(g, adj, sum);
  g.step = "main";
}

function resolveEventDie(g: GameState, event: EventDie, red: number): void {
  if (event === "ship") {
    g.barbarians.position++;
    log(g, `Barbarians advance to ${g.barbarians.position}/${BARBARIAN_TARGET}.`);
    if (g.barbarians.position >= BARBARIAN_TARGET) {
      resolveBarbarianAttack(g);
      g.barbarians.position = 0;
      g.barbarians.attacks++;
    }
    return;
  }
  // Coloured face -> progress cards for players with high enough improvement.
  const discipline = event as Discipline;
  const deck: ProgressDeck = discipline;
  for (const playerUid of g.order) {
    const p = g.players[playerUid];
    if (p.improvements[discipline] >= red) {
      const card = g.decks[deck].shift();
      if (card) {
        giveProgressCard(g, playerUid, card);
        log(g, `${p.name} drew a ${discipline} progress card.`);
      }
    }
  }
}

/** Adds a drawn card to a hand, or counts it as a VP if it's a VP card. */
function giveProgressCard(g: GameState, uid: string, card: ProgressCard): void {
  if (card === "constitution" || card === "printer") {
    g.players[uid].vpCards++;
    log(g, `${g.players[uid].name} gained a victory-point card (+1 VP).`);
  } else {
    g.players[uid].progressCards.push(card);
  }
}

function produce(g: GameState, adj: Adjacency, sum: number): void {
  // Per-player gains this roll, for the log (e.g. "Alice: +1 sheep, +1 ore").
  const gains: Record<string, Record<string, number>> = {};
  const addGain = (uid: string, kind: string, n: number) => {
    (gains[uid] ??= {})[kind] = (gains[uid][kind] ?? 0) + n;
  };
  for (const hex of Object.values(g.hexes)) {
    if (hex.number !== sum || hex.robber) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res) continue;
    const commodity = TERRAIN_COMMODITY[hex.terrain];
    // Find buildings on this hex's corners.
    for (const [vid, hexes] of adj.vertexHexes) {
      if (!hexes.includes(hex.id)) continue;
      const b = g.vertices[vid]?.building;
      if (!b) continue;
      const ownerUid = g.order.find((u) => g.players[u].color === b.owner);
      if (!ownerUid) continue;
      const p = g.players[ownerUid];
      const tally = g.productionTally ?? (g.productionTally = {});
      if (b.type === "settlement") {
        bagAdd(p, res, 1);
        addGain(ownerUid, res, 1);
        tally[ownerUid] = (tally[ownerUid] ?? 0) + 1;
      } else {
        // City: commodity terrains give 1 resource + 1 commodity; others give 2.
        if (commodity) {
          bagAdd(p, res, 1);
          bagAdd(p, commodity, 1);
          addGain(ownerUid, res, 1);
          addGain(ownerUid, commodity, 1);
        } else {
          bagAdd(p, res, 2);
          addGain(ownerUid, res, 2);
        }
        tally[ownerUid] = (tally[ownerUid] ?? 0) + 2;
      }
    }
  }
  const lines = g.order
    .filter((u) => gains[u])
    .map((u) => {
      const parts = Object.entries(gains[u]).map(([kind, n]) => `+${n} ${kind}`);
      return `${g.players[u].name}: ${parts.join(", ")}`;
    });
  if (lines.length) {
    for (const line of lines) log(g, line);
  } else {
    log(g, `No production for ${sum}.`);
  }
}

/** Grant starting production for the 2nd setup placement (the city). Per
 *  Cities & Knights, the initial placement yields only RESOURCES (one per
 *  adjacent hex) — commodities are produced only later, on dice rolls. */
function grantVertexProduction(g: GameState, adj: Adjacency, vid: string): void {
  const b = g.vertices[vid]?.building;
  if (!b) return;
  const ownerUid = g.order.find((u) => g.players[u].color === b.owner);
  if (!ownerUid) return;
  const p = g.players[ownerUid];
  for (const hexId of adj.vertexHexes.get(vid) ?? []) {
    const res = TERRAIN_RESOURCE[g.hexes[hexId].terrain];
    if (res) bagAdd(p, res, 1);
  }
}

// ---------------------------------------------------------------------------
// The 7: discard, move robber, steal
// ---------------------------------------------------------------------------

function beginSevenFlow(g: GameState): void {
  const pending: Record<string, number> = {};
  for (const uid of g.order) {
    const p = g.players[uid];
    const limit = anyCityWall(g, p.color) ? BASE_HAND_LIMIT + 2 : BASE_HAND_LIMIT;
    const count = handCount(p);
    if (count > limit) pending[uid] = Math.floor(count / 2);
  }
  if (Object.keys(pending).length > 0) {
    g.pendingDiscards = pending;
    g.step = "discard";
    log(g, "Players over the limit must discard half their cards.");
  } else {
    g.step = "moveRobber";
  }
}

function anyCityWall(g: GameState, color: string): boolean {
  return Object.values(g.vertices).some(
    (v) => v.building?.owner === color && v.building.wall
  );
}

function doDiscard(g: GameState, uid: string, give: CostBag): void {
  requireStep(g, "discard");
  const owed = g.pendingDiscards?.[uid];
  if (!owed) throw new RuleError("You don't need to discard.");
  const total = Object.values(give).reduce((a, b) => a + (b ?? 0), 0);
  if (total !== owed) throw new RuleError(`You must discard exactly ${owed}.`);
  const p = g.players[uid];
  pay(p, give);
  delete g.pendingDiscards![uid];
  log(g, `${p.name} discarded ${owed} cards.`);
  if (Object.keys(g.pendingDiscards!).length === 0) {
    g.pendingDiscards = undefined;
    g.step = "moveRobber";
  }
}

function doMoveRobber(g: GameState, adj: Adjacency, uid: string, hexId: string): void {
  requireTurn(g, uid);
  requireStep(g, "moveRobber");
  relocateRobber(g, adj, uid, hexId);
}

/** Places the robber on a new land hex and opens the steal step if anyone is hit. */
function relocateRobber(g: GameState, adj: Adjacency, uid: string, hexId: string): void {
  const target = g.hexes[hexId];
  if (!target) throw new RuleError("No such hex.");
  if (target.id === g.robberHex) throw new RuleError("Robber must move to a new hex.");
  if (target.terrain === "sea") throw new RuleError("Robber can't go on the sea.");

  for (const h of Object.values(g.hexes)) h.robber = false;
  target.robber = true;
  g.robberHex = hexId;

  // Candidates to steal from: owners of buildings on this hex (not self).
  const victims = new Set<string>();
  for (const [vid, hexes] of adj.vertexHexes) {
    if (!hexes.includes(hexId)) continue;
    const color = g.vertices[vid]?.building?.owner;
    if (!color) continue;
    const owner = g.order.find((u) => g.players[u].color === color);
    if (owner && owner !== uid && handCount(g.players[owner]) > 0) victims.add(owner);
  }
  log(g, `${g.players[uid].name} moved the robber.`);
  if (victims.size === 0) {
    g.step = "main";
  } else {
    g.robberVictims = [...victims];
    g.step = "stealChoice";
  }
}

function doSteal(g: GameState, uid: string, target: string): void {
  requireTurn(g, uid);
  requireStep(g, "stealChoice");
  if (!g.robberVictims?.includes(target)) throw new RuleError("Can't steal from them.");
  const victim = g.players[target];
  const pool: (Resource | Commodity)[] = [];
  for (const r of RESOURCES) for (let i = 0; i < victim.resources[r]; i++) pool.push(r);
  for (const c of ["cloth", "coin", "paper"] as Commodity[])
    for (let i = 0; i < victim.commodities[c]; i++) pool.push(c);
  if (pool.length > 0) {
    const picked = pool[Math.floor(Math.random() * pool.length)];
    bagAdd(victim, picked, -1);
    bagAdd(g.players[uid], picked, 1);
    log(g, `${g.players[uid].name} stole a card from ${victim.name}.`);
  }
  g.robberVictims = undefined;
  g.step = "main";
}

// ---------------------------------------------------------------------------
// Barbarians
// ---------------------------------------------------------------------------

function activeKnightStrength(g: GameState, uid: string): number {
  return Object.values(g.knights)
    .filter((k) => g.players[uid].color === k.owner && k.active)
    .reduce((s, k) => s + k.rank, 0);
}

function cityCount(g: GameState, color: string): number {
  return Object.values(g.vertices).filter(
    (v) => v.building?.type === "city" && v.building.owner === color
  ).length;
}

function resolveBarbarianAttack(g: GameState): void {
  const attack = g.order.reduce((s, uid) => s + cityCount(g, g.players[uid].color), 0);
  const defense = g.order.reduce((s, uid) => s + activeKnightStrength(g, uid), 0);
  log(g, `Barbarians attack! Strength ${attack} vs knights ${defense}.`);

  if (defense >= attack && attack > 0) {
    // Defenders win — strongest knight contributor earns Defender of Catan VP.
    const strengths = g.order.map((uid) => ({ uid, s: activeKnightStrength(g, uid) }));
    const max = Math.max(...strengths.map((x) => x.s));
    const top = strengths.filter((x) => x.s === max && x.s > 0);
    if (top.length === 1) {
      g.players[top[0].uid].defenderPoints++;
      log(g, `${g.players[top[0].uid].name} is the Defender of Catan (+1 VP).`);
    } else if (top.length > 1) {
      for (const t of top) {
        const deck = strongestDeckFor(g, t.uid);
        const card = g.decks[deck].shift();
        if (card) giveProgressCard(g, t.uid, card);
      }
      log(g, "Defenders tied — each strongest defender draws a progress card.");
    }
  } else if (attack > 0) {
    // Barbarians win — weakest contributor(s) lose a city.
    const eligible = g.order
      .map((uid) => ({ uid, s: activeKnightStrength(g, uid), c: cityCount(g, g.players[uid].color) }))
      .filter((x) => x.c > 0);
    if (eligible.length > 0) {
      const min = Math.min(...eligible.map((x) => x.s));
      for (const e of eligible.filter((x) => x.s === min)) {
        downgradeOneCity(g, g.players[e.uid].color);
        log(g, `${g.players[e.uid].name} lost a city to the barbarians!`);
      }
    }
  }

  // All knights are deactivated after the attack.
  for (const k of Object.values(g.knights)) k.active = false;
}

function strongestDeckFor(g: GameState, uid: string): ProgressDeck {
  const p = g.players[uid];
  const order: Discipline[] = ["trade", "politics", "science"];
  order.sort((a, b) => p.improvements[b] - p.improvements[a]);
  return order[0];
}

function downgradeOneCity(g: GameState, color: string): void {
  const city = Object.values(g.vertices).find(
    (v) => v.building?.type === "city" && v.building.owner === color && !v.building.metropolis
  );
  if (!city || !city.building) return;
  city.building.type = "settlement";
  city.building.wall = false;
  const uid = g.order.find((u) => g.players[u].color === color);
  if (uid) {
    g.players[uid].pieces.cities++;
    g.players[uid].pieces.settlements--;
  }
}

// ---------------------------------------------------------------------------
// Building (during play)
// ---------------------------------------------------------------------------

function ownsAdjacentRoadOrBuilding(
  g: GameState,
  adj: Adjacency,
  color: string,
  vid: string
): boolean {
  for (const eid of adj.vertexEdges.get(vid) ?? []) {
    if (g.edges[eid]?.road === color) return true;
  }
  return false;
}

function doBuildRoad(
  g: GameState,
  adj: Adjacency,
  uid: string,
  eid: string,
  free: boolean
): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const e = g.edges[eid];
  if (!e) throw new RuleError("No such road spot.");
  if (e.road) throw new RuleError("Road already there.");
  const p = g.players[uid];
  if (p.pieces.roads <= 0) throw new RuleError("No road pieces left.");
  // Must connect to your network.
  const ends = adj.edgeEnds.get(eid) ?? [];
  const connected = ends.some(
    (v) =>
      g.vertices[v]?.building?.owner === p.color ||
      (adj.vertexEdges.get(v) ?? []).some((x) => g.edges[x]?.road === p.color)
  );
  if (!connected) throw new RuleError("Road must connect to your network.");
  const useFree = free || (g.freeRoads?.uid === uid && g.freeRoads.count > 0);
  if (!useFree) pay(p, COSTS.road);
  else if (g.freeRoads && g.freeRoads.uid === uid) {
    g.freeRoads.count--;
    if (g.freeRoads.count <= 0) g.freeRoads = undefined;
  }
  e.road = p.color;
  p.pieces.roads--;
  recomputeLongestRoad(g, adj);
  log(g, `${p.name} built a road.`);
}

function doBuildSettlement(
  g: GameState,
  adj: Adjacency,
  uid: string,
  vid: string,
  free: boolean
): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const v = g.vertices[vid];
  if (!v) throw new RuleError("No such spot.");
  if (v.building) throw new RuleError("Spot is taken.");
  const p = g.players[uid];
  if (p.pieces.settlements <= 0) throw new RuleError("No settlement pieces left.");
  for (const n of adj.vertexNeighbors.get(vid) ?? []) {
    if (g.vertices[n]?.building) throw new RuleError("Too close to another building.");
  }
  if (!ownsAdjacentRoadOrBuilding(g, adj, p.color, vid)) {
    throw new RuleError("Settlement must connect to your road.");
  }
  if (!free) pay(p, COSTS.settlement);
  v.building = { type: "settlement", owner: p.color };
  p.pieces.settlements--;
  recomputeLongestRoad(g, adj);
  log(g, `${p.name} built a settlement.`);
}

function doBuildCity(g: GameState, uid: string, vid: string): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const v = g.vertices[vid];
  const p = g.players[uid];
  if (!v?.building || v.building.owner !== p.color) throw new RuleError("Not your settlement.");
  if (v.building.type !== "settlement") throw new RuleError("Already a city.");
  if (p.pieces.cities <= 0) throw new RuleError("No city pieces left.");
  pay(p, COSTS.city);
  v.building.type = "city";
  p.pieces.cities--;
  p.pieces.settlements++;
  log(g, `${p.name} upgraded to a city.`);
}

function doBuildWall(g: GameState, uid: string, vid: string): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const v = g.vertices[vid];
  const p = g.players[uid];
  if (!v?.building || v.building.owner !== p.color) throw new RuleError("Not your city.");
  if (v.building.type !== "city") throw new RuleError("Walls go on cities.");
  if (v.building.wall) throw new RuleError("Already walled.");
  if (p.pieces.walls <= 0) throw new RuleError("No wall pieces left.");
  pay(p, COSTS.cityWall);
  v.building.wall = true;
  p.pieces.walls--;
  log(g, `${p.name} built a city wall.`);
}

// ---------------------------------------------------------------------------
// Knights
// ---------------------------------------------------------------------------

function doBuildKnight(g: GameState, adj: Adjacency, uid: string, vid: string): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const v = g.vertices[vid];
  const p = g.players[uid];
  if (!v) throw new RuleError("No such spot.");
  if (v.building) throw new RuleError("Spot occupied by a building.");
  if (Object.values(g.knights).some((k) => k.vertex === vid)) {
    throw new RuleError("A knight is already there.");
  }
  if (p.pieces.knights <= 0) throw new RuleError("No knight pieces left.");
  if (!ownsAdjacentRoadOrBuilding(g, adj, p.color, vid)) {
    throw new RuleError("Knight must be on your road network.");
  }
  pay(p, COSTS.knightBuild);
  const id = `k${Object.keys(g.knights).length + 1}_${uid.slice(0, 4)}`;
  g.knights[id] = { id, owner: p.color, rank: 1, active: false, vertex: vid };
  p.pieces.knights--;
  log(g, `${p.name} recruited a knight.`);
}

function doActivateKnight(g: GameState, uid: string, knightId: string): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const k = g.knights[knightId];
  const p = g.players[uid];
  if (!k || k.owner !== p.color) throw new RuleError("Not your knight.");
  if (k.active) throw new RuleError("Already active.");
  pay(p, COSTS.knightActivate);
  k.active = true;
  log(g, `${p.name} activated a knight.`);
}

function doPromoteKnight(g: GameState, uid: string, knightId: string): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const k = g.knights[knightId];
  const p = g.players[uid];
  if (!k || k.owner !== p.color) throw new RuleError("Not your knight.");
  if (k.rank >= 3) throw new RuleError("Already a mighty knight.");
  // You can't have more knights of a higher rank than your highest improvement
  // allows when promoting to mighty (level 3 needs political improvement >=3).
  if (k.rank === 2 && p.improvements.politics < 3) {
    throw new RuleError("Need Politics level 3 to promote to a mighty knight.");
  }
  pay(p, COSTS.knightPromote);
  k.rank = (k.rank + 1) as 2 | 3;
  log(g, `${p.name} promoted a knight to rank ${k.rank}.`);
}

/** What occupies a vertex (a building or a knight), if anything. */
function occupantAt(
  g: GameState,
  vid: string
): { kind: "building" | "knight"; color: string } | null {
  const b = g.vertices[vid]?.building;
  if (b) return { kind: "building", color: b.owner };
  const k = Object.values(g.knights).find((kn) => kn.vertex === vid);
  if (k) return { kind: "knight", color: k.owner };
  return null;
}

/**
 * Vertices a knight can reach along its owner's roads: `empty` are open landing
 * spots (also passed through), `enemies` hold a rival knight and can only be a
 * displacement target (the path stops there).
 */
function knightReachable(
  g: GameState,
  adj: Adjacency,
  k: Knight
): { empty: Set<string>; enemies: Set<string> } {
  const color = k.owner;
  const visited = new Set<string>([k.vertex]);
  const queue: string[] = [k.vertex];
  const empty = new Set<string>();
  const enemies = new Set<string>();
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const eid of adj.vertexEdges.get(cur) ?? []) {
      if (g.edges[eid]?.road !== color) continue;
      const ends = adj.edgeEnds.get(eid);
      if (!ends) continue;
      const nxt = ends[0] === cur ? ends[1] : ends[0];
      if (visited.has(nxt)) continue;
      visited.add(nxt);
      const occ = occupantAt(g, nxt);
      if (!occ) {
        empty.add(nxt);
        queue.push(nxt);
      } else if (occ.kind === "knight" && occ.color !== color) {
        enemies.add(nxt);
      }
      // Own pieces and rival buildings block the path: don't enqueue.
    }
  }
  return { empty, enemies };
}

function doMoveKnight(g: GameState, adj: Adjacency, uid: string, knightId: string, to: string): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const p = g.players[uid];
  const k = g.knights[knightId];
  if (!k || k.owner !== p.color) throw new RuleError("Not your knight.");
  if (!k.active) throw new RuleError("Activate the knight before moving it.");
  if (k.usedThisTurn) throw new RuleError("That knight has already acted this turn.");
  if (!knightReachable(g, adj, k).empty.has(to)) {
    throw new RuleError("Can't move there — knights travel along your own roads.");
  }
  k.vertex = to;
  k.usedThisTurn = true;
  log(g, `${p.name} moved a knight.`);
}

function doDisplaceKnight(
  g: GameState,
  adj: Adjacency,
  uid: string,
  knightId: string,
  to: string
): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const p = g.players[uid];
  const k = g.knights[knightId];
  if (!k || k.owner !== p.color) throw new RuleError("Not your knight.");
  if (!k.active) throw new RuleError("Activate the knight before moving it.");
  if (k.usedThisTurn) throw new RuleError("That knight has already acted this turn.");
  if (!knightReachable(g, adj, k).enemies.has(to)) {
    throw new RuleError("No reachable rival knight there.");
  }
  const enemy = Object.values(g.knights).find((kn) => kn.vertex === to);
  if (!enemy) throw new RuleError("No knight to displace there.");
  if (k.rank <= enemy.rank) throw new RuleError("Your knight must be stronger to chase it off.");
  // Take the intersection; the displaced knight must retreat.
  k.vertex = to;
  k.usedThisTurn = true;
  relocateDisplaced(g, adj, enemy);
  const enemyUid = colorToUidLocal(g, enemy.owner);
  log(g, `${p.name} chased off ${enemyUid ? g.players[enemyUid].name : "a"}'s knight.`);
}

/** Sends a displaced knight to an adjacent empty intersection on its owner's
 *  roads, or removes it (back to supply) if it has nowhere to go. */
function relocateDisplaced(g: GameState, adj: Adjacency, knight: Knight): void {
  const spot = knightReachable(g, adj, knight).empty.values().next();
  const ownerUid = colorToUidLocal(g, knight.owner);
  if (!spot.done && spot.value) {
    knight.vertex = spot.value;
    if (ownerUid) log(g, `${g.players[ownerUid].name}'s knight retreated.`);
  } else {
    delete g.knights[knight.id];
    if (ownerUid) {
      g.players[ownerUid].pieces.knights++;
      log(g, `${g.players[ownerUid].name}'s knight had nowhere to go and left the board.`);
    }
  }
}

function colorToUidLocal(g: GameState, color: string): string | undefined {
  return g.order.find((u) => g.players[u].color === color);
}

/** Use an active knight next to the robber to chase it to a new hex and steal. */
function doChaseRobber(
  g: GameState,
  adj: Adjacency,
  uid: string,
  knightId: string,
  hexId: string
): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const p = g.players[uid];
  const k = g.knights[knightId];
  if (!k || k.owner !== p.color) throw new RuleError("Not your knight.");
  if (!k.active) throw new RuleError("Activate the knight first.");
  if (k.usedThisTurn) throw new RuleError("That knight has already acted this turn.");
  if (!(adj.vertexHexes.get(k.vertex) ?? []).includes(g.robberHex)) {
    throw new RuleError("Knight must sit next to the robber to chase it.");
  }
  k.usedThisTurn = true;
  relocateRobber(g, adj, uid, hexId);
}

// ---------------------------------------------------------------------------
// City improvements (commodities)
// ---------------------------------------------------------------------------

function doBuyImprovement(g: GameState, uid: string, discipline: Discipline): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const p = g.players[uid];
  const level = p.improvements[discipline];
  if (level >= MAX_IMPROVEMENT) throw new RuleError("Already maxed.");
  const target = level + 1;
  const commodity = DISCIPLINE_COMMODITY[discipline];
  const cost = improvementCost(target);
  if (p.commodities[commodity] < cost) {
    throw new RuleError(`Need ${cost} ${commodity}.`);
  }
  p.commodities[commodity] -= cost;
  p.improvements[discipline] = target;
  log(g, `${p.name} improved ${discipline} to level ${target}.`);

  // Reaching the metropolis level lets you claim the metropolis if unclaimed
  // (or steal it from a lower-level holder). One per discipline.
  if (target >= METROPOLIS_LEVEL) {
    tryClaimMetropolis(g, uid, discipline, target);
  }
}

function tryClaimMetropolis(
  g: GameState,
  uid: string,
  discipline: Discipline,
  level: number
): void {
  const holder = g.metropolisOwner[discipline];
  if (holder === uid) return;
  const holderLevel = holder ? g.players[holder].improvements[discipline] : 0;
  if (holder && holderLevel >= level) return; // can't take from equal/higher

  // Must have a city to host the metropolis.
  const city = Object.values(g.vertices).find(
    (v) => v.building?.type === "city" && v.building.owner === g.players[uid].color && !v.building.metropolis
  );
  if (!city || !city.building) return;

  // Remove from previous holder.
  if (holder) {
    const prev = Object.values(g.vertices).find(
      (v) => v.building?.metropolis === discipline
    );
    if (prev?.building) prev.building.metropolis = undefined;
    g.players[holder].metropolis[discipline] = false;
  }
  city.building.metropolis = discipline;
  g.players[uid].metropolis[discipline] = true;
  g.metropolisOwner[discipline] = uid;
  log(g, `${g.players[uid].name} claimed the ${discipline} metropolis (+2 VP)!`);
}

// ---------------------------------------------------------------------------
// Bank / harbor trade
// ---------------------------------------------------------------------------

function bestRate(g: GameState, uid: string, give: Resource | Commodity): number {
  const color = g.players[uid].color;
  let rate = 4;
  for (const v of Object.values(g.vertices)) {
    if (v.building?.owner !== color || !v.harbor) continue;
    if (v.harbor === "any") rate = Math.min(rate, 3);
    else if (v.harbor === give) rate = Math.min(rate, 2);
  }
  // Merchant: 2:1 on the resource of the hex the merchant sits on (if you own it).
  if (g.merchantOwner === uid && g.merchantHex) {
    const res = TERRAIN_RESOURCE[g.hexes[g.merchantHex]?.terrain];
    if (res && res === give) rate = Math.min(rate, 2);
  }
  // Merchant Fleet: 2:1 on the chosen type for this turn.
  if (g.fleet?.uid === uid && g.fleet.type === give) rate = Math.min(rate, 2);
  return rate;
}

function doBankTrade(
  g: GameState,
  _adj: Adjacency,
  uid: string,
  give: Resource | Commodity,
  get: Resource | Commodity
): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  const p = g.players[uid];
  const rate = bestRate(g, uid, give);
  if (bagGet(p, give) < rate) throw new RuleError(`Need ${rate} ${give} to trade.`);
  bagAdd(p, give, -rate);
  bagAdd(p, get, 1);
  log(g, `${p.name} traded ${rate} ${give} for 1 ${get}.`);
}

// ---------------------------------------------------------------------------
// Longest road, victory points, turn end
// ---------------------------------------------------------------------------

function recomputeLongestRoad(g: GameState, adj: Adjacency): void {
  let best: { uid: string; len: number } | null = null;
  for (const uid of g.order) {
    const len = longestRoadFor(g, adj, g.players[uid].color);
    if (len >= 5 && (!best || len > best.len)) best = { uid, len };
  }
  for (const uid of g.order) g.players[uid].hasLongestRoad = false;
  g.longestRoadOwner = best?.uid;
  if (best) g.players[best.uid].hasLongestRoad = true;
}

/** Longest contiguous road length for a color (simple DFS over owned edges). */
function longestRoadFor(g: GameState, adj: Adjacency, color: string): number {
  const ownEdges = Object.values(g.edges).filter((e) => e.road === color);
  let best = 0;
  for (const start of ownEdges) {
    best = Math.max(best, dfsRoad(g, adj, color, start.id, new Set()));
  }
  return best;
}

function dfsRoad(
  g: GameState,
  adj: Adjacency,
  color: string,
  edgeId: string,
  visited: Set<string>
): number {
  visited.add(edgeId);
  const ends = adj.edgeEnds.get(edgeId) ?? [];
  let best = 1;
  for (const v of ends) {
    // A road is broken at a vertex occupied by an opponent building.
    const b = g.vertices[v]?.building;
    if (b && b.owner !== color) continue;
    for (const nextEdge of adj.vertexEdges.get(v) ?? []) {
      if (visited.has(nextEdge)) continue;
      if (g.edges[nextEdge]?.road !== color) continue;
      best = Math.max(best, 1 + dfsRoad(g, adj, color, nextEdge, new Set(visited)));
    }
  }
  return best;
}

function recomputeVictoryPoints(g: GameState): void {
  for (const uid of g.order) {
    const p = g.players[uid];
    let vp = 0;
    for (const v of Object.values(g.vertices)) {
      if (v.building?.owner !== p.color) continue;
      vp += v.building.type === "city" ? 2 : 1;
      if (v.building.metropolis) vp += 2; // metropolis worth 2 extra
    }
    if (p.hasLongestRoad) vp += 2;
    vp += p.defenderPoints;
    vp += p.vpCards;
    if (g.merchantOwner === uid) vp += 1;
    p.victoryPoints = vp;
  }
}

function checkWinner(g: GameState): void {
  if (g.phase !== "play") return;
  // You can only win on your own turn.
  const cur = currentUid(g);
  if (g.players[cur].victoryPoints >= g.targetPoints) {
    g.winner = cur;
    g.phase = "finished";
    log(g, `${g.players[cur].name} wins with ${g.players[cur].victoryPoints} points!`);
  }
}

function doEndTurn(g: GameState, uid: string): void {
  requireTurn(g, uid);
  if (g.step !== "main") throw new RuleError("Finish your current action first.");
  endTurnInternal(g);
}

/** Advances to the next player and resets per-turn transients + the clock. */
function endTurnInternal(g: GameState): void {
  // Clear per-turn transients (fleet, leftover free roads, unused alchemist).
  g.fleet = undefined;
  g.freeRoads = undefined;
  g.alchemistDice = undefined;
  g.tradeOffer = undefined;
  // Knights can act again next turn.
  for (const k of Object.values(g.knights)) k.usedThisTurn = false;
  g.current = (g.current + 1) % g.order.length;
  g.step = "roll";
  resetTurnDeadline(g);
  log(g, `${g.players[currentUid(g)].name}'s turn.`);
}

/** (Re)starts the turn clock for the active player, if a limit is set. */
function resetTurnDeadline(g: GameState): void {
  g.turnDeadline = g.turnTimer > 0 ? Date.now() + g.turnTimer * 1000 : undefined;
}

/** Fraction of the full turn length added to the clock per action. */
const TURN_BONUS_FRACTION = 0.1;

/**
 * Extends the active player's turn deadline by a small percentage of the full
 * turn length whenever they take an action, so an engaged player isn't cut off
 * mid-move. The remaining time is capped at one full turn to prevent stalling.
 */
function bumpTurnDeadline(g: GameState, uid: string): void {
  if (g.phase !== "play" || g.turnTimer <= 0 || !g.turnDeadline) return;
  if (g.order[g.current] !== uid) return; // only the active player's own actions
  const bonusMs = g.turnTimer * 1000 * TURN_BONUS_FRACTION;
  const cap = Date.now() + g.turnTimer * 1000;
  g.turnDeadline = Math.min(g.turnDeadline + bonusMs, cap);
}

/**
 * Fired by the active player's client when their turn clock hits zero.
 * Rolls for them if they haven't, then ends the turn when it is safe to do so.
 * If a blocking sub-step is open (discard / robber), the clock is simply
 * restarted so they still get time to resolve it.
 */
function doTimeout(g: GameState, adj: Adjacency, uid: string): void {
  requireTurn(g, uid);
  if (g.phase !== "play") return;
  // Roll for them first if they never did.
  if (g.step === "roll") doRoll(g, adj, uid);
  // doRoll may land us in "main" (clean) or open a 7 / barbarian sub-step.
  if (g.step === "main") {
    endTurnInternal(g);
  } else {
    // Blocking sub-step: restart the clock so they can resolve it.
    resetTurnDeadline(g);
  }
}

// ---------------------------------------------------------------------------
// Player-to-player trading
// ---------------------------------------------------------------------------

function bagTotal(b: CostBag): number {
  return Object.values(b).reduce((a, n) => a + (n ?? 0), 0);
}

/** The active player puts an offer on the table (gives X, wants Y). */
function doProposeTrade(g: GameState, uid: string, give: CostBag, want: CostBag): void {
  requireTurn(g, uid);
  requireStep(g, "main");
  if (bagTotal(give) === 0 || bagTotal(want) === 0) {
    throw new RuleError("An offer must give and request at least one card.");
  }
  if (!canAfford(g.players[uid], give)) {
    throw new RuleError("You don't hold the cards you're offering.");
  }
  g.tradeOffer = { from: uid, give: { ...give }, want: { ...want }, responses: {} };
  log(g, `${g.players[uid].name} proposes a trade.`);
}

/** Any other player marks whether they'll accept the open offer. */
function doRespondTrade(g: GameState, uid: string, accept: boolean): void {
  const offer = g.tradeOffer;
  if (!offer) throw new RuleError("There is no trade on the table.");
  if (uid === offer.from) throw new RuleError("You can't respond to your own offer.");
  if (accept && !canAfford(g.players[uid], offer.want)) {
    throw new RuleError("You don't hold the cards they want.");
  }
  offer.responses[uid] = accept ? "accept" : "reject";
  log(g, `${g.players[uid].name} ${accept ? "accepts" : "declines"} the trade.`);
}

/** The proposer completes the swap with a player who accepted. */
function doConfirmTrade(g: GameState, uid: string, partner: string): void {
  const offer = g.tradeOffer;
  if (!offer) throw new RuleError("There is no trade on the table.");
  if (uid !== offer.from) throw new RuleError("Only the proposer can finalise the trade.");
  if (offer.responses[partner] !== "accept") {
    throw new RuleError("That player hasn't accepted the offer.");
  }
  const from = g.players[uid];
  const to = g.players[partner];
  if (!canAfford(from, offer.give)) throw new RuleError("You no longer hold the offered cards.");
  if (!canAfford(to, offer.want)) throw new RuleError("They no longer hold the requested cards.");
  pay(from, offer.give);
  pay(to, offer.want);
  for (const [k, n] of Object.entries(offer.give)) bagAdd(to, k as Resource | Commodity, n ?? 0);
  for (const [k, n] of Object.entries(offer.want)) bagAdd(from, k as Resource | Commodity, n ?? 0);
  g.tradeOffer = undefined;
  log(g, `${from.name} traded with ${to.name}.`);
}

/** The proposer withdraws their offer. */
function doCancelTrade(g: GameState, uid: string): void {
  const offer = g.tradeOffer;
  if (!offer) return;
  if (uid !== offer.from) throw new RuleError("Only the proposer can cancel the offer.");
  g.tradeOffer = undefined;
  log(g, `${g.players[uid].name} withdrew the trade offer.`);
}

// ---------------------------------------------------------------------------
// Progress cards
// ---------------------------------------------------------------------------

/** Move up to `count` random cards (resources+commodities) between players. */
function stealRandom(g: GameState, fromUid: string, toUid: string, count: number): number {
  const from = g.players[fromUid];
  const to = g.players[toUid];
  let moved = 0;
  for (let i = 0; i < count; i++) {
    const pool: (Resource | Commodity)[] = [];
    for (const r of RESOURCES) for (let n = 0; n < from.resources[r]; n++) pool.push(r);
    for (const c of COMMODITIES) for (let n = 0; n < from.commodities[c]; n++) pool.push(c);
    if (pool.length === 0) break;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    bagAdd(from, pick, -1);
    bagAdd(to, pick, 1);
    moved++;
  }
  return moved;
}

/** uids of players with a building on the given hex. */
function ownersOnHex(g: GameState, adj: Adjacency, hexId: string): string[] {
  const out = new Set<string>();
  for (const [vid, hexes] of adj.vertexHexes) {
    if (!hexes.includes(hexId)) continue;
    const color = g.vertices[vid]?.building?.owner;
    if (!color) continue;
    const uid = g.order.find((u) => g.players[u].color === color);
    if (uid) out.add(uid);
  }
  return [...out];
}

function vertexTouchesMyRoad(g: GameState, adj: Adjacency, color: string, vid: string): boolean {
  return (adj.vertexEdges.get(vid) ?? []).some((e) => g.edges[e]?.road === color);
}

function playProgress(
  g: GameState,
  adj: Adjacency,
  uid: string,
  card: ProgressCard,
  params: ProgressParams
): void {
  requireTurn(g, uid);
  const p = g.players[uid];
  const idx = p.progressCards.indexOf(card);
  if (idx < 0) throw new RuleError("You don't have that card.");
  if (card === "constitution" || card === "printer") {
    throw new RuleError("Victory-point cards are kept, not played.");
  }
  // Alchemist must be played before rolling; everything else during the main step.
  if (card === "alchemist") requireStep(g, "roll");
  else requireStep(g, "main");

  switch (card) {
    // ---- Trade ----
    case "merchant":
      playMerchant(g, adj, uid, requireStr(params.hex, "Pick a hex."));
      break;
    case "merchantfleet": {
      const t = params.tradeType;
      if (!t) throw new RuleError("Choose a resource or commodity.");
      g.fleet = { uid, type: t };
      log(g, `${p.name} played Merchant Fleet (2:1 ${t} this turn).`);
      break;
    }
    case "resourcemonopoly": {
      const r = params.resource;
      if (!r) throw new RuleError("Choose a resource.");
      let got = 0;
      for (const o of g.order) {
        if (o === uid) continue;
        const take = Math.min(2, g.players[o].resources[r]);
        g.players[o].resources[r] -= take;
        p.resources[r] += take;
        got += take;
      }
      log(g, `${p.name} played Resource Monopoly on ${r} (+${got}).`);
      break;
    }
    case "trademonopoly": {
      const c = params.commodity;
      if (!c) throw new RuleError("Choose a commodity.");
      let got = 0;
      for (const o of g.order) {
        if (o === uid) continue;
        const take = Math.min(1, g.players[o].commodities[c]);
        g.players[o].commodities[c] -= take;
        p.commodities[c] += take;
        got += take;
      }
      log(g, `${p.name} played Trade Monopoly on ${c} (+${got}).`);
      break;
    }
    case "mastermerchant": {
      const target = requireStr(params.targetUid, "Pick a player.");
      if (g.players[target].victoryPoints <= p.victoryPoints) {
        throw new RuleError("Target must have more points than you.");
      }
      const n = stealRandom(g, target, uid, 2);
      log(g, `${p.name} played Master Merchant on ${g.players[target].name} (+${n}).`);
      break;
    }
    case "commercialharbor": {
      for (const o of g.order) {
        if (o === uid) continue;
        // Take one resource from them; give one of your commodities in return.
        const theirRes = RESOURCES.find((r) => g.players[o].resources[r] > 0);
        const myCom = COMMODITIES.find((c) => p.commodities[c] > 0);
        if (theirRes && myCom) {
          g.players[o].resources[theirRes]--;
          p.resources[theirRes]++;
          p.commodities[myCom]--;
          g.players[o].commodities[myCom]++;
        }
      }
      log(g, `${p.name} played Commercial Harbor.`);
      break;
    }

    // ---- Politics ----
    case "bishop": {
      const hexId = requireStr(params.hex, "Pick a hex for the robber.");
      const target = g.hexes[hexId];
      if (!target || target.terrain === "sea") throw new RuleError("Invalid hex.");
      for (const h of Object.values(g.hexes)) h.robber = false;
      target.robber = true;
      g.robberHex = hexId;
      for (const o of ownersOnHex(g, adj, hexId)) {
        if (o !== uid) stealRandom(g, o, uid, 1);
      }
      log(g, `${p.name} played Bishop and robbed the neighbours.`);
      break;
    }
    case "deserter": {
      const target = requireStr(params.targetUid, "Pick a player.");
      const vid = requireStr(params.vertex, "Pick where to place your new knight.");
      const enemyColor = g.players[target].color;
      const weakest = Object.values(g.knights)
        .filter((k) => k.owner === enemyColor)
        .sort((a, b) => a.rank - b.rank)[0];
      if (!weakest) throw new RuleError("That player has no knights.");
      if (g.vertices[vid]?.building || Object.values(g.knights).some((k) => k.vertex === vid)) {
        throw new RuleError("That spot is occupied.");
      }
      if (!vertexTouchesMyRoad(g, adj, p.color, vid)) {
        throw new RuleError("Knight must go on your road network.");
      }
      const rank = weakest.rank;
      delete g.knights[weakest.id];
      g.players[target].pieces.knights++;
      const id = `k${Date.now() % 100000}_${uid.slice(0, 4)}`;
      g.knights[id] = { id, owner: p.color, rank, active: false, vertex: vid };
      log(g, `${p.name} played Deserter and took a knight from ${g.players[target].name}.`);
      break;
    }
    case "diplomat": {
      const eid = requireStr(params.edge, "Pick a road to remove.");
      const e = g.edges[eid];
      if (!e?.road) throw new RuleError("No road there.");
      if (!isOpenRoad(g, adj, eid)) throw new RuleError("That road is not open (it's built up).");
      const ownerUid = g.order.find((u) => g.players[u].color === e.road);
      if (ownerUid) g.players[ownerUid].pieces.roads++;
      const wasMine = e.road === p.color;
      e.road = undefined;
      recomputeLongestRoad(g, adj);
      log(g, `${p.name} played Diplomat${wasMine ? " (removed own road)" : ""}.`);
      break;
    }
    case "intrigue": {
      const kId = requireStr(params.knightId, "Pick an enemy knight.");
      const k = g.knights[kId];
      if (!k || k.owner === p.color) throw new RuleError("Pick an opponent's knight.");
      if (!vertexTouchesMyRoad(g, adj, p.color, k.vertex)) {
        throw new RuleError("That knight is not on one of your roads.");
      }
      const ownerUid = g.order.find((u) => g.players[u].color === k.owner);
      if (ownerUid) g.players[ownerUid].pieces.knights++;
      delete g.knights[kId];
      log(g, `${p.name} played Intrigue and displaced a knight.`);
      break;
    }
    case "saboteur": {
      for (const o of g.order) {
        if (o === uid) continue;
        if (g.players[o].victoryPoints >= p.victoryPoints) {
          const half = Math.floor(handCount(g.players[o]) / 2);
          if (half > 0) discardRandom(g, o, half);
        }
      }
      log(g, `${p.name} played Saboteur.`);
      break;
    }
    case "spy": {
      const target = requireStr(params.targetUid, "Pick a player.");
      const hand = g.players[target].progressCards;
      const ci = params.cardIndex ?? 0;
      if (ci < 0 || ci >= hand.length) throw new RuleError("No such card.");
      const [taken] = hand.splice(ci, 1);
      p.progressCards.push(taken);
      log(g, `${p.name} played Spy and took a card from ${g.players[target].name}.`);
      break;
    }
    case "warlord": {
      let n = 0;
      for (const k of Object.values(g.knights)) {
        if (k.owner === p.color && !k.active) {
          k.active = true;
          n++;
        }
      }
      log(g, `${p.name} played Warlord and activated ${n} knights.`);
      break;
    }
    case "wedding": {
      for (const o of g.order) {
        if (o === uid) continue;
        if (g.players[o].victoryPoints > p.victoryPoints) stealRandom(g, o, uid, 2);
      }
      log(g, `${p.name} played Wedding.`);
      break;
    }

    // ---- Science ----
    case "alchemist": {
      const w = clampDie(params.white);
      const r = clampDie(params.red);
      g.alchemistDice = { white: w, red: r };
      log(g, `${p.name} played Alchemist (next roll set to ${w}+${r}).`);
      break;
    }
    case "crane": {
      const d = params.discipline;
      if (!d) throw new RuleError("Choose a discipline.");
      buyImprovementDiscounted(g, uid, d, 1);
      log(g, `${p.name} played Crane.`);
      break;
    }
    case "engineer": {
      const vid = requireStr(params.vertex, "Pick a city to wall.");
      const v = g.vertices[vid];
      if (!v?.building || v.building.owner !== p.color || v.building.type !== "city") {
        throw new RuleError("Pick one of your cities.");
      }
      if (v.building.wall) throw new RuleError("Already walled.");
      if (p.pieces.walls <= 0) throw new RuleError("No wall pieces left.");
      v.building.wall = true;
      p.pieces.walls--;
      log(g, `${p.name} played Engineer (free city wall).`);
      break;
    }
    case "inventor": {
      const a = g.hexes[requireStr(params.hex, "Pick the first hex.")];
      const b = g.hexes[requireStr(params.hex2, "Pick the second hex.")];
      const swappable = new Set([3, 4, 5, 9, 10, 11]);
      if (!a?.number || !b?.number || !swappable.has(a.number) || !swappable.has(b.number)) {
        throw new RuleError("You can only swap 3,4,5,9,10,11 tokens.");
      }
      [a.number, b.number] = [b.number, a.number];
      log(g, `${p.name} played Inventor and swapped two number tokens.`);
      break;
    }
    case "irrigation": {
      const n = countBuildingsByTerrain(g, adj, p.color, "fields");
      p.resources.wheat += n * 2;
      log(g, `${p.name} played Irrigation (+${n * 2} wheat).`);
      break;
    }
    case "mining": {
      const n = countBuildingsByTerrain(g, adj, p.color, "mountains");
      p.resources.ore += n * 2;
      log(g, `${p.name} played Mining (+${n * 2} ore).`);
      break;
    }
    case "medicine": {
      const vid = requireStr(params.vertex, "Pick a settlement to upgrade.");
      const v = g.vertices[vid];
      if (!v?.building || v.building.owner !== p.color || v.building.type !== "settlement") {
        throw new RuleError("Pick one of your settlements.");
      }
      if (p.pieces.cities <= 0) throw new RuleError("No city pieces left.");
      pay(p, { ore: 2, wheat: 1 });
      v.building.type = "city";
      p.pieces.cities--;
      p.pieces.settlements++;
      log(g, `${p.name} played Medicine (cheap city).`);
      break;
    }
    case "roadbuilding": {
      g.freeRoads = { uid, count: 2 };
      log(g, `${p.name} played Road Building (place 2 free roads).`);
      break;
    }
    case "smith": {
      let n = 0;
      const mine = Object.values(g.knights)
        .filter((k) => k.owner === p.color && k.rank < 3)
        .sort((a, b) => a.rank - b.rank);
      for (const k of mine) {
        if (n >= 2) break;
        if (k.rank === 2 && p.improvements.politics < 3) continue;
        k.rank = (k.rank + 1) as 2 | 3;
        n++;
      }
      log(g, `${p.name} played Smith and promoted ${n} knights.`);
      break;
    }
    default:
      throw new RuleError("That card can't be played.");
  }

  p.progressCards.splice(idx, 1);
}

function playMerchant(g: GameState, adj: Adjacency, uid: string, hexId: string): void {
  const p = g.players[uid];
  const hex = g.hexes[hexId];
  if (!hex || !TERRAIN_RESOURCE[hex.terrain]) throw new RuleError("Merchant needs a resource hex.");
  // Must be adjacent to one of your buildings.
  const adjacentToYou = [...adj.vertexHexes.entries()].some(
    ([vid, hexes]) =>
      hexes.includes(hexId) && g.vertices[vid]?.building?.owner === p.color
  );
  if (!adjacentToYou) throw new RuleError("Merchant must touch your settlement or city.");
  for (const u of g.order) g.players[u].hasMerchant = false;
  p.hasMerchant = true;
  g.merchantHex = hexId;
  g.merchantOwner = uid;
  log(g, `${p.name} placed the Merchant (2:1 ${TERRAIN_RESOURCE[hex.terrain]}, +1 VP).`);
}

function buyImprovementDiscounted(
  g: GameState,
  uid: string,
  discipline: Discipline,
  discount: number
): void {
  const p = g.players[uid];
  const level = p.improvements[discipline];
  if (level >= MAX_IMPROVEMENT) throw new RuleError("Already maxed.");
  const target = level + 1;
  const commodity = DISCIPLINE_COMMODITY[discipline];
  const cost = Math.max(0, improvementCost(target) - discount);
  if (p.commodities[commodity] < cost) throw new RuleError(`Need ${cost} ${commodity}.`);
  p.commodities[commodity] -= cost;
  p.improvements[discipline] = target;
  if (target >= METROPOLIS_LEVEL) tryClaimMetropolis(g, uid, discipline, target);
}

function discardRandom(g: GameState, uid: string, count: number): void {
  const p = g.players[uid];
  for (let i = 0; i < count; i++) {
    const pool: (Resource | Commodity)[] = [];
    for (const r of RESOURCES) for (let n = 0; n < p.resources[r]; n++) pool.push(r);
    for (const c of COMMODITIES) for (let n = 0; n < p.commodities[c]; n++) pool.push(c);
    if (pool.length === 0) break;
    bagAdd(p, pool[Math.floor(Math.random() * pool.length)], -1);
  }
}

function countBuildingsByTerrain(
  g: GameState,
  adj: Adjacency,
  color: string,
  terrain: string
): number {
  let n = 0;
  for (const v of Object.values(g.vertices)) {
    if (v.building?.owner !== color) continue;
    const touches = (adj.vertexHexes.get(v.id) ?? []).some(
      (h) => g.hexes[h]?.terrain === terrain
    );
    if (touches) n++;
  }
  return n;
}

function isOpenRoad(g: GameState, adj: Adjacency, eid: string): boolean {
  const e = g.edges[eid];
  if (!e?.road) return false;
  const ends = adj.edgeEnds.get(eid) ?? [];
  // Open if at least one endpoint has no building and no other same-colour road.
  return ends.some((v) => {
    if (g.vertices[v]?.building) return false;
    const others = (adj.vertexEdges.get(v) ?? []).filter(
      (x) => x !== eid && g.edges[x]?.road === e.road
    );
    return others.length === 0;
  });
}

function requireStr(v: string | undefined, msg: string): string {
  if (!v) throw new RuleError(msg);
  return v;
}

function clampDie(v: number | undefined): number {
  const n = Math.round(v ?? 1);
  return Math.min(6, Math.max(1, n));
}

