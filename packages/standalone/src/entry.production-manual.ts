import { init } from "./index";
import { registerGlobalInit } from "./entry-utils";

registerGlobalInit(init);

export { init };
