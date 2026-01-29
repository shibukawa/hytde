import { installMockServiceWorkerApi } from "@hytde/standalone/msw-debug";
import { registerDebugLogger } from "../../src/debug-logger";
import { init } from "../../src/entry-runtime";
import { initOnReady } from "../../src/entry-utils";

registerDebugLogger();
installMockServiceWorkerApi(globalThis);
initOnReady(init);
