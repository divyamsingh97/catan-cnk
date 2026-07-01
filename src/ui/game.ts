import type { Profile } from "../firebase/auth";
import { saveGame, startGame, watchGame, type Unsubscribe } from "../firebase/games";
import { applyAction, RuleError, type Action, type ProgressParams } from "../game/engine";
import { improvementCost, type CostBag } from "../game/constants";
import {
  COMMODITIES,
  DISCIPLINE_COMMODITY,
  RESOURCES,
  type Commodity,
  type Discipline,
  type GameState,
  type PlayerState,
  type ProgressCard,
  type Resource
} from "../game/types";
import { renderBoard, COLOR_FILL } from "./board";
import { buildAdjacency } from "../game/graph";
import { el, mount } from "./dom";
import { iconCount, iconEl } from "./icons";

type Intent = null | "road" | "settlement" | "city" | "wall" | "knight";

/** What each playable progress card needs from the player. */
type Need = "resource" | "commodity" | "type" | "discipline" | "player" | "knight";
interface CardMeta {
  selects?: Need[];
  dice?: boolean;
  board?: Array<"hex" | "hex2" | "vertex" | "edge">;
  rollStep?: boolean;
  label: string;
}
const CARD_META: Partial<Record<ProgressCard, CardMeta>> = {
  merchant: { board: ["hex"], label: "place merchant on a hex" },
  merchantfleet: { selects: ["type"], label: "2:1 a resource/commodity this turn" },
  resourcemonopoly: { selects: ["resource"], label: "take 2 of a resource from each" },
  trademonopoly: { selects: ["commodity"], label: "take 1 of a commodity from each" },
  mastermerchant: { selects: ["player"], label: "steal 2 from a leader" },
  commercialharbor: { label: "swap commodities for resources" },
  bishop: { board: ["hex"], label: "move robber, rob neighbours" },
  deserter: { selects: ["player"], board: ["vertex"], label: "take an enemy knight" },
  diplomat: { board: ["edge"], label: "remove an open road" },
  intrigue: { selects: ["knight"], label: "displace a knight on your road" },
  saboteur: { label: "leaders discard half" },
  spy: { selects: ["player"], label: "take a card from a player" },
  warlord: { label: "activate all your knights" },
  wedding: { label: "leaders give you 2 cards" },
  alchemist: { dice: true, rollStep: true, label: "set the dice before rolling" },
  crane: { selects: ["discipline"], label: "improve a city 1 cheaper" },
  engineer: { board: ["vertex"], label: "free city wall" },
  inventor: { board: ["hex", "hex2"], label: "swap two number tokens" },
  irrigation: { label: "+2 wheat per grain building" },
  mining: { label: "+2 ore per mountain building" },
  medicine: { board: ["vertex"], label: "cheap city upgrade" },
  roadbuilding: { label: "build 2 free roads" },
  smith: { label: "promote 2 knights free" }
};

