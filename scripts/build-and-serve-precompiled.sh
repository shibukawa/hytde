#!/usr/bin/env bash
set -euo pipefail

HYTDE_DEMO_DEBUG=true npm run build:demo
npx serve packages/demo/dist -l 5174
