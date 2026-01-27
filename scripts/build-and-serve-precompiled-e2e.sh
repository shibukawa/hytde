#!/usr/bin/env bash
set -euo pipefail

extable_source="node_modules/@extable/core/dist/index.css"
precompile_extable="packages/precompile/src/extable.css"
if [ ! -f "$precompile_extable" ]; then
  mkdir -p "$(dirname "$precompile_extable")"
  cp "$extable_source" "$precompile_extable"
fi

npm run build -w packages/vite-plugin
HYTDE_DEMO_DEBUG=true npm run build:demo
npm run preview -w packages/demo -- --host 127.0.0.1 --port 5174 --strictPort