export function gameScreen(
  gameId: string,
  me: Profile,
  back: () => void
): { node: HTMLElement; dispose: () => void } {
  const boardWrap = el("div", { class: "board-wrap" });
  const sidebar = el("div", { class: "sidebar" });
  const timerEl = el("div", { class: "turn-timer", style: "display:none" });
  const node = el("div", { class: "game-screen" }, [boardWrap, sidebar, timerEl]);

  let current: GameState | null = null;
  let intent: Intent = null;
  // Previous city-improvement levels (for the flip animation when one unlocks).
  let prevLevels: Record<Discipline, number> | null = null;
  // A knight selected for a board action (move/displace or chase the robber).
  let knightAction: { knightId: string; mode: "move" | "chase" } | null = null;
  let errorMsg = "";
  const discardSel: Partial<Record<Resource | Commodity, number>> = {};
  let tradeGive: Resource | Commodity = "brick";
  let tradeGet: Resource | Commodity = "ore";
  // Player-to-player offer being composed by the active player.
  let offerGive: CostBag = {};
  let offerWant: CostBag = {};
  // The deadline value we've already auto-resolved, so we fire `timeout` once.
  let timedOutAt: number | null = null;
  // Progress-card play flow.
  let activeCard: ProgressCard | null = null;
  let cardParams: ProgressParams = {};
  let cardBoardQueue: Array<"hex" | "hex2" | "vertex" | "edge"> = [];

  const resetCardFlow = () => {
    activeCard = null;
    cardParams = {};
    cardBoardQueue = [];
  };

  const tryPlayCard = () => {
    if (!activeCard) return;
    if (cardBoardQueue.length === 0) {
      const card = activeCard;
      const params = { ...cardParams };
      resetCardFlow();
      dispatch({ type: "playProgress", card, params });
    } else {
      render(current); // show "tap board" hint for the next target
    }
  };

  const fillBoardTarget = (value: string) => {
    const need = cardBoardQueue.shift();
    if (!need) return;
    if (need === "hex") cardParams.hex = value;
    else if (need === "hex2") cardParams.hex2 = value;
    else if (need === "vertex") cardParams.vertex = value;
    else if (need === "edge") cardParams.edge = value;
    tryPlayCard();
  };

  const startCard = (card: ProgressCard) => {
    if (!current) return;
    const meta = CARD_META[card];
    activeCard = card;
    cardParams = {};
    cardBoardQueue = [...(meta?.board ?? [])];
    if (meta?.selects?.includes("resource")) cardParams.resource = "brick";
    if (meta?.selects?.includes("commodity")) cardParams.commodity = "cloth";
    if (meta?.selects?.includes("type")) cardParams.tradeType = "brick";
    if (meta?.selects?.includes("discipline")) cardParams.discipline = "trade";
    if (meta?.selects?.includes("player")) {
      cardParams.targetUid = current.order.find((u) => u !== me.uid);
    }
    if (meta?.selects?.includes("knight")) {
      const myColor = current.players[me.uid].color;
      cardParams.knightId = Object.values(current.knights).find((k) => k.owner !== myColor)?.id;
    }
    if (meta?.dice) {
      cardParams.white = 1;
      cardParams.red = 1;
    }
    if (!meta?.selects?.length && !meta?.dice) tryPlayCard();
    else render(current);
  };

  const cardForm = (g: GameState): HTMLElement => {
    const meta = CARD_META[activeCard!]!;
    const controls: HTMLElement[] = [];
    for (const need of meta.selects ?? []) controls.push(selectFor(need, g, cardParams));
    if (meta.dice) controls.push(diceInputs(cardParams));
    if (cardBoardQueue.length) {
      controls.push(
        el("div", { style: "color:var(--accent)" }, [`Tap the board: ${cardBoardQueue[0]}`])
      );
    }
    if (meta.selects?.length || meta.dice) {
      controls.push(el("button", { class: "primary", onclick: () => tryPlayCard() }, ["Confirm"]));
    }
    controls.push(
      el("button", { onclick: () => { resetCardFlow(); render(current); } }, ["Cancel"])
    );
    return el("div", { class: "col", style: "gap:6px;border-top:1px solid var(--line);padding-top:6px" }, controls);
  };

  const renderProgress = (g: GameState): HTMLElement => {
    const p = g.players[me.uid];
    const counts = new Map<ProgressCard, number>();
    for (const c of p.progressCards) counts.set(c, (counts.get(c) ?? 0) + 1);
    const rows: HTMLElement[] = [];
    for (const [card, n] of counts) {
      const meta = CARD_META[card];
      const playableNow = meta?.rollStep ? g.step === "roll" : g.step === "main";
      rows.push(
        el("div", { class: "row spread" }, [
          el("span", { style: "font-size:.85rem" }, [
            `${card}${n > 1 ? ` ×${n}` : ""}`,
            meta ? el("span", { class: "muted" }, [` — ${meta.label}`]) : ""
          ]),
          el(
            "button",
            { disabled: !playableNow || activeCard !== null, onclick: () => startCard(card) },
            ["Play"]
          )
        ])
      );
    }
    const parts: Array<Node | string> = [el("strong", {}, ["Progress cards"]), ...rows];
    if (rows.length === 0) parts.push(el("div", { class: "muted", style: "font-size:.85rem" }, ["None yet."]));
    if (activeCard) parts.push(cardForm(g));
    return el("div", { class: "card col", style: "gap:6px" }, parts);
  };

  const dispatch = async (action: Action) => {
    if (!current) return;
    try {
      errorMsg = "";
      const next = applyAction(current, action, me.uid);
      intent = null;
      knightAction = null;
      await saveGame(next);
    } catch (e) {
      errorMsg = e instanceof RuleError || e instanceof Error ? e.message : String(e);
      render(current);
    }
  };

  const myTurn = (g: GameState) => g.order[g.current] === me.uid;

  /** Repaints the floating turn clock and auto-ends a turn that runs out. */
  const updateTimer = () => {
    const g = current;
    if (!g || g.phase !== "play" || g.turnTimer <= 0 || !g.turnDeadline) {
      timerEl.style.display = "none";
      return;
    }
    timerEl.style.display = "";
    const remainingMs = g.turnDeadline - Date.now();
    const secs = Math.max(0, Math.ceil(remainingMs / 1000));
    const mm = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, "0");
    const who = g.players[g.order[g.current]]?.name ?? "?";
    timerEl.textContent = `⏱ ${who} — ${mm}:${ss}`;
    timerEl.classList.toggle("low", secs <= 10);
    // Only the active player's client advances the game, and only from a step
    // that can be ended cleanly (roll / main). Blocking sub-steps just run over.
    if (
      remainingMs <= 0 &&
      myTurn(g) &&
      (g.step === "roll" || g.step === "main") &&
      timedOutAt !== g.turnDeadline
    ) {
      timedOutAt = g.turnDeadline;
      dispatch({ type: "timeout" });
    }
  };

  // ---- player-to-player trading panels ----

  /** The active player's offer builder (give / get steppers per card type). */
  const tradeBuilder = (g: GameState): HTMLElement => {
    const mine = g.players[me.uid];
    const rows = ([...RESOURCES, ...COMMODITIES] as Array<Resource | Commodity>).map((k) => {
      const have = k in mine.resources ? mine.resources[k as Resource] : mine.commodities[k as Commodity];
      return el("div", { class: "trade-row" }, [
        el("span", { class: "muted", style: "font-size:.8rem" }, [`${k} (${have})`]),
        stepper(offerGive[k] ?? 0, 0, have, (n) => { offerGive[k] = n; render(current); }),
        stepper(offerWant[k] ?? 0, 0, 19, (n) => { offerWant[k] = n; render(current); })
      ]);
    });
    return el("div", { class: "card col", style: "gap:6px" }, [
      el("strong", {}, ["Trade with players"]),
      el("div", { class: "trade-row muted", style: "font-size:.72rem" }, [
        el("span", {}, ["card (you have)"]),
        el("span", {}, ["give"]),
        el("span", {}, ["get"])
      ]),
      ...rows,
      el("div", { class: "row", style: "gap:6px" }, [
        el(
          "button",
          {
            class: "primary",
            onclick: () =>
              dispatch({ type: "proposeTrade", give: cleanBag(offerGive), want: cleanBag(offerWant) })
          },
          ["Propose"]
        ),
        el("button", { onclick: () => { offerGive = {}; offerWant = {}; render(current); } }, ["Clear"])
      ])
    ]);
  };

  /** Proposer's view of an open offer: responses + finalise / cancel. */
  const offerManager = (g: GameState, offer: NonNullable<GameState["tradeOffer"]>): HTMLElement => {
    const others = g.order.filter((u) => u !== me.uid);
    return el("div", { class: "card col", style: "gap:6px" }, [
      el("strong", {}, ["Your trade offer"]),
      el("div", { class: "muted", style: "font-size:.8rem" }, [
        `Give ${describeBag(offer.give)} · Get ${describeBag(offer.want)}`
      ]),
      ...others.map((u) => {
        const st = offer.responses[u];
        return el("div", { class: "row spread", style: "align-items:center" }, [
          el("span", { style: "font-size:.85rem" }, [
            `${g.players[u].name}: ${st === "accept" ? "✓ accepted" : st === "reject" ? "✗ declined" : "…"}`
          ]),
          st === "accept"
            ? el(
                "button",
                { class: "primary", onclick: () => dispatch({ type: "confirmTrade", partner: u }) },
                ["Trade"]
              )
            : el("span")
        ]);
      }),
      el("button", { class: "danger", onclick: () => dispatch({ type: "cancelTrade" }) }, [
        "Cancel offer"
      ])
    ]);
  };

  /** A respondent's view of someone else's open offer. */
  const offerResponder = (g: GameState, offer: NonNullable<GameState["tradeOffer"]>): HTMLElement => {
    const mineResp = offer.responses[me.uid];
    return el("div", { class: "card col", style: "gap:6px" }, [
      el("strong", {}, [`${g.players[offer.from].name} offers a trade`]),
      el("div", { class: "muted", style: "font-size:.8rem" }, [
        `They give ${describeBag(offer.give)} · They want ${describeBag(offer.want)}`
      ]),
      mineResp
        ? el("div", { style: "font-size:.85rem;color:var(--accent)" }, [
            `You ${mineResp === "accept" ? "accepted" : "declined"}.`
          ])
        : el("span"),
      el("div", { class: "row", style: "gap:6px" }, [
        el("button", { class: "primary", onclick: () => dispatch({ type: "respondTrade", accept: true }) }, [
          "Accept"
        ]),
        el("button", { onclick: () => dispatch({ type: "respondTrade", accept: false }) }, ["Decline"])
      ])
    ]);
  };

  /** Knights panel: activate / promote / move / chase-robber for the active player. */
  const knightsPanel = (g: GameState): HTMLElement => {
    const color = g.players[me.uid].color;
    const mine = Object.values(g.knights).filter((k) => k.owner === color);
    const adj = buildAdjacency(g);
    const rows = mine.map((k) => {
      const canAct = k.active && !k.usedThisTurn;
      const nextToRobber = (adj.vertexHexes.get(k.vertex) ?? []).includes(g.robberHex);
      const sel = knightAction?.knightId === k.id ? knightAction.mode : null;
      const toggle = (mode: "move" | "chase") => {
        knightAction = sel === mode ? null : { knightId: k.id, mode };
        render(current);
      };
      return el("div", { class: "col", style: "gap:4px" }, [
        el("div", { class: "row spread" }, [
          el("span", { style: "font-size:.85rem" }, [
            `R${k.rank} · ${k.active ? "active" : "inactive"}${k.usedThisTurn ? " · used" : ""}`
          ]),
          el("div", { class: "row", style: "gap:4px" }, [
            el(
              "button",
              { disabled: k.active ? "" : undefined, onclick: () => dispatch({ type: "activateKnight", knightId: k.id }) },
              ["Activate"]
            ),
            el(
              "button",
              { disabled: k.rank >= 3 ? "" : undefined, onclick: () => dispatch({ type: "promoteKnight", knightId: k.id }) },
              ["Promote"]
            )
          ])
        ]),
        canAct
          ? el("div", { class: "row", style: "gap:4px" }, [
              el("button", { class: sel === "move" ? "primary" : "", onclick: () => toggle("move") }, [
                "Move"
              ]),
              nextToRobber
                ? el("button", { class: sel === "chase" ? "primary" : "", onclick: () => toggle("chase") }, [
                    "Chase robber"
                  ])
                : el("span")
            ])
          : el("span")
      ]);
    });
    const hint = knightAction
      ? el("div", { style: "color:var(--accent);font-size:.8rem" }, [
          knightAction.mode === "move"
            ? "Tap a spot to move, or a weaker enemy knight to chase it off."
            : "Tap a hex to chase the robber onto it."
        ])
      : el("span");
    return el("div", { class: "card col", style: "gap:6px" }, [
      el("strong", {}, [`Knights (${mine.length})`]),
      ...(mine.length === 0
        ? [el("div", { class: "muted", style: "font-size:.85rem" }, ["Build one from the Build panel."])]
        : rows),
      hint
    ]);
  };

  const boardCallbacks = (g: GameState) => ({
    onVertexClick: (vid: string) => {
      if (activeCard && cardBoardQueue[0] === "vertex") {
        fillBoardTarget(vid);
        return;
      }
      if (knightAction?.mode === "move" && myTurn(g) && g.step === "main") {
        const myColor = g.players[me.uid].color;
        const enemyHere = Object.values(g.knights).some(
          (kn) => kn.vertex === vid && kn.owner !== myColor
        );
        dispatch(
          enemyHere
            ? { type: "displaceKnight", knightId: knightAction.knightId, to: vid }
            : { type: "moveKnight", knightId: knightAction.knightId, to: vid }
        );
        return;
      }
      if (g.step === "setupSettlement" && myTurn(g)) {
        dispatch({ type: "setupSettlement", vertex: vid });
      } else if (g.step === "main" && myTurn(g)) {
        if (intent === "settlement") dispatch({ type: "buildSettlement", vertex: vid });
        else if (intent === "city") dispatch({ type: "buildCity", vertex: vid });
        else if (intent === "wall") dispatch({ type: "buildWall", vertex: vid });
        else if (intent === "knight") dispatch({ type: "buildKnight", vertex: vid });
      }
    },
    onEdgeClick: (eid: string) => {
      if (activeCard && cardBoardQueue[0] === "edge") {
        fillBoardTarget(eid);
        return;
      }
      if (g.step === "setupRoad" && myTurn(g)) dispatch({ type: "setupRoad", edge: eid });
      else if (g.step === "main" && myTurn(g) && intent === "road")
        dispatch({ type: "buildRoad", edge: eid });
    },
    onHexClick: (hid: string) => {
      if (activeCard && (cardBoardQueue[0] === "hex" || cardBoardQueue[0] === "hex2")) {
        fillBoardTarget(hid);
        return;
      }
      if (knightAction?.mode === "chase" && myTurn(g) && g.step === "main") {
        dispatch({ type: "chaseRobber", knightId: knightAction.knightId, hex: hid });
        return;
      }
      if (g.step === "moveRobber" && myTurn(g)) dispatch({ type: "moveRobber", hex: hid });
    }
  });

  const render = (g: GameState | null) => {
    if (!g) {
      mount(boardWrap, el("div", { class: "muted", style: "margin:auto" }, ["Game not found."]));
      mount(sidebar, el("button", { onclick: back }, ["Back to lobby"]));
      return;
    }
    if (g.phase === "lobby") return renderWaiting(g);
    mount(boardWrap, renderBoard(g, boardCallbacks(g)));
    renderSidebar(g);
  };

  const renderWaiting = (g: GameState) => {
    const isHost = g.createdBy === me.uid;
    const names = g.order.map((u) => g.players[u].name);
    const enough = g.order.length >= 2;

    const body: HTMLElement[] = [
      el("h2", {}, [g.name]),
      el("div", { class: "muted" }, [`${g.order.length} / 4 players seated`]),
      el("div", {}, [names.join(", ")])
    ];

    if (isHost) {
      const timerSelect = el("select", { title: "Time limit per turn" }, [
        el("option", { value: "30" }, ["30s / turn"]),
        el("option", { value: "90", selected: "" }, ["1.5 min / turn"]),
        el("option", { value: "150" }, ["2.5 min / turn"])
      ]) as HTMLSelectElement;

      const startBtn = el(
        "button",
        {
          class: "primary",
          disabled: !enough,
          onclick: async () => {
            startBtn.disabled = true;
            try {
              await startGame(gameId, Number(timerSelect.value));
              // watchGame will re-render to the board once phase flips to "play".
            } catch (e) {
              errorMsg = e instanceof Error ? e.message : String(e);
              startBtn.disabled = false;
              render(current);
            }
          }
        },
        ["Start game"]
      );

      body.push(
        el("div", { class: "row", style: "justify-content:center;gap:8px;margin-top:8px" }, [
          timerSelect,
          startBtn
        ])
      );
      body.push(
        el("div", { class: "muted", style: "font-size:.85rem;max-width:340px" }, [
          enough
            ? "You're the host — pick a turn timer and start when everyone's in."
            : "Need at least 2 players. Share the game link so a friend can sign in and join from the lobby."
        ])
      );
      if (errorMsg) body.push(el("div", { class: "error" }, [errorMsg]));
    } else {
      body.push(el("div", { class: "muted" }, ["Waiting for the host to start…"]));
    }

    mount(
      boardWrap,
      el("div", { class: "col", style: "margin:auto;text-align:center;gap:8px" }, body)
    );
    mount(sidebar, el("button", { onclick: back }, ["Back to lobby"]));
  };

  const renderSidebar = (g: GameState) => {
    const parts: HTMLElement[] = [headerCard(g, back), statusCard(g, intent)];
    if (errorMsg) parts.push(el("div", { class: "error" }, [errorMsg]));

    if (g.step === "discard" && g.pendingDiscards?.[me.uid]) {
      parts.push(discardCard(g, me.uid, discardSel, () => render(current), dispatch));
    }

    if (g.step === "stealChoice" && myTurn(g)) {
      parts.push(
        el("div", { class: "card col" }, [
          el("strong", {}, ["Steal from:"]),
          el(
            "div",
            { class: "row", style: "flex-wrap:wrap" },
            (g.robberVictims ?? []).map((v) =>
              el("button", { onclick: () => dispatch({ type: "steal", target: v }) }, [
                g.players[v].name
              ])
            )
          )
        ])
      );
    }

    // Open trade offers are visible to everyone, regardless of whose turn it is.
    if (g.tradeOffer) {
      parts.push(
        g.tradeOffer.from === me.uid
          ? offerManager(g, g.tradeOffer)
          : offerResponder(g, g.tradeOffer)
      );
    }

    if (myTurn(g) && g.phase === "play") {
      if (g.step === "roll") {
        parts.push(
          el("div", { class: "card" }, [
            el(
              "button",
              { class: "primary", style: "width:100%", onclick: () => dispatch({ type: "roll" }) },
              ["🎲 Roll dice"]
            )
          ])
        );
        if (g.players[me.uid].progressCards.some((c) => CARD_META[c]?.rollStep)) {
          parts.push(renderProgress(g));
        }
      }
      if (g.step === "main") {
        parts.push(
          buildCard(intent, (i) => {
            intent = intent === i ? null : i;
            render(current);
          })
        );
        parts.push(renderProgress(g));
        parts.push(tracksCard(g.players[me.uid], prevLevels, dispatch));
        parts.push(knightsPanel(g));
        parts.push(
          tradeCard(
            tradeGive,
            tradeGet,
            (gv) => { tradeGive = gv; render(current); },
            (gt) => { tradeGet = gt; render(current); },
            () => dispatch({ type: "bankTrade", give: tradeGive, get: tradeGet })
          )
        );
        if (!g.tradeOffer) parts.push(tradeBuilder(g));
        parts.push(
          el("div", { class: "card" }, [
            el(
              "button",
              { class: "primary", style: "width:100%", onclick: () => dispatch({ type: "endTurn" }) },
              ["End turn ➡"]
            )
          ])
        );
      }
      if (g.step === "moveRobber") {
        parts.push(el("div", { class: "card muted" }, ["Tap a hex to move the robber."]));
      }
    }

    parts.push(handCard(g.players[me.uid]));
    parts.push(playersCard(g, me.uid));
    parts.push(tickerCard(g));

    if (g.phase === "finished" && g.winner) {
      parts.unshift(
        el("div", { class: "card", style: "border-color:var(--accent)" }, [
          el("h2", { style: "margin:0" }, [`🏆 ${g.players[g.winner].name} wins!`])
        ])
      );
    }

    mount(sidebar, ...parts);
    // Snapshot improvement levels so the next render can flip newly-unlocked tiles.
    prevLevels = { ...g.players[me.uid].improvements };
  };

  const unsub: Unsubscribe = watchGame(gameId, (g) => {
    current = g;
    render(g);
    updateTimer();
  });
  const timerInterval = window.setInterval(updateTimer, 1000);
  return {
    node,
    dispose: () => {
      window.clearInterval(timerInterval);
      unsub();
    }
  };
}

