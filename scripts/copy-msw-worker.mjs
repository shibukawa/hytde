import { copyFile, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const candidates = [
  resolve(rootDir, "node_modules/msw/lib/mockServiceWorker.js"),
  resolve(rootDir, "node_modules/msw/src/mockServiceWorker.js")
];
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
