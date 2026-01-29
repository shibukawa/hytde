import { init } from "../../src/index";
import { initOnReady } from "../../src/entry-utils";
import { installMockServiceWorkerStub } from "../../src/msw-stub";

installMockServiceWorkerStub(globalThis);
initOnReady(init);
