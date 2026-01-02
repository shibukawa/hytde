import { init } from "../../src/index";
import { installMockServiceWorkerApi } from "../../src/msw-debug";
import { registerDebugLogger } from "../../src/debug-logger";
import { initOnReady } from "../../src/entry-utils";

registerDebugLogger();
installMockServiceWorkerApi(globalThis);
initOnReady(init);
