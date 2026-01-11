# HyTDE Demo

## Smoke Checks
- `npm run build -w packages/demo`
- Open `packages/demo/dist/basic-sample.html` in a browser and verify it boots without errors.
- Confirm the output HTML includes `#hy-precompile-parser` and the runtime import references `@hytde/precompile`.

## Fake API Server
- `npm run demo:api` (from repo root) starts a local API server on port 8787 for prod mode demos.
