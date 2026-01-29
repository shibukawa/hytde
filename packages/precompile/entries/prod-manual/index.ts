import { init } from "../../src/entry-runtime";
import { registerGlobalInit } from "../../src/entry-utils";
import { installMockServiceWorkerStub } from "../../src/msw-stub";

installMockServiceWorkerStub(globalThis);
registerGlobalInit(init);

export { init };
