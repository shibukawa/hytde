import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { ssrMiddleware } from "./middleware.js";

const port = Number(process.env.PORT ?? "5175");
const templateRoot = process.env.HYTDE_SSR_ROOT ?? process.cwd();
const publicRoot = process.env.HYTDE_SSR_PUBLIC ?? templateRoot;

const app = new Hono();
app.use("*", ssrMiddleware({
  templateRoot,
  apiBaseUrl: process.env.HYTDE_SSR_API_BASE,
  debug: process.env.HYTDE_SSR_DEBUG === "true"
}));
app.use("*", serveStatic({ root: publicRoot }));

serve({ fetch: app.fetch, port });

console.info(`[hytde] ssr server listening on http://127.0.0.1:${port}`);
