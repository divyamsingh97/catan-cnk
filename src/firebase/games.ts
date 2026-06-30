import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  getDoc,
  type Unsubscribe
} from "firebase/firestore";
import { db } from "./config";
import type { Profile } from "./auth";
import { createGameState } from "../game/setup";
import type { GameState, LobbyGame } from "../game/types";

const MAX_PLAYERS = 4; // C&K is 3-4 players per board; multiple games can run.

/** Live-subscribe to the list of joinable / active games. */
export function watchLobby(cb: (games: LobbyGame[]) => void): Unsubscribe {
  const q = query(collection(db(), "games"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const games: LobbyGame[] = [];
    snap.forEach((d) => {
      const g = d.data() as GameState;
      games.push(toLobby(d.id, g));
    });
    cb(games);
  });
}

function toLobby(id: string, g: GameState): LobbyGame {
  return {
    id,
    name: g.name,
    createdBy: g.createdBy,
    createdAt: g.createdAt,
    phase: g.phase,
    playerIds: g.order,
    playerNames: g.order.map((uid) => g.players[uid]?.name ?? "?"),
    maxPlayers: MAX_PLAYERS
  };
}

/** Creates a new game in the "lobby" phase with just the host seated. */
export async function createGame(name: string, host: Profile): Promise<string> {
  const ref = await addDoc(collection(db(), "games"), {
    name: name.trim() || `${host.displayName}'s game`,
    createdBy: host.uid,
    createdAt: Date.now(),
    phase: "lobby",
    order: [host.uid],
    players: {
      [host.uid]: lobbySeat(host)
    },
    serverCreatedAt: serverTimestamp()
  });
  return ref.id;
}

/** A lightweight seat record used while still in the lobby. */
function lobbySeat(p: Profile) {
  return { uid: p.uid, name: p.displayName, connected: true };
}

export async function joinGame(gameId: string, p: Profile): Promise<void> {
  const ref = doc(db(), "games", gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Game no longer exists.");
  const g = snap.data() as GameState;
  if (g.order.includes(p.uid)) return; // already in
  if (g.phase !== "lobby") throw new Error("Game already started.");
  if (g.order.length >= MAX_PLAYERS) throw new Error("Game is full.");
  await updateDoc(ref, {
    order: [...g.order, p.uid],
    [`players.${p.uid}`]: lobbySeat(p)
  });
}

export async function leaveGame(gameId: string, uid: string): Promise<void> {
  const ref = doc(db(), "games", gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const g = snap.data() as GameState;
  const order = g.order.filter((u) => u !== uid);
  if (order.length === 0) {
    await deleteDoc(ref);
    return;
  }
  const players = { ...g.players };
  delete players[uid];
  await updateDoc(ref, { order, players });
}

/** Host starts the game: generates the board and full initial state. */
export async function startGame(gameId: string, turnTimer = 0): Promise<void> {
  const ref = doc(db(), "games", gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Game no longer exists.");
  const g = snap.data() as GameState;
  if (g.order.length < 3) throw new Error("Need at least 3 players for C&K.");
  const state = createGameState({
    id: gameId,
    name: g.name,
    createdBy: g.createdBy,
    players: g.order.map((uid) => ({ uid, name: g.players[uid].name })),
    turnTimer
  });
  await setDoc(ref, state);
}

/** Live-subscribe to a single game's full state. */
export function watchGame(gameId: string, cb: (g: GameState | null) => void): Unsubscribe {
  return onSnapshot(doc(db(), "games", gameId), (snap) => {
    cb(snap.exists() ? (snap.data() as GameState) : null);
  });
}

/** Persists a new full game state (optimistic: bumps version). */
export async function saveGame(state: GameState): Promise<void> {
  await setDoc(doc(db(), "games", state.id), {
    ...state,
    version: state.version + 1
  });
}

export { MAX_PLAYERS };
export type { Unsubscribe };
