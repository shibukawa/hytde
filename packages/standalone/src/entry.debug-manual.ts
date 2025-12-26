import { init } from "./index";
import { registerDebugLogger } from "./debug-logger";
import { registerGlobalInit } from "./entry-utils";

registerDebugLogger();
registerGlobalInit(init);

export { init };
