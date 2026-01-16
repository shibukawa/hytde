#!/usr/bin/env bash
set -euo pipefail

HYTDE_DEMO_DEBUG=true npm run build:demo
npm run preview -w packages/demo -- --host 127.0.0.1 --port 5174 --strictPort
