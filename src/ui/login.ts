import { signInWithGoogle } from "../firebase/auth";
import { isFirebaseConfigured } from "../firebase/config";
import { el } from "./dom";

export function loginScreen(): HTMLElement {
  const error = el("div", { class: "error", style: "display:none" });

  const showError = (msg: string) => {
    error.textContent = msg;
    error.style.display = "block";
  };

  const googleBtn = el(
    "button",
    {
      class: "primary gbtn",
      onclick: async () => {
        error.style.display = "none";
        try {
          await signInWithGoogle();
        } catch (e) {
          showError(e instanceof Error ? e.message : String(e));
        }
      }
    },
    ["Sign in with Google"]
  );

  if (!isFirebaseConfigured) {
    googleBtn.setAttribute("disabled", "");
    showError(
      "Firebase is not configured yet. Copy .env.example to .env.local and add " +
        "your Firebase web config, then restart the dev server."
    );
  }

  return el("div", { class: "center" }, [
    el("div", { class: "card col" }, [
      el("div", { class: "login-title" }, ["Catan: Cities & Knights"]),
      el("div", { class: "muted" }, [
        "Private game for friends. Sign in with your invited Google account."
      ]),
      googleBtn,
      error
    ])
  ]);
}
