# @hytde/ssr

Server-side rendering middleware for HyTDE. It consumes the slotified `.ssr.json` output from the Vite plugin, prefetches eligible requests, renders HTML, and embeds the SSR state for client hydration.

## Install

```
npm install @hytde/ssr
```

## Usage

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { ssrMiddleware } from "@hytde/ssr";

const app = new Hono();
app.use(
  "*",
  ssrMiddleware({
    templateRoot: "./dist",
    apiBaseUrl: "http://127.0.0.1:8787",
    timeoutMs: 5000,
    debug: false
  })
);

serve({ fetch: app.fetch, port: 5175 });
```

## Configuration

- `templateRoot`: Directory containing `.ssr.json` files (defaults to `process.cwd()`).
- `apiBaseUrl`: Optional base URL for server-side fetches.
- `timeoutMs`: Per-request timeout (default 5000ms).
- `getAuthHeaders`: Hook to attach auth headers based on the incoming request.
- `debug`: When true, SSR failures render stack traces instead of a generic error page.

## Notes

- SSR prefetches `hy-get`/`hy-post` requests that run on startup. `hy-stream` and `hy-action` remain client-only.
- The SSR response embeds `<script id="hy-ssr-state" type="application/json">` for hydration.
- Mocking is not supported in SSR mode.

## Local server

`npm run ssr-server` starts the simple server entry shipped with this package.
