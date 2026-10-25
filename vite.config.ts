import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
// The package publishes its browser build as an IIFE. Expose that build as
// ESM for both Vite and workers, avoiding its Node-only rasterisation helpers.
const rmBrowserEntry = fileURLToPath(new URL("./node_modules/remarkable-rm/dist/index.global.js", import.meta.url));
const rmBrowser = () => ({
  name: "remarkable-rm-browser",
  enforce: "pre" as const,
  resolveId(id: string) { if (id === "remarkable-rm") return "\0remarkable-rm-browser"; },
  load(id: string) {
    if (id === "\0remarkable-rm-browser") return `${readFileSync(rmBrowserEntry, "utf8")}\nexport const { parse, renderToSvg } = RemarkableRM;`;
  },
});
export default defineConfig({
  plugins: [react(), rmBrowser()],
  optimizeDeps: { exclude: ["remarkable-rm"] },
  worker: { plugins: () => [rmBrowser()] },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: ["es2021", "chrome105", "safari14"],
    rollupOptions: {
      output: {
        manualChunks: {
          editor: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/lang-markdown",
            "@codemirror/commands",
            "@codemirror/language",
            "@codemirror/search",
          ],
          markdown: ["markdown-it"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
