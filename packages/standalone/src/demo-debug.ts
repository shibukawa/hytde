import { init, parseHtml, parseDocumentToIr, parseSubtree, hy } from "./entry-runtime";
import { installMockServiceWorkerApi } from "./msw-debug";

installMockServiceWorkerApi(globalThis);

export { init, parseHtml, parseDocumentToIr, parseSubtree, hy };
