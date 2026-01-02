import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const standaloneDir = resolve(rootDir, "packages/standalone");

const variants = [
  "production-auto",
  "debug-auto",
  "production-manual",
  "debug-manual"
];

const isWindows = process.platform === "win32";
const viteCommand = isWindows ? "npx.cmd" : "npx";

async function runVariant(variant) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(viteCommand, ["vite", "build"], {
      cwd: standaloneDir,
      stdio: "inherit",
      env: {
        ...process.env,
        HYTDE_STANDALONE_VARIANT: variant
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`vite build failed for ${variant} (exit ${code})`));
      }
    });

    child.on("error", (error) => {
      rejectRun(error);
    });
  });
}

for (const variant of variants) {
  await runVariant(variant);
}

const workerSource = resolve(rootDir, "node_modules/msw/lib/mockServiceWorker.js");
const workerFallback = resolve(rootDir, "node_modules/msw/src/mockServiceWorker.js");
const workerTargets = [
  resolve(rootDir, "packages/standalone/dist/mockServiceWorker.js"),
  resolve(rootDir, "packages/standalone/dist/production-auto/mockServiceWorker.js"),
  resolve(rootDir, "packages/standalone/dist/debug-auto/mockServiceWorker.js"),
  resolve(rootDir, "packages/standalone/dist/production-manual/mockServiceWorker.js"),
  resolve(rootDir, "packages/standalone/dist/debug-manual/mockServiceWorker.js")
];

await mkdir(resolve(rootDir, "packages/standalone/dist"), { recursive: true });
let resolvedSource = workerSource;
try {
  await copyFile(workerSource, workerTargets[0]);
} catch {
  await copyFile(workerFallback, workerTargets[0]);
  resolvedSource = workerFallback;
}
await Promise.all(
  workerTargets.map(async (target) => {
    await mkdir(resolve(target, ".."), { recursive: true });
    await copyFile(resolvedSource, target);
  })
);
