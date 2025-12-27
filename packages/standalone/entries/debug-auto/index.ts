import { init } from "../../src/index";
import { registerDebugLogger } from "../../src/debug-logger";
import { initOnReady } from "../../src/entry-utils";

registerDebugLogger();
initOnReady(init);
