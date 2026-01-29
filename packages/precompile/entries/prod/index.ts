import { init } from "../../src/entry-runtime";
import { initOnReady } from "../../src/entry-utils";
import { installMockServiceWorkerStub } from "../../src/msw-stub";

installMockServiceWorkerStub(globalThis);
initOnReady(init);
