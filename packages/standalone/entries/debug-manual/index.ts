import { init } from "../../src/index";
import { registerDebugLogger } from "../../src/debug-logger";
import { registerGlobalInit } from "../../src/entry-utils";

registerDebugLogger();
registerGlobalInit(init);

export { init };
