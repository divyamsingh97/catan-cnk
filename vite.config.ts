import { defineConfig } from "vite";

// For GitHub Pages project sites the app is served from
//   https://<user>.github.io/<repo>/
// so Vite must build with `base` set to "/<repo>/".
// Change this to match your repository name (or set VITE_BASE in CI).
// If you use a custom domain or a <user>.github.io root repo, set it to "/".
const REPO_NAME = "catan-cnk";

export default defineConfig({
  base: process.env.VITE_BASE ?? `/${REPO_NAME}/`,
  build: {
    target: "es2022",
    sourcemap: true
  }
});
