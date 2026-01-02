import { init } from "../../src/index";
import { installMockServiceWorkerApi } from "../../src/msw-debug";
import { registerDebugLogger } from "../../src/debug-logger";
import { registerGlobalInit } from "../../src/entry-utils";

registerDebugLogger();
installMockServiceWorkerApi(globalThis);
registerGlobalInit(init);

export { init };
