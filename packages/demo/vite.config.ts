import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import hyTde from "@hytde/vite-plugin";

export default defineConfig({
  plugins: [hyTde()],
  resolve: {
    alias: {
      "@hytde/standalone": resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "../standalone/src/index.ts"
      )
    }
  }
});