// ---- sidebar building blocks ----

function headerCard(g: GameState, back: () => void): HTMLElement {
  return el("div", { class: "card row spread" }, [
    el("strong", {}, [g.name]),
    el("button", { onclick: back }, ["Back"])
  ]);
}

function statusCard(g: GameState, intent: Intent): HTMLElement {
  const turnUid = g.order[g.current];
  const roll = g.lastRoll
    ? `${g.lastRoll.white}+${g.lastRoll.red}=${g.lastRoll.white + g.lastRoll.red}, ${g.lastRoll.event}`
    : "—";
  return el("div", { class: "card col", style: "gap:4px" }, [
    el("div", {}, ["Turn: ", el("strong", {}, [g.players[turnUid]?.name ?? "?"])]),
    el("div", { class: "muted", style: "font-size:.85rem" }, [`Phase ${g.phase} • step ${g.step}`]),
    el("div", { class: "muted", style: "font-size:.85rem" }, [
      `Barbarians ${g.barbarians.position}/7 • Last roll ${roll}`
    ]),
    g.phase === "setup1" && g.step === "setupSettlement"
      ? el("div", { class: "muted", style: "font-size:.85rem" }, ["Place your first settlement."])
      : g.phase === "setup2" && g.step === "setupSettlement"
        ? el("div", { style: "color:var(--accent);font-size:.85rem" }, [
            "Place your starting city (grants resources; commodities come later)."
          ])
        : el("span"),
    intent
      ? el("div", { style: "color:var(--accent)" }, [`Placing: ${intent} (tap board)`])
      : el("span")
  ]);
}

