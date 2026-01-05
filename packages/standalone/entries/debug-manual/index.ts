import { init } from "../../src/entry-runtime";
import { installMockServiceWorkerApi } from "../../src/msw-debug";
import { registerDebugLogger } from "../../src/debug-logger";
import { registerGlobalInit } from "../../src/entry-utils";

registerDebugLogger();
installMockServiceWorkerApi(globalThis);
console.debug("[hytde] runtime:init:hy", { auto: false, manualInitExported: true });
registerGlobalInit(init);

export { init };
