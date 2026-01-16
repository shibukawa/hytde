import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ssrMiddleware } from "@hytde/ssr";

const __dirname = resolve(fileURLToPath(new URL(".", import.meta.url)));
const rootDir = resolve(__dirname, "../..");
const outDir = resolve(rootDir, process.env.HYTDE_DEMO_OUT_DIR ?? "dist");
const port = Number(process.env.HYTDE_DEMO_SSR_PORT ?? "5175");
const apiBaseUrl = process.env.HYTDE_DEMO_API_BASE ?? "http://127.0.0.1:8787";

const app = new Hono();
app.all("/api/*", async (c) => {
  const url = new URL(c.req.url);
  const target = new URL(url.pathname + url.search, apiBaseUrl);
  const proxyRequest = new Request(target.toString(), c.req.raw);
  const response = await fetch(proxyRequest);
  const headers = new Headers(response.headers);
  const body = await response.arrayBuffer();
  return new Response(body, { status: response.status, headers });
});
app.use(
  "*",
  ssrMiddleware({
    templateRoot: outDir,
    apiBaseUrl,
    debug: process.env.HYTDE_DEMO_DEBUG === "true"
  })
);
app.use("*", serveStatic({ root: outDir }));

serve({ fetch: app.fetch, port });

console.info(`[hytde] demo ssr server listening on http://127.0.0.1:${port}`);