function buildCard(intent: Intent, toggle: (i: Intent) => void): HTMLElement {
  const btn = (label: string, i: Exclude<Intent, null>) =>
    el("button", { class: intent === i ? "primary" : "", onclick: () => toggle(i) }, [label]);
  return el("div", { class: "card col", style: "gap:6px" }, [
    el("strong", {}, ["Build"]),
    el("div", { class: "row", style: "flex-wrap:wrap;gap:6px" }, [
      btn("Road", "road"),
      btn("Settlement", "settlement"),
      btn("City", "city"),
      btn("Wall", "wall"),
      btn("Knight", "knight")
    ]),
    el("div", { class: "muted", style: "font-size:.78rem" }, [
      "Road b+w · Settlement b+w+wh+s · City 2wh+3o · Wall 2b · Knight o+s"
    ])
  ]);
}

/** Cities & Knights city-improvement tracks: building names + level-3 ability. */
const TRACK: Record<
  Discipline,
  { label: string; color: string; levels: { name: string; ability?: string }[] }
> = {
  trade: {
    label: "Trade",
    color: "#c45ba0",
    levels: [
      { name: "Market" },
      { name: "Trading House" },
      { name: "Merchant Guild", ability: "Trade any one kind 2:1 with the bank" },
      { name: "Bank", ability: "Metropolis eligible (+2 VP)" },
      { name: "Great Guild Hall", ability: "Trade metropolis secured" }
    ]
  },
  politics: {
    label: "Politics",
    color: "#d8a93a",
    levels: [
      { name: "Town Hall" },
      { name: "Church" },
      { name: "Fortress", ability: "Promote knights to Mighty (rank 3)" },
      { name: "Cathedral", ability: "Metropolis eligible (+2 VP)" },
      { name: "Great Cathedral", ability: "Politics metropolis secured" }
    ]
  },
  science: {
    label: "Science",
    color: "#6aa0d8",
    levels: [
      { name: "Abbey" },
      { name: "Library" },
      { name: "Aqueduct", ability: "Produced nothing on a roll? Take 1 resource" },
      { name: "Theater", ability: "Metropolis eligible (+2 VP)" },
      { name: "University", ability: "Science metropolis secured" }
    ]
  }
};

