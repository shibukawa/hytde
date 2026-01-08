import { parseHyPathMeta } from "./parse/hy-path";
import type { HyGlobals, HyLogEntry, ParsedDocument, ParserAdapter } from "./types";
import type { RuntimeGlobals } from "./types";
import type { RuntimeState } from "./state";
import { buildCascadeState } from "./action/cascade";
import { ensureCallbackStore, LOG_CALLBACK_KEY, RENDER_CALLBACK_KEY } from "./state/globals";
import { handleActionRequest, prefetchActionRequest } from "./requests/runtime";

const runtimeStates = new WeakMap<Document, RuntimeState>();

export function getRuntimeStateForDoc(doc: Document): RuntimeState | undefined {
  return runtimeStates.get(doc);
}

export function getRuntimeState(
  doc: Document,
  globals: RuntimeGlobals,
  parsed: ParsedDocument,
  parser: ParserAdapter
): RuntimeState {
  const existing = runtimeStates.get(doc);
  if (existing) {
    existing.globals = globals;
    existing.parsed = parsed;
    existing.parser = parser;
    existing.cascade = buildCascadeState(existing, parsed);
    existing.asyncUploads = new Map();
    existing.asyncUploadEntries = new Map();
    existing.actionHandlers = {
      handleActionRequest,
      prefetchActionRequest
    };
    return existing;
  }

  const hy = globals.hy as HyGlobals & Record<string, unknown>;
  const renderCallbacks = ensureCallbackStore(hy, RENDER_CALLBACK_KEY) as Array<() => void>;
  const logCallbacks = ensureCallbackStore(hy, LOG_CALLBACK_KEY) as Array<(entry: HyLogEntry) => void>;
  const streamStores = parsed.requestTargets
    .filter((target) => (target.kind === "stream" || target.kind === "sse") && target.store)
    .map((target) => target.store as string);

  const state: RuntimeState = {
    doc,
    globals,
    parsed,
    parser,
    cascade: {
      storeToSelects: new Map(),
      selectToStores: new Map(),
      selectIds: new WeakMap(),
      cycleSelects: new WeakSet(),
      cycleLogs: new Set(),
      disabledState: new WeakMap(),
      actionSkip: new WeakSet()
    },
    asyncUploads: new Map(),
    asyncUploadEntries: new Map(),
    bootstrapPending: false,
    plugins: [],
    pluginsInitialized: false,
    unloadListenerAttached: false,
    disposed: false,
    cloakApplied: false,
    appendStores: null,
    appendLogOnlyNew: false,
    streamKeyCache: new Map(),
    sseSources: new Map(),
    pollingTimers: new Map(),
    streamStores,
    requestCache: new Map(),
    requestCounter: 0,
    pendingRequests: 0,
    formListeners: new WeakSet(),
    formTargets: new Map(),
    submitterTargets: new Map(),
    formStateContexts: new Map(),
    formStateListeners: new WeakSet(),
    fillActionListeners: new WeakSet(),
    fillActionData: new WeakMap(),
    autoSubmitListeners: new WeakSet(),
    autoSubmitState: new WeakMap(),
    inFlightForms: new WeakSet(),
    actionListeners: new WeakSet(),
    actionDebounceTimers: new WeakMap(),
    actionPrefetchCache: new Map(),
    actionPrefetchInFlight: new Map(),
    actionCommandSkip: new WeakSet(),
    actionHandlers: {
      handleActionRequest,
      prefetchActionRequest
    },
    optimisticInputValues: new WeakMap(),
    formDisableSnapshots: new WeakMap(),
    historyListenerAttached: false,
    renderCallbacks,
    logCallbacks,
    errorUi: null,
    errorDedup: new Set(),
    pathMeta: parseHyPathMeta(doc),
    pathDiagnostics: null,
    pathDiagnosticsEmitted: false,
    missingPathParams: new Set(),
    navListenerAttached: false,
    formStateNavListenerAttached: false
  };

  state.cascade = buildCascadeState(state, parsed);
  runtimeStates.set(doc, state);
  return state;
}

export function isMockDisabled(globals: RuntimeGlobals): boolean {
  void globals;
  return false;
}
