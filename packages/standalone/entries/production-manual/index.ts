import { init } from "../../src/index";
import { registerGlobalInit } from "../../src/entry-utils";
import { installMockServiceWorkerStub } from "../../src/msw-stub";

installMockServiceWorkerStub(globalThis);
registerGlobalInit(init);

export { init };
