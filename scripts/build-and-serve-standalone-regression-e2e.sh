#!/usr/bin/env bash
set -euo pipefail

npm run build -w packages/standalone

asset_dir="tests/regression/site-root/assets/standalone/debug"
mkdir -p "$asset_dir"

cp packages/standalone/dist/debug/index.js "$asset_dir/index.js"

if [ -f packages/standalone/dist/mockServiceWorker.js ]; then
  cp packages/standalone/dist/mockServiceWorker.js tests/regression/site-root/mockServiceWorker.js
  cp packages/standalone/dist/mockServiceWorker.js tests/regression/site-root/project/mockServiceWorker.js
fi

node tests/regression/static-standalone-server.mjs