function tracksCard(
  p: PlayerState,
  prev: Record<Discipline, number> | null,
  dispatch: (a: Action) => void
): HTMLElement {
  const disciplines: Discipline[] = ["trade", "politics", "science"];
  return el("div", { class: "card col", style: "gap:12px" }, [
    el("strong", {}, ["City improvements"]),
    ...disciplines.map((d) => {
      const meta = TRACK[d];
      const lvl = p.improvements[d];
      const com = DISCIPLINE_COMMODITY[d];
      const cost = improvementCost(lvl + 1);
      const owned = !!p.metropolis[d];

      const header = el("div", { class: "row spread" }, [
        el("div", { class: "row", style: "gap:6px;align-items:center" }, [
          iconEl(com, 16),
          el("span", { class: "track-name" }, [meta.label]),
          owned ? el("span", { class: "metro-badge", title: "Metropolis (+2 VP)" }, ["🏛"]) : el("span")
        ]),
        el(
          "button",
          {
            class: "improve-btn",
            disabled: lvl >= 5 || p.commodities[com] < cost,
            onclick: () => dispatch({ type: "buyImprovement", discipline: d })
          },
          [lvl >= 5 ? "Max" : `+1 · ${cost}`]
        )
      ]);

      const tiles = el(
        "div",
        { class: "track" },
        meta.levels.map((lv, i) => {
          const level = i + 1;
          const unlocked = lvl >= level;
          const justUnlocked = unlocked && prev != null && (prev[d] ?? 0) < level;
          const cls = [
            "track-tile",
            unlocked ? "unlocked" : "locked",
            level >= 4 ? "metro" : "",
            justUnlocked ? "flip-in" : ""
          ]
            .filter(Boolean)
            .join(" ");
          return el("div", { class: cls, title: lv.ability ?? lv.name }, [
            el("div", { class: "track-tile-inner" }, [
              el("div", { class: "track-tile-face track-tile-back" }, [String(level)]),
              el(
                "div",
                { class: "track-tile-face track-tile-front", style: `--tc:${meta.color}` },
                [
                  el("div", { class: "tile-lvl" }, [`L${level}`]),
                  el("div", { class: "tile-name" }, [lv.name])
                ]
              )
            ])
          ]);
        })
      );

      const ability = lvl >= 1 ? meta.levels[Math.min(lvl, 5) - 1]?.ability : undefined;
      const abilityEl = ability
        ? el("div", { class: "track-ability muted" }, [`✦ ${ability}`])
        : el("span");

      return el("div", { class: "track-block col", style: "gap:5px" }, [header, tiles, abilityEl]);
    })
  ]);
}

