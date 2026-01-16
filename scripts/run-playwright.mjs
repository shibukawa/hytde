import { spawn } from "node:child_process";
import os from "node:os";

const env = { ...process.env };

if (!env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE && process.platform === "darwin" && process.arch === "arm64") {
  const version = os.release().split(".").map((part) => Number.parseInt(part, 10));
  let macVersion = "mac10.13";
  if (version[0] === 18) {
    macVersion = "mac10.14";
  } else if (version[0] === 19) {
    macVersion = "mac10.15";
  } else if (version[0] > 19) {
    const LAST_STABLE_MACOS_MAJOR_VERSION = 15;
    macVersion = `mac${Math.min(version[0] - 9, LAST_STABLE_MACOS_MAJOR_VERSION)}`;
  }
  env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = `${macVersion}-arm64`;
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["playwright", "test", ...process.argv.slice(2)];
const child = spawn(command, args, { stdio: "inherit", env });

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
