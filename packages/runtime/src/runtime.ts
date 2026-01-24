import { ensureTableApi, ensureTablePlugin } from "./table/runtime.js";
import { installTransformApi } from "./state/transforms.js";
import { ensureGlobals, emitPathDiagnostics, initHyPathParams, syncHyPathParams } from "./state/globals.js";
import { getRuntimeState, getRuntimeStateForDoc, isMockDisabled } from "./runtime-state.js";
import { setupPlugins } from "./utils/plugins.js";
import { setupNavigationHandlers } from "./action/navigation.js";
import { setupFormHandlers } from "./form/forms.js";
import { setupAsyncUploadHandlers } from "./uploader/async-upload.js";
import { setupFormStateHandlers } from "./form/form-state.js";
import { setupActionHandlers, setupFillActionHandlers } from "./action/actions.js";
import { setupAutoSubmitHandlers } from "./form/auto-submit.js";
import { setupHistoryHandlers, hasHistoryAutoSubmit, runHistoryAutoSubmits } from "./history/runtime.js";
import { renderDocument } from "./render/index.js";
import { handleRequest } from "./requests/runtime.js";
import type { ParserAdapter } from "./types.js";
import type { IrDocument } from "./ir.js";
import { buildParsedDocumentFromIr } from "./ir.js";
import type { RuntimeState } from "./state.js";
import { applySsrStateToGlobals, readSsrState, seedPrefetchCache } from "./ssr.js";
import { SpaRouter } from "./spa/router.js";

export type {
  AsyncUploadEntry,
  AsyncUploadStatus,
  HyError,
  HyGlobals,
  HyLogEntry,
  HytdePlugin,
  JsonScalar,
  JsonScalarType,
  ParsedAttrBinding,
  ParsedDocument,
  ParsedFillAction,
  ParsedFillTarget,
  ParsedForTemplate,
  ParsedIfChain,
  ParsedIfChainNode,
  ParsedRequestTarget,
  ParsedSubtree,
  ParsedTextBinding,
  ParserAdapter,
  PluginChange,
  PluginParseContext,
  PluginRenderContext,
  PluginState,
  PluginWatchTarget,
  RuntimeGlobals
} from "./types.js";
export type { IrDocument } from "./ir.js";

export { initHyPathParams };

declare global {
  // eslint-disable-next-line no-var
  var hyState: Record<string, unknown> | undefined;
  // eslint-disable-next-line no-var
  var hy: import("./types").HyGlobals | undefined;
  // eslint-disable-next-line no-var
  var hyParams: Record<string, string> | undefined;
  // eslint-disable-next-line no-var
  var hyRouter: SpaRouter | undefined;
}

const globalScope = typeof globalThis !== "undefined" ? globalThis : undefined;
if (globalScope) {
  installTransformApi(globalScope);
  ensureTableApi(globalScope);
}

export interface Runtime {
  init(doc: Document, ir: IrDocument): void;
}

export function createRuntime(parser: ParserAdapter): Runtime {
  return {
    init(doc: Document, ir: IrDocument) {
      const parsed = buildParsedDocumentFromIr(doc, ir);
      const scope = doc.defaultView ?? globalThis;
      const ssrState = readSsrState(doc);
      if (ssrState) {
        applySsrStateToGlobals(scope, ssrState);
      }
      const globals = ensureGlobals(scope);
      ensureTableApi(scope);
      ensureTablePlugin(scope, getRuntimeStateForDoc);

      if (parsed.executionMode === "disable") {
        return;
      }

      const state = getRuntimeState(doc, globals, parsed, parser);
      if (ssrState) {
        seedPrefetchCache(state, ssrState);
      }
      void isMockDisabled;
      setupPlugins(state);
      syncHyPathParams(state);
      emitPathDiagnostics(state);
      setupNavigationHandlers(state);

      void bootstrapRuntime(state);
      initSpaRouter(scope, doc);
    }
  };
}

function initSpaRouter(scope: typeof globalThis, doc: Document): void {
  const view = doc.defaultView;
  if (!view) {
    return;
  }
  if (view.hyRouter) {
    return;
  }
  fetch("/route-manifest.json", { method: "HEAD" })
    .then((response) => {
      if (!response.ok) {
        return;
      }
      const router = new SpaRouter();
      view.hyRouter = router;
      (view as typeof globalThis & { __hytdeSpaEnabled?: boolean }).__hytdeSpaEnabled = true;
      void router.init();
    })
    .catch(() => undefined);
}

async function bootstrapRuntime(state: RuntimeState): Promise<void> {
  setupFormHandlers(state);
  setupAsyncUploadHandlers(state);
  setupFormStateHandlers(state);
  setupActionHandlers(state);
  setupFillActionHandlers(state, state.parsed.fillActions);
  setupAutoSubmitHandlers(state);
  setupHistoryHandlers(state);
  const hasStartupRequests = state.parsed.requestTargets.some((target) => target.trigger === "startup");
  const hasHistoryRequests = hasHistoryAutoSubmit(state);
  if (hasStartupRequests || hasHistoryRequests) {
    state.bootstrapPending = true;
    await Promise.all([runStartupRequests(state), runHistoryAutoSubmits(state)]);
    state.bootstrapPending = false;
  }
  const appendStores = state.streamStores;
  renderDocument(state, undefined, appendStores.length > 0 ? { appendStores } : undefined);
}

async function runStartupRequests(state: RuntimeState): Promise<void> {
  const requests = state.parsed.requestTargets.filter((target) => target.trigger === "startup");
  for (const target of requests) {
    await handleRequest(target, state);
  }
}