function tradeCard(
  give: Resource | Commodity,
  get: Resource | Commodity,
  onGive: (r: Resource | Commodity) => void,
  onGet: (r: Resource | Commodity) => void,
  doTrade: () => void
): HTMLElement {
  const all: (Resource | Commodity)[] = [...RESOURCES, ...COMMODITIES];
  const sel = (value: string, on: (v: Resource | Commodity) => void) => {
    const s = el("select", {
      onchange: (e: Event) => on((e.target as HTMLSelectElement).value as Resource | Commodity)
    }) as HTMLSelectElement;
    for (const r of all) {
      const o = el("option", { value: r }, [r]);
      if (r === value) o.setAttribute("selected", "");
      s.appendChild(o);
    }
    return s;
  };
  return el("div", { class: "card col", style: "gap:6px" }, [
    el("strong", {}, ["Bank trade"]),
    el("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, [
      sel(give, onGive),
      el("span", {}, ["→"]),
      sel(get, onGet),
      el("button", { onclick: doTrade }, ["Trade"])
    ]),
    el("div", { class: "muted", style: "font-size:.78rem" }, ["Rate 4:1, better with harbors"])
  ]);
}

function discardCard(
  g: GameState,
  uid: string,
  sel: Partial<Record<Resource | Commodity, number>>,
  rerender: () => void,
  dispatch: (a: Action) => void
): HTMLElement {
  const owed = g.pendingDiscards?.[uid] ?? 0;
  const p = g.players[uid];
  const all: (Resource | Commodity)[] = [...RESOURCES, ...COMMODITIES];
  const have = (r: Resource | Commodity) =>
    r in p.resources ? p.resources[r as Resource] : p.commodities[r as Commodity];
  const total = () => Object.values(sel).reduce((a, b) => a + (b ?? 0), 0);
  const container = el("div", { class: "card col", style: "gap:6px;border-color:var(--danger)" }, []);
  const draw = () => {
    const rows = all
      .filter((r) => have(r) > 0)
      .map((r) =>
        el("div", { class: "row spread" }, [
          el("span", {}, [`${r} (${have(r)})`]),
          el("div", { class: "row", style: "gap:4px" }, [
            el(
              "button",
              { onclick: () => { sel[r] = Math.max(0, (sel[r] ?? 0) - 1); draw(); } },
              ["−"]
            ),
            el("span", {}, [String(sel[r] ?? 0)]),
            el(
              "button",
              {
                onclick: () => {
                  if ((sel[r] ?? 0) < have(r) && total() < owed) sel[r] = (sel[r] ?? 0) + 1;
                  draw();
                }
              },
              ["+"]
            )
          ])
        ])
      );
    mount(
      container,
      el("strong", {}, [`Discard ${owed} (${total()}/${owed})`]),
      ...rows,
      el(
        "button",
        {
          class: "danger",
          disabled: total() !== owed,
          onclick: () => {
            dispatch({ type: "discard", give: { ...sel } });
            for (const k of Object.keys(sel)) delete sel[k as Resource | Commodity];
            rerender();
          }
        },
        ["Confirm discard"]
      )
    );
  };
  draw();
  return container;
}

