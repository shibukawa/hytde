import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import hyTde from "@hytde/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

const demoDebug = process.env.HYTDE_DEMO_DEBUG === "true";
const demoManual = process.env.HYTDE_DEMO_MANUAL === "true";
const demoPathMode = process.env.HYTDE_DEMO_PATH_MODE === "path" ? "path" : "hash";
const demoOutDir = process.env.HYTDE_DEMO_OUT_DIR ?? "dist";
const demoApiPort = process.env.HYTDE_DEMO_API_PORT ?? "8787";
const demoApiTarget = `http://localhost:${demoApiPort}`;

export default defineConfig(() => ({
  appType: "mpa",
  plugins: [
    tailwindcss(),
    ...hyTde({
      debug: demoDebug,
      manual: demoManual,
      pathMode: demoPathMode,
      inputPaths: ["."],
      tailwindSupport: "src/styles.css"
    })
  ],
  server: {
    proxy: {
      "/api": {
        target: demoApiTarget,
        changeOrigin: true
      }
    }
  },
  preview: {
    proxy: {
      "/api": {
        target: demoApiTarget,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: demoOutDir
  },
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
      }
    ]
  }
}));
