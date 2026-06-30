import type { Profile } from "../firebase/auth";
import {
  createGame,
  joinGame,
  leaveGame,
  startGame,
  watchLobby,
  MAX_PLAYERS,
  type Unsubscribe
} from "../firebase/games";
import type { LobbyGame } from "../game/types";
import { el, mount } from "./dom";

export function lobbyScreen(
  me: Profile,
  openGame: (id: string) => void
): { node: HTMLElement; dispose: () => void } {
  const list = el("ul", { class: "game-list" });
  const error = el("div", { class: "error", style: "display:none" });
  const nameInput = el("input", {
    placeholder: "New game name",
    style: "flex:1"
  }) as HTMLInputElement;

  const showError = (e: unknown) => {
    error.textContent = e instanceof Error ? e.message : String(e);
    error.style.display = "block";
  };

  const createBtn = el(
    "button",
    {
      class: "primary",
      onclick: async () => {
        try {
          const id = await createGame(nameInput.value, me);
          nameInput.value = "";
          openGame(id);
        } catch (e) {
          showError(e);
        }
      }
    },
    ["Create"]
  );

  const node = el("div", { class: "lobby" }, [
    el("div", { class: "card col" }, [
      el("div", { class: "row spread" }, [
        el("h2", { style: "margin:0" }, ["Games"]),
        el("span", { class: "muted" }, [`Up to ${MAX_PLAYERS} players each`])
      ]),
      el("div", { class: "row" }, [nameInput, createBtn]),
      error,
      list
    ])
  ]);

  const renderList = (games: LobbyGame[]) => {
    if (games.length === 0) {
      mount(list, el("div", { class: "muted" }, ["No games yet — create one!"]));
      return;
    }
    const items = games.map((g) => gameRow(g, me, openGame, showError));
    mount(list, ...items);
  };

  const unsub: Unsubscribe = watchLobby(renderList);

  return { node, dispose: () => unsub() };
}

function gameRow(
  g: LobbyGame,
  me: Profile,
  openGame: (id: string) => void,
  onError: (e: unknown) => void
): HTMLElement {
  const inGame = g.playerIds.includes(me.uid);
  const isHost = g.createdBy === me.uid;
  const full = g.playerIds.length >= g.maxPlayers;
  const started = g.phase !== "lobby";

  const badge = started
    ? el("span", { class: "badge playing" }, ["In progress"])
    : el("span", { class: "badge open" }, [`${g.playerIds.length}/${g.maxPlayers}`]);

  const actions: HTMLElement[] = [];
  if (started && inGame) {
    actions.push(el("button", { class: "primary", onclick: () => openGame(g.id) }, ["Open"]));
  } else if (!started) {
    if (inGame) {
      if (isHost) {
        const timerSelect = el("select", { title: "Time limit per turn" }, [
          el("option", { value: "30" }, ["30s / turn"]),
          el("option", { value: "90", selected: "" }, ["1.5 min / turn"]),
          el("option", { value: "150" }, ["2.5 min / turn"])
        ]) as HTMLSelectElement;
        actions.push(timerSelect);
        actions.push(
          el(
            "button",
            {
              class: "primary",
              disabled: g.playerIds.length < 3,
              onclick: async () => {
                try {
                  await startGame(g.id, Number(timerSelect.value));
                  openGame(g.id);
                } catch (e) {
                  onError(e);
                }
              }
            },
            ["Start"]
          )
        );
      }
      actions.push(el("button", { onclick: () => openGame(g.id) }, ["Lobby"]));
      actions.push(
        el(
          "button",
          { class: "danger", onclick: () => leaveGame(g.id, me.uid).catch(onError) },
          ["Leave"]
        )
      );
    } else {
      actions.push(
        el(
          "button",
          {
            class: "primary",
            disabled: full,
            onclick: () => joinGame(g.id, me).then(() => openGame(g.id)).catch(onError)
          },
          [full ? "Full" : "Join"]
        )
      );
    }
  }

  return el("li", { class: "game-item" }, [
    el("div", { class: "col", style: "gap:2px" }, [
      el("div", {}, [el("strong", {}, [g.name]), " ", badge]),
      el("div", { class: "muted", style: "font-size:.85rem" }, [
        g.playerNames.join(", ")
      ])
    ]),
    el("div", { class: "row" }, actions)
  ]);
}
