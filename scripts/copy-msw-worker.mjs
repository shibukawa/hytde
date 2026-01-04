import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
let mswRoot = null;
try {
  mswRoot = resolve(require.resolve("msw/package.json"), "..");
} catch {
  mswRoot = null;
}

const candidates = [];
if (mswRoot) {
  candidates.push(
    resolve(mswRoot, "lib/mockServiceWorker.js"),
    resolve(mswRoot, "src/mockServiceWorker.js"),
    resolve(mswRoot, "dist/mockServiceWorker.js")
  );
}
candidates.push(
  resolve(rootDir, "node_modules/msw/lib/mockServiceWorker.js"),
  resolve(rootDir, "node_modules/msw/src/mockServiceWorker.js"),
  resolve(rootDir, "node_modules/msw/dist/mockServiceWorker.js")
);
const target = resolve(rootDir, "packages/demo/public/mockServiceWorker.js");

let source = null;
for (const candidate of candidates) {
  try {
    const info = await stat(candidate);
    if (info.isFile()) {
      source = candidate;
      break;
    }
  } catch {
    // continue
  }
}

if (!source) {
  throw new Error("mockServiceWorker.js not found in msw package.");
}

await mkdir(resolve(target, ".."), { recursive: true });
await copyFile(source, target);
