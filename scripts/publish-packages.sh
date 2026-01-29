#!/usr/bin/env bash
# Publish release packages after a successful version bump.
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🔨 Building all packages..."
npm run build

echo ""
echo "🔎 Validating build outputs..."
required_paths=(
  "packages/parser/dist/index.js"
  "packages/runtime/dist/index.js"
  "packages/standalone/dist/prod/index.js"
  "packages/precompile/dist/prod/index.js"
  "packages/ssr/dist/index.js"
  "packages/vite-plugin/dist/index.js"
)

for rel_path in "${required_paths[@]}"; do
  full_path="${root_dir}/${rel_path}"
  if [[ ! -f "${full_path}" ]]; then
    echo "❌ Missing build output: ${rel_path}"
    exit 1
  fi
done

echo ""
echo "📦 Publishing packages..."

publish_order=(
  "packages/parser"
  "packages/runtime"
  "packages/standalone"
  "packages/precompile"
  "packages/ssr"
  "packages/vite-plugin"
)

for package_dir in "${publish_order[@]}"; do
  package_path="${root_dir}/${package_dir}"
  name="$(node -p "require('${package_path}/package.json').name")"
  echo "📤 Publishing ${name}..."
  (cd "${package_path}" && npm publish --access public)
done

echo ""
echo "✅ All packages published successfully!"
