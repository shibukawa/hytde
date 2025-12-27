import { spawn } from "node:child_process";
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
