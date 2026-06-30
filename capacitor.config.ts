import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config for the Android (and future iOS) wrapper.
 *
 * The web assets are the normal Vite build output in `dist/`. Build them for
 * the native shell with a *relative* base path so files load from the bundled
 * filesystem rather than the GitHub Pages sub-path:
 *
 *   npm run build:app   (sets VITE_BASE=./)
 *   npx cap sync android
 *   npx cap open android   (then Build > Build APK in Android Studio)
 */
const config: CapacitorConfig = {
  appId: "app.catan.cnk",
  appName: "Catan C&K",
  webDir: "dist",
  android: {
    // Allow Firebase / Google endpoints over https inside the WebView.
    allowMixedContent: false
  },
  plugins: {
    FirebaseAuthentication: {
      // Use the native Google provider; the JS SDK is signed in with the
      // returned credential (see src/firebase/auth.ts).
      skipNativeAuth: false,
      providers: ["google.com"]
    }
  }
};

export default config;
