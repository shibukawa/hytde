import { init } from "../../src/index";
import { registerGlobalInit } from "../../src/entry-utils";

registerGlobalInit(init);

export { init };
