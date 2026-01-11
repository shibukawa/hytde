import { installMockServiceWorkerApi } from "@hytde/standalone/msw-debug";
import { registerDebugLogger } from "../../src/debug-logger";
import { init } from "../../src/entry-runtime";
import { registerGlobalInit } from "../../src/entry-utils";

registerDebugLogger();
installMockServiceWorkerApi(globalThis);
registerGlobalInit(init);

export { init };
