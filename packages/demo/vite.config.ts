import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import hyTde from "@hytde/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

const demoDebug = process.env.HYTDE_DEMO_DEBUG === "true";
const demoManual = process.env.HYTDE_DEMO_MANUAL === "true";
const demoPathMode = process.env.HYTDE_DEMO_PATH_MODE === "path" ? "path" : "hash";
const demoOutDir = process.env.HYTDE_DEMO_OUT_DIR ?? "dist";
const demoSpa = process.env.HYTDE_DEMO_SPA === "true";
const demoApiPort = process.env.HYTDE_DEMO_API_PORT ?? "8787";
const demoApiTarget = `http://localhost:${demoApiPort}`;
const demoRoot = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);

export default defineConfig(() => ({
  appType: "mpa",
  plugins: [
    tailwindcss(),
    {
      name: "demo-precompile-extable-css",
      enforce: "pre",
      resolveId(id, importer) {
        const suffix = id.includes("?") ? id.slice(id.indexOf("?")) : "";
        const isExtableQuery =
          id.endsWith("extable.css?url") || id.endsWith("extable.css?transform-only");
        if (!isExtableQuery) {
          return null;
        }
        if (importer?.includes("/precompile/src/entry-runtime.")) {
          return `${resolve(demoRoot, "../precompile/src/extable.css")}${suffix}`;
        }
        if (importer?.includes("/precompile/src/extable.css?url")) {
          return `${resolve(demoRoot, "../precompile/src/extable.css")}${suffix}`;
        }
        if (id.includes("/precompile/src/extable.css")) {
          return `${resolve(demoRoot, "../precompile/src/extable.css")}${suffix}`;
        }
        return null;
      },
      async load(id) {
        if (!id.endsWith("extable.css?transform-only")) {
          return null;
        }
        const target = resolve(demoRoot, "../precompile/src/extable.css");
        try {
          return await readFile(target, "utf8");
        } catch {
          const fallback = resolveExtableCssFallback();
          if (!fallback) {
            throw new Error(`[demo-precompile-extable-css] extable.css missing at ${target}`);
          }
          return readFile(fallback, "utf8");
        }
      }
    },
    ...hyTde({
      debug: demoDebug,
      manual: demoManual,
      pathMode: demoPathMode,
      spa: demoSpa,
      inputPaths: ["."],
      tailwindSupport: "src/styles.css"
    })
  ],
  server: {
    configureServer(server) {
      if (demoPathMode !== "path") {
        return;
      }
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || (req.method !== "GET" && req.method !== "HEAD")) {
          return next();
        }
        const rawPath = decodeURIComponent(req.url.split("?")[0] ?? "");
        if (
          rawPath.startsWith("/@")
          || rawPath.startsWith("/__")
          || rawPath.startsWith("/api")
          || extname(rawPath)
        ) {
          return next();
        }
        const pathname = rawPath.endsWith("/") ? `${rawPath}index` : rawPath;
        const candidate = resolve(demoRoot, `.${pathname}.html`);
        if (!candidate.startsWith(demoRoot) || !existsSync(candidate)) {
          return next();
        }
        try {
          const html = await readFile(candidate, "utf8");
          const transformed = await server.transformIndexHtml(rawPath, html);
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html");
          res.end(req.method === "HEAD" ? "" : transformed);
        } catch (error) {
          next(error);
        }
      });
    },
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
      },
      {
        find: /^@hytde\/standalone\/msw-debug$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../standalone/src/msw-debug.ts"
        )
      },
      {
        find: /^@hytde\/precompile$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../precompile/entries/prod/index.ts"
        )
      },
      {
        find: /^@hytde\/precompile\/debug$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../precompile/entries/debug/index.ts"
        )
      },
      {
        find: /^@hytde\/precompile\/no-auto$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../precompile/entries/prod-manual/index.ts"
        )
      },
      {
        find: /^@hytde\/precompile\/no-auto-debug$/,
        replacement: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "../precompile/entries/debug-manual/index.ts"
        )
      }
    ]
  }
}));

function resolveExtableCssFallback(): string | null {
  try {
    const extableRoot = resolve(require.resolve("@extable/core/package.json"), "..");
    return resolve(extableRoot, "dist/index.css");
  } catch {
    return null;
  }
}
