import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import hyTde from "@hytde/vite-plugin";

export default defineConfig({
  appType: "mpa",
  plugins: [hyTde()],
  resolve: {
    alias: [
      {
        find: /^@hytde\/parser$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../parser/src/index.ts"
        )
      },
      {
        find: /^@hytde\/runtime$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../runtime/src/index.ts"
        )
      },
      {
        find: /^@hytde\/standalone$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../standalone/src/index.ts"
        )
      },
      {
        find: /^@hytde\/standalone\/debug-api$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../standalone/src/debug-api.ts"
        )
      },
      {
        find: /^@hytde\/extable-bundle$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../extable-bundle/src/index.ts"
        )
      }
    ]
  }
});
