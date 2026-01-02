import { init, parseHtml, parseDocument, parseSubtree, hy } from "./entry-runtime";
import { installMockServiceWorkerApi } from "./msw-debug";

installMockServiceWorkerApi(globalThis);

export { init, parseHtml, parseDocument, parseSubtree, hy };
