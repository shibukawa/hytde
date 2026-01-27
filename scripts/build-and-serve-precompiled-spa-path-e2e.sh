#!/usr/bin/env bash
set -euo pipefail

extable_source="node_modules/@extable/core/dist/index.css"
precompile_extable="packages/precompile/src/extable.css"
if [ ! -f "$precompile_extable" ]; then
  mkdir -p "$(dirname "$precompile_extable")"
  cp "$extable_source" "$precompile_extable"
fi

npm run build -w packages/vite-plugin
rm -rf packages/demo/dist-spa-path
HYTDE_DEMO_SPA=true HYTDE_DEMO_PATH_MODE=path HYTDE_DEMO_DEBUG=true HYTDE_DEMO_OUT_DIR=dist-spa-path npm run build:demo
node tests/regression/precompiled-spa-path-server.mjs
