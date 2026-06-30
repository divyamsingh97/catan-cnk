import "./style.css";
import { signOut, watchAuth, type Profile } from "./firebase/auth";
import { el, mount } from "./ui/dom";
import { loginScreen } from "./ui/login";
import { lobbyScreen } from "./ui/lobby";
import { gameScreen } from "./ui/game";
import { registerServiceWorker } from "./pwa";

const app = document.getElementById("app")!;

interface Route {
  name: "login" | "lobby" | "game";
  gameId?: string;
}

let me: Profile | null = null;
let route: Route = { name: "login" };
let dispose: (() => void) | null = null;

function topbar(): HTMLElement {
  const right = me
    ? el("div", { class: "row" }, [
        me.photoURL ? el("img", { class: "avatar", src: me.photoURL, alt: "" }) : el("span"),
        el("span", { class: "muted" }, [me.displayName]),
        el("button", { onclick: () => signOut() }, ["Sign out"])
      ])
    : el("span");

  return el("div", { class: "topbar" }, [
    el(
      "div",
      {
        class: "brand",
        style: "cursor:pointer",
        onclick: () => {
          if (me) navigate({ name: "lobby" });
        }
      },
      [el("span", {}, ["CATAN "]), el("span", { class: "knights" }, ["Cities & Knights"])]
    ),
    right
  ]);
}

function navigate(next: Route): void {
  route = next;
  render();
}

function render(): void {
  if (dispose) {
    dispose();
    dispose = null;
  }

  const bar = topbar();

  if (!me) {
    mount(app, bar, loginScreen());
    return;
  }

  if (route.name === "game" && route.gameId) {
    const screen = gameScreen(route.gameId, me, () => navigate({ name: "lobby" }));
    dispose = screen.dispose;
    mount(app, bar, screen.node);
    return;
  }

  // default: lobby
  const screen = lobbyScreen(me, (id) => navigate({ name: "game", gameId: id }));
  dispose = screen.dispose;
  mount(app, bar, screen.node);
}

watchAuth((profile) => {
  me = profile;
  if (!me) route = { name: "login" };
  else if (route.name === "login") route = { name: "lobby" };
  render();
});

registerServiceWorker();
render();
