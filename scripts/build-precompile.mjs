import { spawn } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const precompileDir = resolve(rootDir, "packages/precompile");
const standaloneDir = resolve(rootDir, "packages/standalone");
const extableSource = resolve(standaloneDir, "dist/prod/extable.css");
const extableTarget = resolve(precompileDir, "src/extable.css");

const variants = ["prod", "debug", "prod-manual", "debug-manual"];

const isWindows = process.platform === "win32";
const viteCommand = isWindows ? "npx.cmd" : "npx";

async function runVariant(variant) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(viteCommand, ["vite", "build"], {
      cwd: precompileDir,
      stdio: "inherit",
      env: {
        ...process.env,
        HYTDE_PRECOMPILE_VARIANT: variant
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

await access(extableSource);
await mkdir(resolve(precompileDir, "src"), { recursive: true });
await copyFile(extableSource, extableTarget);

for (const variant of variants) {
  await runVariant(variant);
}
