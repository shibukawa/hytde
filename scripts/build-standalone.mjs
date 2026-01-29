import { spawn } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const standaloneDir = resolve(rootDir, "packages/standalone");
const extableCssSource = resolve(
  rootDir,
  "node_modules",
  "@extable",
  "core",
  "dist",
  "index.css"
);

const variants = ["prod", "debug", "prod-manual", "debug-manual"];

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
  const extableCssDest = resolve(standaloneDir, "dist", variant, "extable.css");
  await copyFile(extableCssSource, extableCssDest);
}

const workerCandidates = resolveMswWorkerCandidates(rootDir);
const workerTargets = [
  resolve(rootDir, "packages/standalone/dist/mockServiceWorker.js"),
  resolve(rootDir, "packages/standalone/dist/prod/mockServiceWorker.js"),
  resolve(rootDir, "packages/standalone/dist/debug/mockServiceWorker.js"),
  resolve(rootDir, "packages/standalone/dist/prod-manual/mockServiceWorker.js"),
  resolve(rootDir, "packages/standalone/dist/debug-manual/mockServiceWorker.js")
];

const resolvedSource = await resolveExistingFile(workerCandidates);
if (!resolvedSource) {
  throw new Error("mockServiceWorker.js not found in msw package.");
}
await mkdir(resolve(rootDir, "packages/standalone/dist"), { recursive: true });
await copyFile(resolvedSource, workerTargets[0]);
await Promise.all(
  workerTargets.map(async (target) => {
    await mkdir(resolve(target, ".."), { recursive: true });
    await copyFile(resolvedSource, target);
  })
);
const extableCssRootDest = resolve(standaloneDir, "dist", "extable.css");
await copyFile(extableCssSource, extableCssRootDest);

function resolveMswWorkerCandidates(rootDir) {
  const candidates = [];
  try {
    const mswRoot = resolve(require.resolve("msw/package.json"), "..");
    candidates.push(
      resolve(mswRoot, "lib/mockServiceWorker.js"),
      resolve(mswRoot, "src/mockServiceWorker.js"),
      resolve(mswRoot, "dist/mockServiceWorker.js")
    );
  } catch {
    // ignore
  }
  candidates.push(
    resolve(rootDir, "node_modules/msw/lib/mockServiceWorker.js"),
    resolve(rootDir, "node_modules/msw/src/mockServiceWorker.js"),
    resolve(rootDir, "node_modules/msw/dist/mockServiceWorker.js")
  );
  return candidates;
}

async function resolveExistingFile(candidates) {
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  return null;
}