function handCard(p: PlayerState): HTMLElement {
  return el("div", { class: "card col", style: "gap:6px" }, [
    el("strong", {}, ["Your hand"]),
    el("div", { class: "row hand-row" }, [
      iconCount("brick", p.resources.brick),
      iconCount("wood", p.resources.wood),
      iconCount("wheat", p.resources.wheat),
      iconCount("sheep", p.resources.sheep),
      iconCount("ore", p.resources.ore)
    ]),
    el("div", { class: "row hand-row" }, [
      iconCount("cloth", p.commodities.cloth),
      iconCount("coin", p.commodities.coin),
      iconCount("paper", p.commodities.paper)
    ]),
    p.progressCards.length
      ? el("div", { class: "muted", style: "font-size:.85rem" }, [
          `Progress cards: ${p.progressCards.join(", ")}`
        ])
      : el("span")
  ]);
}

function playersCard(g: GameState, meUid: string): HTMLElement {
  const turnUid = g.order[g.current];
  return el(
    "div",
    { class: "card col", style: "gap:6px" },
    g.order.map((uid) => {
      const p = g.players[uid];
      const cards =
        Object.values(p.resources).reduce((a, b) => a + b, 0) +
        Object.values(p.commodities).reduce((a, b) => a + b, 0);
      return el(
        "div",
        {
          class: "row spread",
          style: uid === turnUid ? "background:#ffffff10;border-radius:6px;padding:2px 4px" : ""
        },
        [
          el("div", { class: "row", style: "gap:6px" }, [
            el("span", {
              style: `width:12px;height:12px;border-radius:50%;background:${COLOR_FILL[p.color]};display:inline-block`
            }),
            el("span", {}, [p.name + (uid === meUid ? " (you)" : "")])
          ]),
          el("span", { class: "muted", style: "font-size:.85rem" }, [
            `${p.victoryPoints}VP · ${cards}c${p.hasLongestRoad ? " · 🛣" : ""}`
          ])
        ]
      );
    })
  );
}

