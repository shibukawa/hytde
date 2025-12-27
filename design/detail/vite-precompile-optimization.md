# Vite Precompile Optimization

## Status
Draft

## Goal
Define the framework-facing behavior for a Vite optimization pipeline that emits precompiled HTML outputs and a lightweight runtime bootstrap from embedded JSON.

## Outputs
- Static optimized HTML: template + parser-equivalent JSON + `@hytde/precompile` runtime.
- SSR optimized HTML: static optimized output plus prefetched JSON for non-stream/SSE requests; streaming reconnects after load.
- SPA output: deferred.

## Precompile Runtime
- Reuses `packages/runtime` as the base implementation; adapt as needed for browser execution and Vite optimization output.
- Consumes embedded JSON instead of reparsing templates.
- Hydrates event handlers for SSR output.
- Suppresses non-form template re-rendering for SSR output; form updates remain allowed.
- Shares the same runtime for static and SSR outputs.

## Optimized HTML Rules (Draft)
- Remove prototyping-only artifacts such as `hy-dummy` and `hidden="hy-ignore"` preview helpers.
- Preserve valid HTML and `hy-*` semantics for runtime behavior.

## Data Embedding (Draft)
- Embed parser-equivalent JSON and prefetched data in `<script type="application/json">`.
- JSON is consumed by `@hytde/precompile` on load.

## Related Docs
- `design/detail/vite-modes.md`
- `design/detail/plugins.md`
- `design/detail/streaming-fetch-sse.md`
