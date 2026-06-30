# Catan: Cities & Knights — private online game

A private, mobile-friendly online **Catan: Cities & Knights** for a small group of
friends (3–4 per game), inspired by colonist.io.

- **Frontend:** Vite + TypeScript, deployed to **GitHub Pages**
- **Backend:** **Firebase** (Google sign-in + Firestore realtime database)
- **Installable** as a PWA on Android and iPhone (Add to Home Screen)
- **Android APK** can be produced for sideloading via a Google Drive link

> ⚠️ This is an in-progress build. The project scaffold, Google auth, lobby,
> realtime board, board generation and full C&K data model are done. The turn
> engine and the remaining C&K rules (knights, barbarians, commodities, walls,
> progress cards, metropolis) are being implemented incrementally.

---

## 1. Prerequisites

- Node.js 20+ (you have v24) and npm
- A Google account (for Firebase) and a GitHub account

```bash
npm install
```

## 2. Create the Firebase project (free)

1. Go to <https://console.firebase.google.com> → **Add project**.
2. In the project, open **Build → Authentication → Get started**, enable the
   **Google** sign-in provider.
3. Open **Build → Firestore Database → Create database** (Production mode).
4. Open **Project settings (gear) → General → Your apps → Web app (`</>`)**,
   register an app, and copy the `firebaseConfig` values.
5. Under **Authentication → Settings → Authorized domains**, add:
   - `localhost`
   - `<your-github-username>.github.io`

## 3. Local environment

```bash
copy .env.example .env.local   # Windows (use cp on macOS/Linux)
```

Fill `.env.local` with the values from step 2:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
# Your friends' Google emails (comma-separated) — only these can play:
VITE_ALLOWLIST=friend1@gmail.com,friend2@gmail.com
```

Run it locally:

```bash
npm run dev
```

## 4. Lock it down (Firestore Security Rules)

Open **Firestore → Rules**, paste the contents of [`firestore.rules`](./firestore.rules),
add your friends' emails to the `allowedEmails()` list, and **Publish**.
This makes the game readable/writable only by your invited group.

## 5. Deploy to GitHub Pages

1. Create a GitHub repo named **`catan-cnk`** (if you use a different name,
   update `REPO_NAME` in [`vite.config.ts`](./vite.config.ts)). Push this code.
2. In the repo: **Settings → Pages → Build and deployment → Source = GitHub Actions**.
3. In the repo: **Settings → Secrets and variables → Actions → New repository secret**,
   add each Firebase value as a secret (these match the env names):
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
     `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
   - (Optional) also add `VITE_ALLOWLIST` as a secret and reference it in the
     workflow if you want the client-side gate in production.
4. Push to `main` → the **Deploy to GitHub Pages** workflow builds and publishes
   to `https://<username>.github.io/catan-cnk/`.

> The Firebase web keys are **not secret** (every web app ships them to the
> browser). Real security comes from the Firestore Rules + the allowlist.

## 6. Install on phones (PWA)

Share the Pages URL with your friends.

- **Android (Chrome):** menu → *Add to Home screen / Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*.

It launches fullscreen with its own icon — app-like on both platforms, no store.

## 7. Android APK via Google Drive

The project is already wired for **Capacitor** (the `android/` native shell is
committed; build artifacts are git-ignored). To produce an installable APK:

### One-time prerequisites (on the build machine)

- **JDK 17** and **Android Studio** (or the Android command-line SDK) installed,
  with `ANDROID_HOME` / `local.properties` `sdk.dir` pointing at the SDK.

### Native Google sign-in setup (one-time, required for login to work)

Inside the Capacitor WebView the web `signInWithPopup` flow can't run, so the app
uses the native `@capacitor-firebase/authentication` plugin. Wire it to *your*
Firebase project:

1. In the **Firebase console → Project settings → Your apps**, add an **Android**
   app with package name `app.catan.cnk` (matches `appId` in
   [capacitor.config.ts](capacitor.config.ts)).
2. Generate a **SHA-1** (and SHA-256) fingerprint and add it to that Android app:
   ```bash
   cd android && ./gradlew signingReport
   # copy the SHA1 from the "debug" variant
   ```
3. Download the generated **`google-services.json`** into `android/app/`
   (git-ignored — it stays local).
4. Apply the Google Services Gradle plugin:
   - `android/build.gradle` → add to `dependencies`:
     `classpath 'com.google.gms:google-services:4.4.2'`
   - `android/app/build.gradle` → add at the top:
     `apply plugin: 'com.google.gms.google-services'`
5. In **Firebase console → Authentication → Sign-in method**, ensure **Google**
   is enabled, and confirm the Web client (auto-created) exists — the plugin
   reads its client ID from `google-services.json`.

### Build the APK

```bash
npm run cap:sync     # build:app (relative base) + cap sync android
npm run cap:open     # opens Android Studio → Build ▸ Build Bundle(s)/APK(s) ▸ Build APK(s)
# …or fully from the command line:
npm run apk          # build:app + cap sync + gradlew assembleDebug
```

The debug APK lands at
`android/app/build/outputs/apk/debug/app-debug.apk`.

### Distribute

Upload `app-debug.apk` to **Google Drive** and share the link. On their phones,
friends open the link, tap download, then enable *"Install unknown apps"* for
their browser/Drive when prompted, and install. (A debug-signed APK is fine for
a small group of friends; for the Play Store you'd need a signed release build.)

> **iPhone note:** Apple does **not** allow installing apps from a Drive link.
> Use the **PWA install** (section 6) on iPhone — Share → *Add to Home Screen*.
> A true native iOS app would require an Apple Developer account ($99/yr) +
> TestFlight, so no Capacitor iOS target is included.

---

## Project structure

```
src/
  firebase/      Firebase init, Google auth, lobby + game Firestore ops
  game/          Pure game logic: types, hex math, board gen, setup, rng
  ui/            DOM/SVG rendering: login, lobby, game board, sidebar
  main.ts        App shell + routing
  pwa.ts         Service worker registration
public/          manifest, icons, service worker
firestore.rules  Security rules (deploy in Firebase console)
capacitor.config.ts            Capacitor (native shell) config
android/                       Capacitor Android project (build outputs git-ignored)
.github/workflows/deploy.yml   CI build + GitHub Pages deploy
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run icons` | Regenerate PNG icons from `public/icon.svg` |
| `npm run build:app` | Production build with a **relative** base path (for the Capacitor shell) |
| `npm run cap:sync` | `build:app` + copy assets into the `android/` project |
| `npm run cap:open` | Open the Android project in Android Studio |
| `npm run apk` | `build:app` + sync + `gradlew assembleDebug` (needs Android SDK + JDK) |

## Legal note

This is a fan project for **private use among friends**. *Catan*, *Cities &
Knights*, and related marks are trademarks of Catan GmbH / Catan Studio. Do not
distribute publicly or commercially.