function tickerCard(g: GameState): HTMLElement {
  return el("div", { class: "card col", style: "gap:2px;max-height:180px;overflow:auto" }, [
    el("strong", {}, ["Log"]),
    ...g.ticker
      .slice(-25)
      .reverse()
      .map((t) =>
        el("div", { class: "muted log-line", style: "font-size:.8rem" }, renderLogLine(t))
      )
  ]);
}

const LOG_ICONS: (Resource | Commodity)[] = [
  "brick",
  "wood",
  "wheat",
  "sheep",
  "ore",
  "cloth",
  "coin",
  "paper"
];

/** Split a log string on resource/commodity words and inline their icons. */
function renderLogLine(text: string): (HTMLElement | string)[] {
  const re = new RegExp(`\\b(${LOG_ICONS.join("|")})\\b`, "gi");
  const out: (HTMLElement | string)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(iconEl(m[1].toLowerCase() as Resource | Commodity, 14));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---- trade helpers ----

function stepper(
  value: number,
  min: number,
  max: number,
  onChange: (n: number) => void
): HTMLElement {
  return el("div", { class: "row", style: "gap:4px;align-items:center" }, [
    el(
      "button",
      { class: "step", disabled: value <= min ? "" : undefined, onclick: () => onChange(value - 1) },
      ["−"]
    ),
    el("span", { style: "min-width:16px;text-align:center" }, [String(value)]),
    el(
      "button",
      { class: "step", disabled: value >= max ? "" : undefined, onclick: () => onChange(value + 1) },
      ["+"]
    )
  ]);
}

function cleanBag(b: CostBag): CostBag {
  const out: CostBag = {};
  for (const [k, n] of Object.entries(b)) {
    if ((n ?? 0) > 0) out[k as Resource | Commodity] = n;
  }
  return out;
}

function describeBag(b: CostBag): string {
  const parts = Object.entries(b)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n} ${k}`);
  return parts.length ? parts.join(", ") : "nothing";
}

// ---- progress-card param inputs ----

function dropdown(
  options: Array<{ value: string; label: string }>,
  value: string | undefined,
  onChange: (v: string) => void
): HTMLSelectElement {
  const s = el("select", {
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value)
  }) as HTMLSelectElement;
  for (const o of options) {
    const opt = el("option", { value: o.value }, [o.label]);
    if (o.value === value) opt.setAttribute("selected", "");
    s.appendChild(opt);
  }
  return s;
}

function selectFor(need: Need, g: GameState, params: ProgressParams): HTMLElement {
  let label = need;
  let select: HTMLSelectElement;
  switch (need) {
    case "resource":
      select = dropdown(
        RESOURCES.map((r) => ({ value: r, label: r })),
        params.resource,
        (v) => (params.resource = v as Resource)
      );
      break;
    case "commodity":
      select = dropdown(
        COMMODITIES.map((c) => ({ value: c, label: c })),
        params.commodity,
        (v) => (params.commodity = v as Commodity)
      );
      break;
    case "type":
      select = dropdown(
        [...RESOURCES, ...COMMODITIES].map((r) => ({ value: r, label: r })),
        params.tradeType,
        (v) => (params.tradeType = v as Resource | Commodity)
      );
      break;
    case "discipline":
      select = dropdown(
        (["trade", "politics", "science"] as Discipline[]).map((d) => ({ value: d, label: d })),
        params.discipline,
        (v) => (params.discipline = v as Discipline)
      );
      break;
    case "player":
      label = "player";
      select = dropdown(
        g.order
          .filter((u) => u !== g.order[g.current])
          .map((u) => ({ value: u, label: g.players[u].name })),
        params.targetUid,
        (v) => (params.targetUid = v)
      );
      break;
    case "knight": {
      const myColor = g.players[g.order[g.current]].color;
      const enemy = Object.values(g.knights).filter((k) => k.owner !== myColor);
      label = "knight";
      select = dropdown(
        enemy.map((k) => ({ value: k.id, label: `R${k.rank} ${k.owner}` })),
        params.knightId,
        (v) => (params.knightId = v)
      );
      break;
    }
  }
  return el("label", { class: "row spread", style: "gap:6px" }, [
    el("span", { class: "muted", style: "font-size:.8rem" }, [label]),
    select
  ]);
}

function diceInputs(params: ProgressParams): HTMLElement {
  const mk = (val: number, set: (n: number) => void) => {
    const i = el("input", {
      type: "number",
      min: "1",
      max: "6",
      value: String(val),
      style: "width:56px",
      onchange: (e: Event) => set(Number((e.target as HTMLInputElement).value))
    }) as HTMLInputElement;
    return i;
  };
  return el("div", { class: "row", style: "gap:6px" }, [
    el("span", { class: "muted", style: "font-size:.8rem" }, ["dice"]),
    mk(params.white ?? 1, (n) => (params.white = n)),
    el("span", {}, ["+"]),
    mk(params.red ?? 1, (n) => (params.red = n))
  ]);
}
