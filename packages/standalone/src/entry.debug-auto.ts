import { init } from "./index";
import { registerDebugLogger } from "./debug-logger";
import { initOnReady } from "./entry-utils";

registerDebugLogger();
initOnReady(init);
