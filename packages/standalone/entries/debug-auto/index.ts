import { init } from "../../src/entry-runtime";
import { installMockServiceWorkerApi } from "../../src/msw-debug";
import { registerDebugLogger } from "../../src/debug-logger";
import { initOnReady } from "../../src/entry-utils";

registerDebugLogger();
installMockServiceWorkerApi(globalThis);
console.debug("[hytde] runtime:init:hy", { auto: true, manualInitExported: false });
console.debug("[hytde] runtime:dom:gate", {
  readyState: document.readyState,
  waiting: document.readyState === "loading" || document.readyState === "interactive"
});
initOnReady(init);
