import { ensureTableApi, ensureTablePlugin } from "./table/runtime";
import { installTransformApi } from "./state/transforms";
import { ensureGlobals, emitPathDiagnostics, initHyPathParams, syncHyPathParams } from "./state/globals";
import { getRuntimeState, getRuntimeStateForDoc, isMockDisabled } from "./runtime-state";
import { setupPlugins } from "./utils/plugins";
import { setupNavigationHandlers } from "./action/navigation";
import { setupFormHandlers } from "./form/forms";
import { setupAsyncUploadHandlers } from "./uploader/async-upload";
import { setupFormStateHandlers } from "./form/form-state";
import { setupActionHandlers, setupFillActionHandlers } from "./action/actions";
import { setupAutoSubmitHandlers } from "./form/auto-submit";
import { setupHistoryHandlers, hasHistoryAutoSubmit, runHistoryAutoSubmits } from "./history/runtime";
import { renderDocument } from "./render";
import { handleRequest } from "./requests/runtime";
import type {
  ParsedDocument,
  ParserAdapter
} from "./types";
import type { RuntimeState } from "./state";

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
} from "./types";

export { initHyPathParams };

declare global {
  // eslint-disable-next-line no-var
  var hyState: Record<string, unknown> | undefined;
  // eslint-disable-next-line no-var
  var hy: import("./types").HyGlobals | undefined;
  // eslint-disable-next-line no-var
  var hyParams: Record<string, string> | undefined;
}

const globalScope = typeof globalThis !== "undefined" ? globalThis : undefined;
if (globalScope) {
  installTransformApi(globalScope);
  ensureTableApi(globalScope);
}

export interface Runtime {
  init(parsed: ParsedDocument): void;
}

export function createRuntime(parser: ParserAdapter): Runtime {
  return {
    init(parsed: ParsedDocument) {
      const doc = parsed.doc;
      const scope = doc.defaultView ?? globalThis;
      const globals = ensureGlobals(scope);
      ensureTableApi(scope);
      ensureTablePlugin(scope, getRuntimeStateForDoc);

      if (parsed.executionMode === "disable") {
        return;
      }

      const state = getRuntimeState(doc, globals, parsed, parser);
      void isMockDisabled;
      setupPlugins(state);
      syncHyPathParams(state);
      emitPathDiagnostics(state);
      setupNavigationHandlers(state);

      void bootstrapRuntime(state);
    }
  };
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
  const requests: Promise<unknown>[] = [];

  for (const target of state.parsed.requestTargets) {
    if (target.trigger !== "startup") {
      continue;
    }

    requests.push(handleRequest(target, state));
  }

  await Promise.all(requests);
}
