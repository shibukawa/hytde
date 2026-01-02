export interface HyError {
  type: "request" | "transform" | "syntax" | "data";
  message: string;
  detail?: Record<string, unknown> & {
    url?: string;
    method?: string;
    status?: number;
    selector?: string;
    transform?: string;
    expression?: string;
    attribute?: string;
    context?: string;
  };
  timestamp: number;
}

export interface HyLogEntry {
  type: "render" | "request" | "error" | "info";
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
}

export type PluginState = Record<string, unknown> | null;

export type PluginWatchTarget =
  | { type: "store"; selector: string }
  | { type: "dom"; selector: string };

export type PluginParseContext = {
  doc: Document;
  parsed: ParsedDocument;
};

export type PluginParseResult = {
  state?: PluginState;
  watches?: PluginWatchTarget[];
};

export type PluginChange = PluginWatchTarget;

export type PluginRenderContext = {
  doc: Document;
  parsed: ParsedDocument;
  reason: "init" | "update";
  changes?: PluginChange[];
};

export interface HytdePlugin {
  name: string;
  onParse?: (context: PluginParseContext) => PluginParseResult | void;
  onRender?: (context: PluginRenderContext, state: PluginState) => void;
  onBeforeUnload?: (context: PluginRenderContext, state: PluginState) => string | void;
  onDispose?: (context: PluginRenderContext, state: PluginState) => void;
}

export interface HyGlobals {
  loading: boolean;
  errors: HyError[];
  onRenderComplete?: (callback: () => void) => void;
  onLog?: (callback: (entry: HyLogEntry) => void) => void;
  onError?: (errors: HyError[]) => void;
  plugins?: HytdePlugin[];
  registerPlugin?: (plugin: HytdePlugin) => void;
  registerTransform?: (
    name: string,
    inputType: JsonScalarType,
    fn: (input: JsonScalar, ...args: unknown[]) => JsonScalar
  ) => void;
}

export interface RuntimeGlobals {
  hy: HyGlobals;
  hyState: Record<string, unknown>;
  hyParams: Record<string, string>;
}

declare global {
  // eslint-disable-next-line no-var
  var hyState: Record<string, unknown> | undefined;
  // eslint-disable-next-line no-var
  var hy: HyGlobals | undefined;
  // eslint-disable-next-line no-var
  var hyParams: Record<string, string> | undefined;
}

interface MockRule {
  pattern: RegExp;
  path: string;
  method: string;
  status?: number;
  delayMs?: { min: number; max: number };
}

export interface ParsedForTemplate {
  marker: Comment;
  template: Element;
  varName: string;
  selector: string;
  rendered: Node[];
}

export interface ParsedRequestTarget {
  element: Element;
  urlTemplate: string;
  store: string | null;
  unwrap: string | null;
  method: string;
  kind: "fetch" | "stream" | "sse" | "polling";
  streamInitial: number;
  streamTimeoutMs: number | null;
  streamKey: string | null;
  pollIntervalMs: number | null;
  isForm: boolean;
  trigger: "startup" | "submit" | "action";
  form: HTMLFormElement | null;
  fillInto: string | null;
  fillTarget: string | null;
  fillValue: string | null;
}

export interface ParsedFillTarget {
  form: HTMLFormElement;
  selector: string;
}

export interface ParsedFillAction {
  element: Element;
  selector: string;
  value: string | null;
  form: HTMLFormElement | null;
  command: string | null;
  commandFor: string | null;
}

export interface ParsedTextBinding {
  element: Element;
  expression: string;
}

export interface ParsedAttrBinding {
  element: Element;
  attr: string;
  target: string;
  template: string;
}

export interface ParsedIfChainNode {
  node: Element;
  kind: "if" | "else-if" | "else";
  expression: string | null;
}

export interface ParsedIfChain {
  anchor: Comment;
  nodes: ParsedIfChainNode[];
}

export interface ParsedSubtree {
  dummyElements: Element[];
  cloakElements: Element[];
  forTemplates: ParsedForTemplate[];
  ifChains: ParsedIfChain[];
  textBindings: ParsedTextBinding[];
  attrBindings: ParsedAttrBinding[];
  fillTargets: ParsedFillTarget[];
  fillActions: ParsedFillAction[];
}

export interface ParsedDocument extends ParsedSubtree {
  doc: Document;
  executionMode: "production" | "mock" | "disable";
  mockRules: MockRule[];
  parseErrors: Array<{ message: string; detail?: Record<string, unknown> }>;
  requestTargets: ParsedRequestTarget[];
  handlesErrors: boolean;
  hasErrorPopover: boolean;
}

export interface ParserAdapter {
  parseDocument: (doc: Document) => ParsedDocument;
  parseSubtree(root: ParentNode): ParsedSubtree;
}

interface RuntimeState {
  doc: Document;
  globals: RuntimeGlobals;
  mockRules: MockRule[];
  useMswMock: boolean;
  parsed: ParsedDocument;
  parser: ParserAdapter;
  cascade: CascadeState;
  bootstrapPending: boolean;
  plugins: PluginRegistration[];
  pluginsInitialized: boolean;
  unloadListenerAttached: boolean;
  disposed: boolean;
  cloakApplied: boolean;
  appendStores: Set<string> | null;
  appendLogOnlyNew: boolean;
  streamKeyCache: Map<string, Set<string>>;
  sseSources: Map<ParsedRequestTarget, EventSource>;
  pollingTimers: Map<ParsedRequestTarget, number>;
  pollingMockQueues: Map<ParsedRequestTarget, { items: unknown[]; index: number }>;
  streamStores: string[];
  requestCache: Map<string, { promise: Promise<void>; payload: unknown; payloadSet: boolean }>;
  requestCounter: number;
  pendingRequests: number;
  formListeners: WeakSet<HTMLFormElement>;
  formTargets: Map<HTMLFormElement, ParsedRequestTarget>;
  submitterTargets: Map<Element, ParsedRequestTarget>;
  formStateContexts: Map<HTMLFormElement, FormStateContext>;
  formStateListeners: WeakSet<HTMLFormElement>;
  fillActionListeners: WeakSet<Element>;
  fillActionData: WeakMap<Element, ParsedFillAction>;
  autoSubmitListeners: WeakSet<HTMLFormElement>;
  autoSubmitState: WeakMap<HTMLFormElement, AutoSubmitState>;
  inFlightForms: WeakSet<HTMLFormElement>;
  actionListeners: WeakSet<Element>;
  actionDebounceTimers: WeakMap<Element, number>;
  actionPrefetchCache: Map<string, { timestamp: number; payload: unknown }>;
  actionPrefetchInFlight: Map<string, Promise<void>>;
  actionCommandSkip: WeakSet<Element>;
  optimisticInputValues: WeakMap<HTMLInputElement, unknown>;
  historyListenerAttached: boolean;
  renderCallbacks: Array<() => void>;
  logCallbacks: Array<(entry: HyLogEntry) => void>;
  errorUi: ErrorUiState | null;
  errorDedup: Set<string>;
  pathMeta: HyPathMeta;
  pathDiagnostics: HyPathDiagnostics | null;
  pathDiagnosticsEmitted: boolean;
  missingPathParams: Set<string>;
  navListenerAttached: boolean;
  formStateNavListenerAttached: boolean;
}

type CascadeDisabledState = {
  prevDisabled: boolean;
  prevAriaBusy: string | null;
};

type CascadeState = {
  storeToSelects: Map<string, Set<HTMLSelectElement>>;
  selectToStores: Map<HTMLSelectElement, Set<string>>;
  selectIds: WeakMap<HTMLSelectElement, string>;
  cycleSelects: WeakSet<HTMLSelectElement>;
  cycleLogs: Set<string>;
  disabledState: WeakMap<HTMLSelectElement, CascadeDisabledState>;
  actionSkip: WeakSet<HTMLSelectElement>;
};

interface ErrorUiState {
  toast: HTMLDivElement;
  toastCount: HTMLSpanElement;
  dialog: HTMLDivElement;
  list: HTMLDivElement;
  clearButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

type PluginRegistration = {
  plugin: HytdePlugin;
  state: PluginState;
  watches: PluginWatchTarget[];
};

const runtimeStates = new WeakMap<Document, RuntimeState>();
const RENDER_CALLBACK_KEY = "__hytdeRenderCallbacks";
const LOG_CALLBACK_KEY = "__hytdeLogCallbacks";
const TRANSFORM_REGISTRY_KEY = "__hytdeTransforms";
const PATH_DIAGNOSTIC_KEY = "__hytdePathDiagnostics";
const NAV_FALLBACK_ATTR = "data-hy-hash-fallback";

type HyPathMode = "hash" | "path";

type HyPathMeta = {
  template: string | null;
  mode: HyPathMode;
};

type HyPathDiagnostics = {
  mode: HyPathMode;
  hashOverrides: string[];
  pathMatched: boolean;
  hashUsed: boolean;
};

type JsonScalar = string | number | boolean | null;
type JsonScalarType = "string" | "number" | "boolean" | "null";

interface TransformDefinition {
  inputType: JsonScalarType;
  fn: (input: JsonScalar, ...args: unknown[]) => JsonScalar;
}

interface AutoSubmitState {
  timer: number | null;
  composing: boolean;
  pendingComposition: boolean;
}

type FormStateMode = "autosave-guard" | "autosave" | "guard" | "off";

interface FormStateDeclaration {
  mode: FormStateMode;
  durationMs: number;
  raw: string;
}

interface FormStateContext {
  form: HTMLFormElement;
  owner: HTMLElement;
  ownerId: string | null;
  mode: FormStateMode;
  autosaveDelayMs: number;
  autosaveEnabled: boolean;
  dirty: boolean;
  hasDraft: boolean;
  lastCommittedJson: string | null;
  autosaveTimer: number | null;
  fileWarningEmitted: boolean;
}

const TRANSFORM_TYPES: JsonScalarType[] = ["string", "number", "boolean", "null"];
const DEFAULT_AUTOSAVE_DELAY_MS = 500;
const MSW_STATE_KEY = "__hytdeMswState";
const MOCK_DISABLED_KEY = "__hytdeMockDisabled";

const globalScope = typeof globalThis !== "undefined" ? globalThis : undefined;
if (globalScope) {
  installTransformApi(globalScope);
}

export interface Runtime {
  init(parsed: ParsedDocument): void;
}

export function createRuntime(parser: ParserAdapter): Runtime {
  return {
    init(parsed: ParsedDocument) {
      const doc = parsed.doc;
      const globals = ensureGlobals(doc.defaultView ?? globalThis);

      if (parsed.executionMode === "disable") {
        return;
      }

      const state = getRuntimeState(doc, globals, parsed, parser);
      void isMockDisabled;
      state.mockRules = [];
      setupPlugins(state);
      syncHyPathParams(state);
      emitPathDiagnostics(state);
      setupNavigationHandlers(state);

      void bootstrapRuntime(state);
    }
  };
}

export function initHyPathParams(doc: Document): void {
  const view = doc.defaultView;
  if (!view) {
    return;
  }
  const meta = parseHyPathMeta(doc);
  const { params, diagnostics } = resolveHyParamsForLocation(view.location, meta);
  view.hyParams = params;
  if (!view.hy) {
    view.hy = { loading: false, errors: [] };
  }
  const hy = view.hy as HyGlobals & Record<string, unknown>;
  hy.pathParams = params;
  (view as unknown as Record<string, unknown>)[PATH_DIAGNOSTIC_KEY] = diagnostics;
}

function ensureGlobals(scope: typeof globalThis): RuntimeGlobals {
  if (!scope.hyState) {
    scope.hyState = {};
  }
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }

  const hy = scope.hy as HyGlobals & Record<string, unknown>;
  installTransformApi(scope);
  const renderCallbacks = ensureCallbackStore(hy, RENDER_CALLBACK_KEY);
  const logCallbacks = ensureCallbackStore(hy, LOG_CALLBACK_KEY);
  ensureDefaultTransforms(hy);

  if (!hy.onRenderComplete) {
    hy.onRenderComplete = (callback: () => void) => {
      renderCallbacks.push(callback);
    };
  }
  if (!hy.onLog) {
    hy.onLog = (callback: (entry: HyLogEntry) => void) => {
      logCallbacks.push(callback);
    };
  }

  if (!scope.hyParams) {
    scope.hyParams = parseParams(scope.location?.search ?? "", scope.location?.hash ?? "");
  }
  if (scope.hy) {
    const hy = scope.hy as HyGlobals & Record<string, unknown>;
    if (!hy.pathParams) {
      hy.pathParams = scope.hyParams;
    }
  }

  return {
    hy: hy as HyGlobals,
    hyState: scope.hyState as Record<string, unknown>,
    hyParams: scope.hyParams as Record<string, string>
  };
}

function setupPlugins(state: RuntimeState): void {
  const hy = state.globals.hy as HyGlobals & Record<string, unknown>;
  const list = Array.isArray(hy.plugins) ? hy.plugins : [];
  if (!Array.isArray(hy.plugins)) {
    hy.plugins = list;
  }

  const registerPluginInternal = (plugin: HytdePlugin): void => {
    if (!plugin || typeof plugin.name !== "string") {
      return;
    }
    if (state.plugins.some((entry) => entry.plugin === plugin || entry.plugin.name === plugin.name)) {
      return;
    }
    const parseResult = plugin.onParse ? plugin.onParse({ doc: state.doc, parsed: state.parsed }) : undefined;
    const watches = parseResult?.watches ?? [];
    const pluginState = parseResult?.state ?? null;
    state.plugins.push({ plugin, state: pluginState, watches });
  };

  hy.registerPlugin = (plugin: HytdePlugin) => {
    if (!list.includes(plugin)) {
      list.push(plugin);
    }
    registerPluginInternal(plugin);
  };

  for (const plugin of list) {
    registerPluginInternal(plugin);
  }

  if (!state.unloadListenerAttached) {
    const scope = state.doc.defaultView ?? globalThis;
    scope.addEventListener("beforeunload", (event) => {
      const message = collectBeforeUnloadMessage(state);
      if (message) {
        event.preventDefault();
        event.returnValue = message;
        return message;
      }
      return undefined;
    });
    scope.addEventListener("pagehide", () => {
      disposePlugins(state);
    });
    state.unloadListenerAttached = true;
  }
}

function getRuntimeState(
  doc: Document,
  globals: RuntimeGlobals,
  parsed: ParsedDocument,
  parser: ParserAdapter
): RuntimeState {
  const existing = runtimeStates.get(doc);
  const useMswMock = detectMswMock(globals);
  if (existing) {
    existing.globals = globals;
    existing.parsed = parsed;
    existing.parser = parser;
    existing.cascade = buildCascadeState(existing, parsed);
    existing.useMswMock = useMswMock;
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
    mockRules: [],
    useMswMock,
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
    pollingMockQueues: new Map(),
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
    optimisticInputValues: new WeakMap(),
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

function detectMswMock(globals: RuntimeGlobals): boolean {
  const hy = globals.hy as HyGlobals & Record<string, unknown>;
  const state = hy ? (hy[MSW_STATE_KEY] as { started?: boolean } | undefined) : undefined;
  return Boolean(state && state.started);
}

function isMockDisabled(globals: RuntimeGlobals): boolean {
  void globals;
  return false;
}

function buildCascadeState(state: RuntimeState | null, parsed: ParsedDocument): CascadeState {
  const storeToSelects = new Map<string, Set<HTMLSelectElement>>();
  const selectToStores = new Map<HTMLSelectElement, Set<string>>();
  const selectIds = new WeakMap<HTMLSelectElement, string>();
  const cycleSelects = new WeakSet<HTMLSelectElement>();
  const cycleLogs = new Set<string>();
  const disabledState = new WeakMap<HTMLSelectElement, CascadeDisabledState>();
  const actionSkip = new WeakSet<HTMLSelectElement>();
  let anonymousIndex = 0;

  const registerSelect = (select: HTMLSelectElement): void => {
    if (selectIds.has(select)) {
      return;
    }
    const name = select.name?.trim();
    const id = select.id?.trim();
    if (name) {
      selectIds.set(select, name);
    } else if (id) {
      selectIds.set(select, `#${id}`);
    } else {
      anonymousIndex += 1;
      selectIds.set(select, `select-${anonymousIndex}`);
    }
  };

  for (const template of parsed.forTemplates) {
    const element = template.template;
    if (element.tagName !== "OPTION") {
      continue;
    }
    const parent = template.marker.parentNode;
    if (!(parent instanceof HTMLSelectElement)) {
      continue;
    }
    const tokens = parseSelectorTokens(template.selector);
    const root = typeof tokens[0] === "string" ? tokens[0] : null;
    if (!root) {
      continue;
    }
    registerSelect(parent);
    const existing = storeToSelects.get(root);
    if (existing) {
      existing.add(parent);
    } else {
      storeToSelects.set(root, new Set([parent]));
    }
  }

  for (const target of parsed.requestTargets) {
    if (!(target.element instanceof HTMLSelectElement)) {
      continue;
    }
    if (!target.store) {
      continue;
    }
    registerSelect(target.element);
    const existing = selectToStores.get(target.element);
    if (existing) {
      existing.add(target.store);
    } else {
      selectToStores.set(target.element, new Set([target.store]));
    }
  }

  const edges = new Map<HTMLSelectElement, Set<HTMLSelectElement>>();
  for (const [select, stores] of selectToStores.entries()) {
    for (const store of stores) {
      const downstream = storeToSelects.get(store);
      if (!downstream) {
        continue;
      }
      for (const next of downstream) {
        const existing = edges.get(select);
        if (existing) {
          existing.add(next);
        } else {
          edges.set(select, new Set([next]));
        }
      }
    }
  }

  const cycles = detectCascadeCycles(edges, selectIds, cycleSelects);
  if (state && cycles.length > 0) {
    emitCascadeCycleDiagnostics(state, cycles, cycleLogs);
  }

  return {
    storeToSelects,
    selectToStores,
    selectIds,
    cycleSelects,
    cycleLogs,
    disabledState,
    actionSkip
  };
}

function detectCascadeCycles(
  edges: Map<HTMLSelectElement, Set<HTMLSelectElement>>,
  selectIds: WeakMap<HTMLSelectElement, string>,
  cycleSelects: WeakSet<HTMLSelectElement>
): string[] {
  const visiting = new Set<HTMLSelectElement>();
  const visited = new Set<HTMLSelectElement>();
  const path: HTMLSelectElement[] = [];
  const cycles: string[] = [];

  const labelFor = (select: HTMLSelectElement): string => {
    return selectIds.get(select) ?? "select";
  };

  const recordCycle = (startIndex: number): void => {
    const slice = path.slice(startIndex);
    for (const node of slice) {
      cycleSelects.add(node);
    }
    if (slice.length === 0) {
      return;
    }
    const names = slice.map(labelFor);
    names.push(labelFor(slice[0]));
    cycles.push(names.join(" -> "));
  };

  const dfs = (select: HTMLSelectElement): void => {
    if (visiting.has(select)) {
      const startIndex = path.indexOf(select);
      if (startIndex >= 0) {
        recordCycle(startIndex);
      }
      return;
    }
    if (visited.has(select)) {
      return;
    }
    visiting.add(select);
    path.push(select);
    for (const next of edges.get(select) ?? []) {
      dfs(next);
    }
    path.pop();
    visiting.delete(select);
    visited.add(select);
  };

  for (const select of edges.keys()) {
    dfs(select);
  }

  return cycles;
}

function emitCascadeCycleDiagnostics(state: RuntimeState, cycles: string[], cycleLogs: Set<string>): void {
  for (const cycle of cycles) {
    if (cycleLogs.has(cycle)) {
      continue;
    }
    cycleLogs.add(cycle);
    emitLog(state, {
      type: "error",
      message: "cascade:cycle",
      detail: { cycle },
      timestamp: Date.now()
    });
    pushError(state, createHyError("data", "Cascade dependency cycle detected", { cycle }));
  }
}

function buildPluginContext(
  state: RuntimeState,
  reason: "init" | "update",
  changes?: PluginChange[]
): PluginRenderContext {
  return {
    doc: state.doc,
    parsed: state.parsed,
    reason,
    changes
  };
}

function shouldRunPlugin(registration: PluginRegistration, changes?: PluginChange[]): boolean {
  if (registration.watches.length === 0) {
    return true;
  }
  if (registration.watches.some((watch) => watch.type === "dom")) {
    return true;
  }
  if (!changes || changes.length === 0) {
    return false;
  }
  return registration.watches.some((watch) => {
    if (watch.type !== "store") {
      return false;
    }
    return changes.some((change) => change.type === "store" && change.selector === watch.selector);
  });
}

function runPluginRender(state: RuntimeState, reason: "init" | "update", changes?: PluginChange[]): void {
  const context = buildPluginContext(state, reason, changes);
  for (const registration of state.plugins) {
    if (reason === "update" && !shouldRunPlugin(registration, changes)) {
      continue;
    }
    registration.plugin.onRender?.(context, registration.state);
  }
}

function collectBeforeUnloadMessage(state: RuntimeState): string | null {
  if (shouldPromptLeave(state)) {
    return getFormStateLeaveMessage();
  }
  if (state.plugins.length === 0) {
    return null;
  }
  const context = buildPluginContext(state, "update");
  for (const registration of state.plugins) {
    const message = registration.plugin.onBeforeUnload?.(context, registration.state);
    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }
  return null;
}

function disposePlugins(state: RuntimeState): void {
  if (state.disposed) {
    return;
  }
  state.disposed = true;
  const context = buildPluginContext(state, "update");
  for (const registration of state.plugins) {
    registration.plugin.onDispose?.(context, registration.state);
  }
  for (const source of state.sseSources.values()) {
    source.close();
  }
  state.sseSources.clear();
  for (const timer of state.pollingTimers.values()) {
    window.clearInterval(timer);
  }
  state.pollingTimers.clear();
  state.pollingMockQueues.clear();
}

function parseHyPathMeta(doc: Document): HyPathMeta {
  const template = parseHyPathTemplate(doc);
  const modeMetas = Array.from(doc.querySelectorAll("meta[name=\"hy-path-mode\"]"));
  let mode: HyPathMode = "hash";
  modeMetas.forEach((meta) => {
    const content = meta.getAttribute("content") ?? "";
    const parsed = parseHyPathMode(content);
    if (parsed) {
      mode = parsed;
    }
  });

  return { template, mode };
}

function parseHyPathTemplate(doc: Document): string | null {
  const meta = doc.querySelector("meta[name=\"hy-path\"]");
  if (!meta) {
    return null;
  }
  const content = meta.getAttribute("content") ?? "";
  if (!content.trim()) {
    return null;
  }
  const parsed = parseMetaContent(content);
  const raw = parsed.template ?? content;
  const template = raw.trim();
  if (!template) {
    return null;
  }
  if (!isRelativePath(template)) {
    return null;
  }
  return normalizePathPattern(stripQueryHash(template));
}

function parseHyPathMode(content: string): HyPathMode | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "hash" || trimmed === "path") {
    return trimmed;
  }
  const parsed = parseMetaContent(trimmed);
  const mode = parsed.mode?.trim();
  if (mode === "hash" || mode === "path") {
    return mode;
  }
  return null;
}

function parseMetaContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = content.split(";").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    if (!rawKey || rest.length === 0) {
      continue;
    }
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (!key) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function stripQueryHash(path: string): string {
  const hashIndex = path.indexOf("#");
  const queryIndex = path.indexOf("?");
  const end = Math.min(
    hashIndex === -1 ? path.length : hashIndex,
    queryIndex === -1 ? path.length : queryIndex
  );
  return path.slice(0, end);
}

function normalizePathPattern(path: string): string {
  if (path === "*") {
    return "*";
  }
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isRelativePath(path: string): boolean {
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);
}

function resolveHyParamsForLocation(
  location: Location,
  meta: HyPathMeta
): { params: Record<string, string>; diagnostics: HyPathDiagnostics } {
  const pathname = location.pathname ?? "";
  const searchParams = parseSearchParams(location.search ?? "");
  const allowHash = shouldUseHashParams(pathname, meta.template);
  const hashParams = allowHash ? parseHashParams(location.hash ?? "") : {};
  let pathParams: Record<string, string> = {};
  let pathMatched = false;
  if (meta.template) {
    const extracted = extractPathParams(meta.template, pathname);
    pathParams = extracted.params;
    pathMatched = extracted.matched;
  }
  const params: Record<string, string> = {};
  const hashOverrides: string[] = [];
  Object.assign(params, pathParams);
  Object.assign(params, searchParams);
  for (const [key, value] of Object.entries(hashParams)) {
    if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== value) {
      hashOverrides.push(key);
    }
    params[key] = value;
  }

  const hashUsed = allowHash && Object.keys(hashParams).length > 0;

  return {
    params,
    diagnostics: {
      mode: meta.mode,
      hashOverrides,
      pathMatched,
      hashUsed
    }
  };
}

function shouldUseHashParams(pathname: string, template: string | null): boolean {
  if (!template) {
    return true;
  }
  return normalizePathPattern(pathname) === normalizePathPattern(template);
}

function parseSearchParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function parseHashParams(hash: string): Record<string, string> {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function extractPathParams(
  template: string,
  pathname: string
): { params: Record<string, string>; matched: boolean } {
  const cleanedTemplate = stripQueryHash(template);
  const templateParts = normalizePathPattern(cleanedTemplate).split("/").filter((part) => part !== "");
  const pathParts = normalizePathPattern(pathname).split("/").filter((part) => part !== "");
  if (templateParts.length !== pathParts.length) {
    return { params: {}, matched: false };
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < templateParts.length; index += 1) {
    const part = templateParts[index];
    const value = pathParts[index];
    const match = part.match(/^\[([^\]]+)\]$/);
    if (match) {
      const key = match[1];
      params[key] = decodeURIComponent(value);
      continue;
    }
    if (part !== value) {
      return { params: {}, matched: false };
    }
  }
  return { params, matched: true };
}

function parseParams(search: string, hash: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const result: Record<string, string> = {};

  params.forEach((value, key) => {
    result[key] = value;
  });
  hashParams.forEach((value, key) => {
    result[key] = value;
  });

  return result;
}

function syncHyPathParams(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  const { params, diagnostics } = resolveHyParamsForLocation(view.location, state.pathMeta);
  view.hyParams = params;
  state.globals.hyParams = params;
  const hy = state.globals.hy as HyGlobals & Record<string, unknown>;
  hy.pathParams = params;
  (view as unknown as Record<string, unknown>)[PATH_DIAGNOSTIC_KEY] = diagnostics;
  state.pathDiagnostics = diagnostics;
}

function emitPathDiagnostics(state: RuntimeState): void {
  if (state.pathDiagnosticsEmitted) {
    return;
  }
  const diagnostics = state.pathDiagnostics;
  if (!diagnostics) {
    return;
  }
  state.pathDiagnosticsEmitted = true;
  emitLog(state, {
    type: "info",
    message: "path:mode",
    detail: { mode: diagnostics.mode },
    timestamp: Date.now()
  });
  if (diagnostics.hashUsed) {
    emitLog(state, {
      type: "info",
      message: "path:hash-used",
      timestamp: Date.now()
    });
  }
  if (diagnostics.hashOverrides.length > 0) {
    emitLog(state, {
      type: "info",
      message: "path:hash-override",
      detail: { keys: diagnostics.hashOverrides },
      timestamp: Date.now()
    });
  }
}

function ensureCallbackStore(target: Record<string, unknown>, key: string): unknown[] {
  const existing = target[key];
  if (Array.isArray(existing)) {
    return existing;
  }
  const created: unknown[] = [];
  target[key] = created;
  return created;
}

function installTransformApi(scope: typeof globalThis): void {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }

  const hy = scope.hy as HyGlobals & Record<string, unknown>;
  if (typeof hy.registerTransform === "function") {
    return;
  }

  hy.registerTransform = (name: string, inputType: JsonScalarType, fn: (input: JsonScalar, ...args: unknown[]) => JsonScalar) => {
    if (!name || typeof name !== "string") {
      logTransformRegistrationError(`Transform name must be a non-empty string.`);
      return;
    }
    if (!TRANSFORM_TYPES.includes(inputType)) {
      logTransformRegistrationError(`Transform inputType must be one of ${TRANSFORM_TYPES.join(", ")}.`);
      return;
    }
    if (typeof fn !== "function") {
      logTransformRegistrationError(`Transform fn must be a function.`);
      return;
    }

    const registry = getTransformRegistry(hy);
    if (registry.has(name)) {
      logTransformRegistrationError(`Transform "${name}" is already registered.`);
      return;
    }

    registry.set(name, { inputType, fn });
  };
}

function ensureDefaultTransforms(hy: HyGlobals & Record<string, unknown>): void {
  const registry = getTransformRegistry(hy);
  if (!registry.has("date")) {
    registry.set("date", {
      inputType: "string",
      fn: (input: JsonScalar, ...args: unknown[]) => formatDateTransform(String(input), args)
    });
  }
}

function formatDateTransform(input: string, args: unknown[]): JsonScalar {
  const format = typeof args[0] === "string" ? args[0] : "yyyy-MM-dd";
  const result = formatDateValue(input, format);
  if (!result.valid) {
    if (typeof console !== "undefined") {
      console.warn(`[hytde] date transform failed for "${input}".`);
    }
    return "";
  }
  return result.value;
}

function formatDateValue(input: string, format: string): { value: string; valid: boolean } {
  if (!input) {
    return { value: "", valid: false };
  }
  const isDigits = /^[0-9]+$/.test(input);
  const date = isDigits ? new Date(Number(input)) : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return { value: "", valid: false };
  }

  const pad2 = (value: number) => String(value).padStart(2, "0");
  const pad4 = (value: number) => String(value).padStart(4, "0");
  const replacements: Record<string, string> = {
    yyyy: pad4(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    dd: pad2(date.getDate()),
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds())
  };

  const value = format.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => replacements[token] ?? token);
  return { value, valid: true };
}

function logTransformRegistrationError(message: string): void {
  if (typeof console !== "undefined") {
    console.error(`[hytde] ${message}`);
  }
}

function getTransformRegistry(hy: Record<string, unknown>): Map<string, TransformDefinition> {
  const existing = hy[TRANSFORM_REGISTRY_KEY];
  if (existing instanceof Map) {
    return existing;
  }
  const registry = new Map<string, TransformDefinition>();
  hy[TRANSFORM_REGISTRY_KEY] = registry;
  return registry;
}

function isJsonScalar(value: unknown): value is JsonScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function matchesInputType(value: unknown, inputType: JsonScalarType): value is JsonScalar {
  if (inputType === "null") {
    return value === null;
  }
  return typeof value === inputType;
}

function removeDummyNodes(nodes: Element[]): void {
  for (const node of nodes) {
    node.remove();
  }
}

async function bootstrapRuntime(state: RuntimeState): Promise<void> {
  setupFormHandlers(state);
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

function setupFormHandlers(state: RuntimeState): void {
  const formTargets = new Map<HTMLFormElement, ParsedRequestTarget>();
  const submitterTargets = new Map<Element, ParsedRequestTarget>();
  const submitterForms = new Set<HTMLFormElement>();

  for (const target of state.parsed.requestTargets) {
    if (target.trigger !== "submit" || !target.form) {
      continue;
    }
    if (target.isForm) {
      formTargets.set(target.form, target);
    } else {
      submitterTargets.set(target.element, target);
      submitterForms.add(target.form);
    }
  }

  state.formTargets = formTargets;
  state.submitterTargets = submitterTargets;

  const forms = new Set<HTMLFormElement>([...formTargets.keys(), ...submitterForms]);
  for (const form of forms) {
    if (state.formListeners.has(form)) {
      continue;
    }
    state.formListeners.add(form);
    form.addEventListener("submit", (event) => {
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (state.inFlightForms.has(form)) {
        emitLog(state, {
          type: "info",
          message: "submit:skip",
          detail: { reason: "in-flight", formId: form.id || undefined },
          timestamp: Date.now()
        });
        return;
      }
      const submitter = (event as SubmitEvent).submitter ?? null;
      const submitTarget = submitter ? submitterTargets.get(submitter) : null;
      const resolved = submitTarget ?? formTargets.get(form) ?? null;
      if (!resolved) {
        return;
      }
      event.preventDefault();
      void handleRequest(resolved, state);
    });
  }
}

function setupFormStateHandlers(state: RuntimeState): void {
  const forms = Array.from(state.doc.querySelectorAll<HTMLFormElement>("form"));
  for (const form of forms) {
    if (state.formStateContexts.has(form)) {
      continue;
    }
    const ownerResult = resolveFormStateOwner(form, state);
    if (!ownerResult) {
      continue;
    }
    let { owner, declaration } = ownerResult;
    let mode: FormStateMode = declaration.mode;
    if (mode === "off") {
      continue;
    }
    if (!formHasSubmitTarget(form, state)) {
      emitFormStateError(state, "hy-form-state requires a form submit request (hy-get/hy-post/etc).", {
        formId: form.id || undefined,
        ownerId: owner.id || undefined
      });
      continue;
    }
    if (hasActionInputRequest(form, state)) {
      emitFormStateError(state, "hy-form-state cannot be used with action-triggered input requests.", {
        formId: form.id || undefined,
        ownerId: owner.id || undefined
      });
      continue;
    }

    let autosaveEnabled = mode === "autosave" || mode === "autosave-guard";
    const ownerId = owner.id?.trim() ? owner.id.trim() : null;
    if (autosaveEnabled && !ownerId) {
      emitFormStateError(state, "hy-form-state autosave requires an id on the owner element.", {
        formId: form.id || undefined
      });
      autosaveEnabled = false;
      if (mode === "autosave-guard") {
        mode = "guard";
      } else if (mode === "autosave") {
        continue;
      }
    }

    if (autosaveEnabled && !getFormStateStorage(state, form)) {
      emitFormStateError(state, "hy-form-state autosave requires localStorage access.", {
        formId: form.id || undefined,
        ownerId: ownerId || undefined
      });
      autosaveEnabled = false;
      if (mode === "autosave-guard") {
        mode = "guard";
      } else if (mode === "autosave") {
        continue;
      }
    }

    const context: FormStateContext = {
      form,
      owner,
      ownerId,
      mode,
      autosaveDelayMs: autosaveEnabled ? declaration.durationMs : 0,
      autosaveEnabled,
      dirty: false,
      hasDraft: false,
      lastCommittedJson: null,
      autosaveTimer: null,
      fileWarningEmitted: false
    };

    state.formStateContexts.set(form, context);
    if (!state.formStateListeners.has(form)) {
      state.formStateListeners.add(form);
      form.addEventListener("input", (event) => handleFormStateInput(event, context, state));
      form.addEventListener("change", (event) => handleFormStateInput(event, context, state));
    }
    initializeFormStateContext(context, state);
  }

  setupFormStateNavigationHandlers(state);
}

function resolveFormStateOwner(
  form: HTMLFormElement,
  state: RuntimeState
): { owner: HTMLElement; declaration: FormStateDeclaration } | null {
  const formDeclaration = parseFormStateDeclaration(form, state);
  if (formDeclaration) {
    return { owner: form, declaration: formDeclaration };
  }

  const submitters = Array.from(form.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")).filter(
    (element) => isSubmitActionElement(element) && element.hasAttribute("hy-form-state")
  );

  if (submitters.length === 0) {
    return null;
  }
  if (submitters.length > 1) {
    emitFormStateError(state, "Multiple submit action elements define hy-form-state; choose one owner.", {
      formId: form.id || undefined,
      ownerIds: submitters.map((element) => element.id).filter(Boolean)
    });
    return null;
  }

  const owner = submitters[0];
  const declaration = parseFormStateDeclaration(owner, state);
  if (!declaration) {
    return null;
  }
  return { owner, declaration };
}

function parseFormStateDeclaration(element: Element, state: RuntimeState): FormStateDeclaration | null {
  const raw = element.getAttribute("hy-form-state");
  if (raw === null) {
    return null;
  }
  if (raw.trim() === "") {
    emitFormStateError(state, "hy-form-state requires a declaration string.", {
      elementId: (element as HTMLElement).id || undefined
    });
    return { mode: "off", durationMs: DEFAULT_AUTOSAVE_DELAY_MS, raw };
  }

  let mode: FormStateMode | null = null;
  let durationMs = DEFAULT_AUTOSAVE_DELAY_MS;
  const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);

  for (const part of parts) {
    const splitIndex = part.indexOf(":");
    if (splitIndex === -1) {
      emitFormStateError(state, "hy-form-state entries must be in `key: value` form.", {
        elementId: (element as HTMLElement).id || undefined,
        entry: part
      });
      continue;
    }
    const key = part.slice(0, splitIndex).trim().toLowerCase();
    const value = part.slice(splitIndex + 1).trim();
    if (key === "mode") {
      if (value === "autosave-guard" || value === "autosave" || value === "guard" || value === "off") {
        mode = value;
      } else {
        emitFormStateError(state, "hy-form-state mode must be autosave-guard/autosave/guard/off.", {
          elementId: (element as HTMLElement).id || undefined,
          value
        });
        mode = "off";
      }
      continue;
    }
    if (key === "duration") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        emitFormStateError(state, "hy-form-state duration must be a non-negative number.", {
          elementId: (element as HTMLElement).id || undefined,
          value
        });
      } else {
        durationMs = parsed;
      }
      continue;
    }
    emitFormStateError(state, "hy-form-state contains an unknown key.", {
      elementId: (element as HTMLElement).id || undefined,
      key
    });
  }

  if (!mode) {
    emitFormStateError(state, "hy-form-state requires a mode key.", {
      elementId: (element as HTMLElement).id || undefined
    });
    mode = "off";
  }

  return { mode, durationMs, raw };
}

function isSubmitActionElement(element: Element): element is HTMLButtonElement | HTMLInputElement {
  if (element instanceof HTMLButtonElement) {
    return element.type === "submit";
  }
  if (element instanceof HTMLInputElement) {
    return element.type === "submit" || element.type === "image";
  }
  return false;
}

function formHasSubmitTarget(form: HTMLFormElement, state: RuntimeState): boolean {
  return state.parsed.requestTargets.some((target) => target.trigger === "submit" && target.form === form);
}

function hasActionInputRequest(form: HTMLFormElement, state: RuntimeState): boolean {
  return state.parsed.requestTargets.some(
    (target) =>
      target.trigger === "action" &&
      target.form === form &&
      (target.element instanceof HTMLInputElement ||
        target.element instanceof HTMLSelectElement ||
        target.element instanceof HTMLTextAreaElement)
  );
}

function handleFormStateInput(event: Event, context: FormStateContext, state: RuntimeState): void {
  if (!isFormControl(event.target)) {
    return;
  }
  context.dirty = true;
  scheduleFormStateSnapshot(context, state);
}

function scheduleFormStateSnapshot(context: FormStateContext, state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  if (context.autosaveTimer) {
    view.clearTimeout(context.autosaveTimer);
    context.autosaveTimer = null;
  }
  const delay = context.autosaveEnabled ? context.autosaveDelayMs : 0;
  if (delay === 0) {
    applyFormStateSnapshot(context, state);
    return;
  }
  context.autosaveTimer = view.setTimeout(() => {
    context.autosaveTimer = null;
    applyFormStateSnapshot(context, state);
  }, delay);
}

function applyFormStateSnapshot(context: FormStateContext, state: RuntimeState): void {
  const snapshot = buildFormStateSnapshot(context, state);
  if (!snapshot) {
    return;
  }
  context.dirty = context.lastCommittedJson ? snapshot.json !== context.lastCommittedJson : true;
  if (context.autosaveEnabled) {
    if (!context.ownerId) {
      return;
    }
    const storage = getFormStateStorage(state, context.form);
    if (!storage) {
      return;
    }
    const payload = JSON.stringify({ savedAt: new Date().toISOString(), data: snapshot.data });
    storage.setItem(getFormStateStorageKey(context, state), payload);
    context.hasDraft = true;
    emitLog(state, {
      type: "info",
      message: "form-state:autosave",
      detail: { key: getFormStateStorageKey(context, state), size: payload.length },
      timestamp: Date.now()
    });
  }
}

function buildFormStateSnapshot(
  context: FormStateContext,
  state: RuntimeState
): { data: Record<string, unknown>; json: string } | null {
  const entries = collectFormValues(context.form);
  const filtered: FormEntry[] = [];
  let hasFile = false;
  for (const entry of entries) {
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    const containsFile = values.some((value) => value instanceof File);
    if (containsFile) {
      hasFile = true;
      continue;
    }
    filtered.push(entry);
  }

  if (hasFile && !context.fileWarningEmitted) {
    context.fileWarningEmitted = true;
    emitFormStateError(state, "File inputs are excluded from hy-form-state autosave.", {
      formId: context.form.id || undefined,
      ownerId: context.ownerId || undefined
    });
  }

  const data = formEntriesToPayload(filtered);
  try {
    const json = JSON.stringify(data);
    return { data, json };
  } catch (error) {
    emitFormStateError(state, "Failed to serialize form state for autosave.", {
      formId: context.form.id || undefined
    });
    return null;
  }
}

function initializeFormStateContext(context: FormStateContext, state: RuntimeState): void {
  const initialSnapshot = buildFormStateSnapshot(context, state);
  context.lastCommittedJson = initialSnapshot ? initialSnapshot.json : null;
  context.dirty = false;

  if (!context.autosaveEnabled || !context.ownerId) {
    return;
  }
  const storage = getFormStateStorage(state, context.form);
  if (!storage) {
    return;
  }
  const key = getFormStateStorageKey(context, state);
  const raw = storage.getItem(key);
  if (!raw) {
    return;
  }
  context.hasDraft = true;
  const parsed = safeParseFormStateDraft(raw, context, state);
  if (!parsed) {
    return;
  }
  const label = formatLocalTimestamp(parsed.savedAt);
  const message = `${label} に送信せずに入力された値があります。復元しますか？`;
  const view = state.doc.defaultView;
  const confirmed = view ? view.confirm(message) : false;
  emitLog(state, {
    type: "info",
    message: "form-state:restore",
    detail: { key, accepted: confirmed },
    timestamp: Date.now()
  });
  if (!confirmed) {
    return;
  }
  fillForm(context.form, parsed.data);
  const restoredSnapshot = buildFormStateSnapshot(context, state);
  context.lastCommittedJson = restoredSnapshot ? restoredSnapshot.json : context.lastCommittedJson;
  context.dirty = false;
}

function safeParseFormStateDraft(
  raw: string,
  context: FormStateContext,
  state: RuntimeState
): { savedAt: string; data: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(raw) as { savedAt?: string; data?: unknown };
    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid");
    }
    if (typeof parsed.savedAt !== "string" || !parsed.data || typeof parsed.data !== "object") {
      throw new Error("invalid");
    }
    return { savedAt: parsed.savedAt, data: parsed.data as Record<string, unknown> };
  } catch (error) {
    emitFormStateError(state, "Invalid autosave draft payload.", {
      formId: context.form.id || undefined,
      ownerId: context.ownerId || undefined
    });
    return null;
  }
}

function formatLocalTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "????-??-?? ??:??";
  }
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function getFormStateStorageKey(context: FormStateContext, state: RuntimeState): string {
  const pathname = state.doc.defaultView?.location?.pathname ?? "";
  return `${pathname}:${context.ownerId ?? ""}`;
}

function getFormStateStorage(state: RuntimeState, form: HTMLFormElement): Storage | null {
  try {
    return state.doc.defaultView?.localStorage ?? null;
  } catch (error) {
    emitFormStateError(state, "localStorage access failed for hy-form-state.", {
      formId: form.id || undefined
    });
    return null;
  }
}

function setupFormStateNavigationHandlers(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view || state.formStateNavListenerAttached) {
    return;
  }
  state.formStateNavListenerAttached = true;
  state.doc.addEventListener("click", (event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) {
      return;
    }
    if (anchor.hasAttribute("download")) {
      return;
    }
    if (anchor.target && anchor.target !== "_self") {
      return;
    }
    if (!shouldPromptLeave(state)) {
      return;
    }
    const message = getFormStateLeaveMessage();
    const confirmed = view.confirm(message);
    if (!confirmed) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

function shouldPromptLeave(state: RuntimeState): boolean {
  for (const context of state.formStateContexts.values()) {
    if ((context.mode === "guard" || context.mode === "autosave-guard") && context.dirty) {
      return true;
    }
  }
  return false;
}

function getFormStateLeaveMessage(): string {
  return "入力内容が未送信です。移動しますか？";
}

function emitFormStateError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("syntax", message, detail));
  if (typeof console !== "undefined") {
    console.error("[hytde] form-state error", message, detail);
  }
}

function clearFormStateOnRequest(target: ParsedRequestTarget, state: RuntimeState): void {
  const form = target.form;
  if (!form) {
    return;
  }
  const context = state.formStateContexts.get(form);
  if (!context) {
    return;
  }
  const view = state.doc.defaultView;
  if (context.autosaveTimer && view) {
    view.clearTimeout(context.autosaveTimer);
    context.autosaveTimer = null;
  }
  const snapshot = buildFormStateSnapshot(context, state);
  if (snapshot) {
    context.lastCommittedJson = snapshot.json;
  }
  context.dirty = false;

  if (!context.autosaveEnabled || !context.ownerId) {
    return;
  }
  const storage = getFormStateStorage(state, form);
  if (!storage) {
    return;
  }
  const key = getFormStateStorageKey(context, state);
  storage.removeItem(key);
  context.hasDraft = false;
  emitLog(state, {
    type: "info",
    message: "form-state:clear",
    detail: { key },
    timestamp: Date.now()
  });
}

function setupActionHandlers(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }

  for (const target of state.parsed.requestTargets) {
    if (target.trigger !== "action") {
      continue;
    }
    const element = target.element;
    if (state.actionListeners.has(element)) {
      continue;
    }
    state.actionListeners.add(element);

    if (element instanceof HTMLButtonElement) {
      element.addEventListener("click", (event) => {
        if (state.actionCommandSkip.has(element)) {
          return;
        }
        const selector = getFillSelectorFromTarget(target);
        if (selector) {
          emitLog(state, {
            type: "info",
            message: "fill:trigger",
            detail: { selector, elementId: element.id || undefined },
            timestamp: Date.now()
          });
        }
        applyFillActionIfNeeded(target, state);
        event.preventDefault();
        event.stopPropagation();
        void handleActionRequest(target, state);
      });

      if (target.method === "GET") {
        element.addEventListener("pointerenter", () => {
          void prefetchActionRequest(target, state);
        });
      }
      continue;
    }

    if (element instanceof HTMLInputElement) {
      element.addEventListener("input", () => {
        scheduleActionRequest(target, state);
      });
      element.addEventListener("change", () => {
        applyFillActionIfNeeded(target, state);
      });
      continue;
    }

    if (element instanceof HTMLTextAreaElement) {
      element.addEventListener("input", () => {
        scheduleActionRequest(target, state);
      });
      element.addEventListener("change", () => {
        applyFillActionIfNeeded(target, state);
      });
      continue;
    }

    if (element instanceof HTMLSelectElement) {
      element.addEventListener("change", () => {
        applyFillActionIfNeeded(target, state);
        if (state.cascade.actionSkip.has(element)) {
          state.cascade.actionSkip.delete(element);
          return;
        }
        scheduleActionRequest(target, state);
      });
    }
  }
}

function setupFillActionHandlers(state: RuntimeState, actions: ParsedFillAction[]): void {
  for (const action of actions) {
    const element = action.element as HTMLElement;
    if (state.actionListeners.has(element)) {
      continue;
    }
    if (state.fillActionListeners.has(element)) {
      continue;
    }
    state.fillActionListeners.add(element);
    state.fillActionData.set(element, action);
    element.addEventListener("click", (event) => {
      if (state.actionCommandSkip.has(element)) {
        return;
      }
      const selector = getFillSelectorFromElement(element, state);
      emitLog(state, {
        type: "info",
        message: "fill:trigger",
        detail: { selector: selector ?? undefined, elementId: element.id || undefined },
        timestamp: Date.now()
      });
      applyFillActionFromElement(element, state);
      event.preventDefault();
      event.stopPropagation();
    });
  }
}

function scheduleActionRequest(target: ParsedRequestTarget, state: RuntimeState): void {
  const element = target.element;
  const debounceMs = getDebounceMsForElement(element);
  if (!debounceMs) {
    void handleActionRequest(target, state);
    return;
  }
  const view = state.doc.defaultView;
  if (!view) {
    void handleActionRequest(target, state);
    return;
  }
  const existing = state.actionDebounceTimers.get(element);
  if (existing) {
    view.clearTimeout(existing);
  }
  const timer = view.setTimeout(() => {
    state.actionDebounceTimers.delete(element);
    void handleActionRequest(target, state);
  }, debounceMs);
  state.actionDebounceTimers.set(element, timer);
}

function applyFillActionIfNeeded(target: ParsedRequestTarget, state: RuntimeState): void {
  const selectorRaw = target.fillTarget;
  if (selectorRaw === null) {
    return;
  }
  applyFillAction(
    selectorRaw,
    target.form ?? (target.element.closest("form") as HTMLFormElement | null),
    target.element,
    state,
    target.fillValue
  );
}

function applyFillActionFromElement(element: Element, state: RuntimeState): void {
  const data = state.fillActionData.get(element);
  const selectorRaw = data?.selector ?? element.getAttribute("hy-fill");
  if (selectorRaw === null || selectorRaw === undefined) {
    return;
  }
  applyFillAction(
    selectorRaw,
    data?.form ?? (element.closest("form") as HTMLFormElement | null),
    element,
    state,
    data?.value ?? element.getAttribute("hy-value")
  );
}

function applyFillAction(
  selectorRaw: string,
  form: HTMLFormElement | null,
  element: Element,
  state: RuntimeState,
  explicitValue: string | null
): void {
  const selector = selectorRaw.trim();
  if (!selector) {
    emitFillError(state, "hy-fill requires a non-empty selector.", {
      elementId: (element as HTMLElement).id || undefined
    });
    return;
  }
  const root: ParentNode = form ?? element.ownerDocument;
  let matches: Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  try {
    matches = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector));
  } catch (error) {
    emitFillError(state, "hy-fill selector is invalid.", {
      selector,
      formId: form?.id || undefined,
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
  if (matches.length === 0) {
    emitFillError(state, "hy-fill selector did not match any control.", {
      selector,
      formId: form?.id || undefined
    });
    return;
  }
  if (matches.length > 1) {
    emitFillError(state, "hy-fill selector matched multiple controls.", {
      selector,
      formId: form?.id || undefined
    });
    return;
  }
  const control = matches[0];
  if (!isFormControl(control)) {
    emitFillError(state, "hy-fill target is not a form control.", {
      selector,
      formId: form?.id || undefined
    });
    return;
  }
  const value = resolveFillValue(element, explicitValue);
  applyFillValue(control, value);
  emitLog(state, {
    type: "info",
    message: "fill:apply",
    detail: {
      selector,
      value,
      formId: form?.id || undefined,
      targetName: control.name || undefined
    },
    timestamp: Date.now()
  });
  triggerFillCommand(element, state);
}

function resolveFillValue(element: Element, explicitValue: string | null): string {
  if (explicitValue != null) {
    return explicitValue;
  }
  if (element instanceof HTMLInputElement) {
    return element.value ?? "";
  }
  return element.textContent?.trim() ?? "";
}

function applyFillValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string
): void {
  if (control instanceof HTMLInputElement) {
    const type = control.type;
    if (type === "checkbox") {
      control.checked = control.value === value;
      return;
    }
    if (type === "radio") {
      control.checked = control.value === value;
      return;
    }
    control.value = value;
    return;
  }
  if (control instanceof HTMLSelectElement) {
    const options = Array.from(control.options);
    const match = options.find((option) => option.value === value) ?? null;
    if (match) {
      control.value = match.value;
    } else {
      control.value = value;
    }
    return;
  }
  control.value = value;
}

function emitFillError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("syntax", message, detail));
  if (typeof console !== "undefined") {
    console.error("[hytde] fill error", message, detail);
  }
}

function getFillSelectorFromElement(element: Element, state: RuntimeState): string | null {
  const data = state.fillActionData.get(element);
  const raw = data?.selector ?? element.getAttribute("hy-fill");
  if (raw === null || raw === undefined) {
    return null;
  }
  const selector = raw.trim();
  if (!selector) {
    return null;
  }
  return selector;
}

function getFillSelectorFromTarget(target: ParsedRequestTarget): string | null {
  const raw = target.fillTarget;
  if (raw === null) {
    return null;
  }
  const selector = raw.trim();
  if (!selector) {
    return null;
  }
  return selector;
}

function triggerFillCommand(element: Element, state: RuntimeState): void {
  const data = state.fillActionData.get(element);
  const command = data?.command ?? element.getAttribute("command");
  const commandFor = data?.commandFor ?? element.getAttribute("commandfor");
  if (!command || !commandFor) {
    return;
  }
  const doc = element.ownerDocument;
  if (!doc) {
    return;
  }
  const root = doc.body ?? doc.documentElement ?? element.parentNode;
  if (!root) {
    return;
  }
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("command", command);
  button.setAttribute("commandfor", commandFor);
  root.appendChild(button);
  button.click();
  button.remove();
}

function getDebounceMsForElement(element: Element): number | null {
  const raw = element.getAttribute("hy-debounce");
  if (raw === null) {
    return null;
  }
  if (raw.trim() === "") {
    return 200;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 200;
  }
  return parsed;
}

function setupAutoSubmitHandlers(state: RuntimeState): void {
  const forms = Array.from(state.doc.querySelectorAll<HTMLFormElement>("form[hy-submit-on]"));
  for (const form of forms) {
    if (state.autoSubmitListeners.has(form)) {
      continue;
    }
    const submitEvents = parseSubmitEvents(form);
    if (submitEvents.length === 0) {
      continue;
    }

    state.autoSubmitListeners.add(form);
    const autoState = getAutoSubmitState(form, state);

    const handleSubmitEvent = (event: Event) => {
      if (!isFormControl(event.target)) {
        return;
      }
      if (autoState.composing) {
        autoState.pendingComposition = true;
        emitLog(state, {
          type: "info",
          message: "auto-submit:skip",
          detail: { reason: "composition", formId: form.id || undefined },
          timestamp: Date.now()
        });
        return;
      }
      scheduleAutoSubmit(form, state, event.type);
    };

    for (const eventName of submitEvents) {
      form.addEventListener(eventName, handleSubmitEvent);
    }

    form.addEventListener("compositionstart", (event) => {
      if (!isFormControl(event.target)) {
        return;
      }
      autoState.composing = true;
    });

    form.addEventListener("compositionend", (event) => {
      if (!isFormControl(event.target)) {
        return;
      }
      autoState.composing = false;
      if (getSubmitComposeMode(form) === "end" && autoState.pendingComposition) {
        autoState.pendingComposition = false;
        scheduleAutoSubmit(form, state, "compositionend");
      }
    });

    form.addEventListener("focusout", (event) => {
      if (!isFormControl(event.target)) {
        return;
      }
      if (getSubmitComposeMode(form) === "blur" && autoState.pendingComposition && !autoState.composing) {
        autoState.pendingComposition = false;
        scheduleAutoSubmit(form, state, "compositionblur");
      }
    });
  }
}

function setupHistoryHandlers(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view || state.historyListenerAttached) {
    return;
  }
  state.historyListenerAttached = true;
  view.addEventListener("popstate", () => {
    emitLog(state, {
      type: "info",
      message: "history:pop",
      timestamp: Date.now()
    });
    refreshHyParams(state);
    applyHistoryToForms(state, "popstate");
  });
}

function setupNavigationHandlers(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view || state.navListenerAttached) {
    return;
  }
  state.navListenerAttached = true;
  state.doc.addEventListener("click", (event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    if (state.pathMeta.mode !== "hash") {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) {
      return;
    }
    if (anchor.hasAttribute("download")) {
      return;
    }
    if (anchor.target && anchor.target !== "_self") {
      return;
    }
    const fallback = anchor.getAttribute(NAV_FALLBACK_ATTR);
    const href = anchor.getAttribute("href");
    if (!fallback || !href) {
      return;
    }
    const canonicalUrl = resolveNavigationUrl(href, state.doc);
    const fallbackUrl = resolveNavigationUrl(fallback, state.doc);
    if (!canonicalUrl || !fallbackUrl) {
      return;
    }
    if (canonicalUrl.origin !== view.location.origin || fallbackUrl.origin !== view.location.origin) {
      return;
    }
    event.preventDefault();
    void navigateWithHashFallback(canonicalUrl.toString(), fallbackUrl.toString(), view);
  });
}

function hasHistoryAutoSubmit(state: RuntimeState): boolean {
  const forms = getHistoryForms(state);
  for (const form of forms) {
    const mode = getHistoryMode(form);
    if (!mode) {
      continue;
    }
    const params = getHistoryParams(form, state);
    if (hasHistoryParams(form, params)) {
      return true;
    }
  }
  return false;
}

async function runHistoryAutoSubmits(state: RuntimeState): Promise<void> {
  refreshHyParams(state);
  const forms = getHistoryForms(state);
  const requests: Promise<unknown>[] = [];

  for (const form of forms) {
    const mode = getHistoryMode(form);
    if (!mode) {
      continue;
    }
    const params = getHistoryParams(form, state);
    const applied = applyHistoryParamsToForm(form, params);
    emitLog(state, {
      type: "info",
      message: "history:apply",
      detail: {
        mode,
        source: getHistoryParamSource(form),
        formId: form.id || undefined
      },
      timestamp: Date.now()
    });

    if (applied) {
      const target = state.formTargets.get(form) ?? null;
      if (!target) {
        emitLog(state, {
          type: "info",
          message: "auto-submit:skip",
          detail: { reason: "no-target", formId: form.id || undefined },
          timestamp: Date.now()
        });
        continue;
      }
      emitLog(state, {
        type: "info",
        message: "auto-submit:trigger",
        detail: { reason: "history", formId: form.id || undefined },
        timestamp: Date.now()
      });
      requests.push(handleRequest(target, state));
    }
  }

  await Promise.all(requests);
}

function applyHistoryToForms(state: RuntimeState, reason: "popstate"): void {
  const forms = getHistoryForms(state);
  for (const form of forms) {
    const mode = getHistoryMode(form);
    if (!mode) {
      continue;
    }
    const params = getHistoryParams(form, state);
    const applied = applyHistoryParamsToForm(form, params);
    emitLog(state, {
      type: "info",
      message: "history:apply",
      detail: {
        mode,
        source: getHistoryParamSource(form),
        reason,
        formId: form.id || undefined
      },
      timestamp: Date.now()
    });
    if (!applied) {
      continue;
    }
    const target = state.formTargets.get(form) ?? null;
    if (!target) {
      emitLog(state, {
        type: "info",
        message: "auto-submit:skip",
        detail: { reason: "no-target", formId: form.id || undefined },
        timestamp: Date.now()
      });
      continue;
    }
    emitLog(state, {
      type: "info",
      message: "auto-submit:trigger",
      detail: { reason: "history", formId: form.id || undefined },
      timestamp: Date.now()
    });
    void handleRequest(target, state);
  }
}

function getHistoryForms(state: RuntimeState): HTMLFormElement[] {
  return Array.from(state.doc.querySelectorAll<HTMLFormElement>("form[hy-history]"));
}

function getHistoryMode(form: HTMLFormElement): "sync" | "sync-push" | "sync-replace" | null {
  const raw = form.getAttribute("hy-history")?.trim();
  if (!raw) {
    return null;
  }
  if (raw === "sync" || raw === "sync-push" || raw === "sync-replace") {
    return raw;
  }
  if (raw === "push") {
    return "sync-push";
  }
  if (raw === "replace") {
    return "sync-replace";
  }
  return null;
}

function getHistoryParamSource(form: HTMLFormElement): "search" | "hash" {
  return form.getAttribute("hy-history-params") === "hash" ? "hash" : "search";
}

function getHistoryParams(form: HTMLFormElement, state: RuntimeState): URLSearchParams {
  const view = state.doc.defaultView;
  if (!view) {
    return new URLSearchParams();
  }
  const source = getHistoryParamSource(form);
  if (source === "hash") {
    return new URLSearchParams(view.location.hash.replace(/^#/, ""));
  }
  return new URLSearchParams(view.location.search.replace(/^\?/, ""));
}

function getHistoryFieldNames(form: HTMLFormElement): Set<string> | null {
  const raw = form.getAttribute("hy-history-fields");
  if (!raw) {
    return null;
  }
  const names = raw.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

function hasHistoryParams(form: HTMLFormElement, params: URLSearchParams): boolean {
  const fieldNames = getHistoryFieldNames(form);
  if (!fieldNames) {
    return params.toString().length > 0;
  }
  for (const name of fieldNames) {
    if (params.has(name)) {
      return true;
    }
  }
  return false;
}

function applyHistoryParamsToForm(form: HTMLFormElement, params: URLSearchParams): boolean {
  const controls = getHistoryControls(form);
  let hasAny = false;

  for (const control of controls) {
    if (control.disabled || !control.name) {
      continue;
    }
    const values = params.getAll(control.name);
    if (values.length > 0) {
      hasAny = true;
    }
    applyHistoryValueToControl(control, values);
  }

  return hasAny;
}

function getHistoryControls(
  form: HTMLFormElement
): Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> {
  const fieldNames = getHistoryFieldNames(form);
  const controls = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input[name], select[name], textarea[name]"
    )
  );
  if (!fieldNames) {
    return controls;
  }
  return controls.filter((control) => fieldNames.has(control.name));
}

function applyHistoryValueToControl(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  values: string[]
): void {
  if (control instanceof HTMLInputElement) {
    const type = control.type;
    if (type === "file") {
      return;
    }
    if (type === "checkbox") {
      const hasValue = control.hasAttribute("value");
      if (hasValue) {
        control.checked = values.includes(control.value);
      } else {
        const raw = values[0] ?? "";
        control.checked = raw !== "" && raw !== "false" && raw !== "0";
      }
      return;
    }
    if (type === "radio") {
      control.checked = values[0] === control.value;
      return;
    }
  }

  if (control instanceof HTMLSelectElement && control.multiple) {
    const set = new Set(values);
    for (const option of Array.from(control.options)) {
      option.selected = set.has(option.value);
    }
    return;
  }

  control.value = values[0] ?? "";
}

function parseSubmitEvents(form: HTMLFormElement): string[] {
  const raw = form.getAttribute("hy-submit-on");
  if (raw == null) {
    return [];
  }
  const tokens = raw.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : ["change"];
}

function getDebounceMs(form: HTMLFormElement): number {
  const raw = form.getAttribute("hy-debounce");
  if (!raw) {
    return 200;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 200;
  }
  return parsed;
}

function getSubmitComposeMode(form: HTMLFormElement): "end" | "blur" {
  const raw = form.getAttribute("hy-submit-compose");
  return raw === "blur" ? "blur" : "end";
}

function getAutoSubmitState(form: HTMLFormElement, state: RuntimeState): AutoSubmitState {
  const existing = state.autoSubmitState.get(form);
  if (existing) {
    return existing;
  }
  const created: AutoSubmitState = { timer: null, composing: false, pendingComposition: false };
  state.autoSubmitState.set(form, created);
  return created;
}

function scheduleAutoSubmit(form: HTMLFormElement, state: RuntimeState, reason: string): void {
  if (state.inFlightForms.has(form)) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "in-flight", formId: form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }
  if (!form.checkValidity()) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "invalid", formId: form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }
  const target = state.formTargets.get(form) ?? null;
  if (!target) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "no-target", formId: form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }
  const autoState = getAutoSubmitState(form, state);
  const debounceMs = getDebounceMs(form);
  if (autoState.timer) {
    clearTimeout(autoState.timer);
    emitLog(state, {
      type: "info",
      message: "auto-submit:debounce",
      detail: { reason, formId: form.id || undefined, debounceMs },
      timestamp: Date.now()
    });
  }
  const view = state.doc.defaultView;
  autoState.timer = view ? view.setTimeout(() => {
    autoState.timer = null;
    emitLog(state, {
      type: "info",
      message: "auto-submit:trigger",
      detail: { reason, formId: form.id || undefined },
      timestamp: Date.now()
    });
    void handleRequest(target, state);
  }, debounceMs) : null;
}

function isFormControl(target: EventTarget | null): target is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

function refreshHyParams(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  syncHyPathParams(state);
}

function maybeUpdateHistoryOnSubmit(target: ParsedRequestTarget, state: RuntimeState): void {
  if (!target.form) {
    return;
  }
  const mode = getHistoryMode(target.form);
  if (!mode || mode === "sync") {
    return;
  }
  if (target.method !== "GET") {
    emitLog(state, {
      type: "info",
      message: "history:skip",
      detail: { reason: "non-get", formId: target.form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }

  updateHistoryFromForm(target.form, mode, state);
}

function updateHistoryFromForm(
  form: HTMLFormElement,
  mode: "sync-push" | "sync-replace",
  state: RuntimeState
): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  const params = buildHistoryParams(form);
  const url = new URL(view.location.href);
  const source = getHistoryParamSource(form);
  const serialized = params.toString();
  if (source === "hash") {
    url.hash = serialized;
  } else {
    url.search = serialized;
  }

  if (mode === "sync-push") {
    view.history.pushState({}, "", url.toString());
    emitLog(state, {
      type: "info",
      message: "history:push",
      detail: { source, url: url.toString(), formId: form.id || undefined },
      timestamp: Date.now()
    });
  } else {
    view.history.replaceState({}, "", url.toString());
    emitLog(state, {
      type: "info",
      message: "history:replace",
      detail: { source, url: url.toString(), formId: form.id || undefined },
      timestamp: Date.now()
    });
  }

  refreshHyParams(state);
}

function buildHistoryParams(form: HTMLFormElement): URLSearchParams {
  const params = new URLSearchParams();
  const controls = getHistoryControls(form);
  for (const control of controls) {
    if (control.disabled || !control.name) {
      continue;
    }
    if (control instanceof HTMLInputElement) {
      const type = control.type;
      if (type === "submit" || type === "button" || type === "reset" || type === "file") {
        continue;
      }
      if (type === "checkbox") {
        const hasValue = control.hasAttribute("value");
        if (hasValue) {
          if (control.checked) {
            params.append(control.name, control.value);
          }
        } else if (control.checked) {
          params.append(control.name, "true");
        }
        continue;
      }
      if (type === "radio") {
        if (control.checked) {
          params.append(control.name, control.value);
        }
        continue;
      }
    }

    if (control instanceof HTMLSelectElement && control.multiple) {
      const values = Array.from(control.selectedOptions).map((option) => option.value).filter(Boolean);
      for (const value of values) {
        params.append(control.name, value);
      }
      continue;
    }

    if (control.value !== "") {
      params.append(control.name, control.value);
    }
  }

  return params;
}

function maybeRedirectAfterSubmit(target: ParsedRequestTarget, _payload: unknown, state: RuntimeState): void {
  if (target.method === "GET") {
    return;
  }
  const redirectAttr = getRedirectAttribute(target);
  if (!redirectAttr) {
    return;
  }
  const scope = buildScopeStack(target.element, state);
  const resolved = resolveUrlTemplate(redirectAttr, scope, state, { urlEncodeTokens: true, context: "nav" });
  if (!resolved.value) {
    return;
  }
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  const canonicalUrl = resolveNavigationUrl(resolved.value, state.doc);
  if (!canonicalUrl) {
    recordRedirectError(state, resolved.value, "Invalid redirect URL.");
    return;
  }
  if (canonicalUrl.origin !== view.location.origin) {
    recordRedirectError(state, canonicalUrl.toString(), "Cross-origin redirect is blocked.");
    return;
  }
  const fallbackUrl = resolved.navFallback ? resolveNavigationUrl(resolved.navFallback, state.doc) : null;
  if (fallbackUrl && fallbackUrl.origin !== view.location.origin) {
    recordRedirectError(state, fallbackUrl.toString(), "Cross-origin redirect is blocked.");
    return;
  }

  emitLog(state, {
    type: "info",
    message: "redirect:navigate",
    detail: { url: canonicalUrl.toString(), formId: target.form?.id || undefined },
    timestamp: Date.now()
  });
  if (state.pathMeta.mode === "hash" && fallbackUrl) {
    void navigateWithHashFallback(canonicalUrl.toString(), fallbackUrl.toString(), view);
    return;
  }
  view.location.assign(canonicalUrl.toString());
}

function resolveNavigationUrl(urlString: string, doc: Document): URL | null {
  const base = doc.baseURI ?? doc.defaultView?.location?.href ?? "";
  try {
    return new URL(urlString, base);
  } catch (error) {
    return null;
  }
}

async function navigateWithHashFallback(canonicalUrl: string, fallbackUrl: string, view: Window): Promise<void> {
  const shouldUseFallback = !(await probeCanonicalUrl(canonicalUrl));
  view.location.assign(shouldUseFallback ? fallbackUrl : canonicalUrl);
}

async function probeCanonicalUrl(url: string): Promise<boolean> {
  try {
    const options = await fetch(url, { method: "OPTIONS" });
    if (options.status === 404) {
      return false;
    }
    if (options.status !== 405 && options.status !== 501) {
      const allow = options.headers.get("allow") ?? options.headers.get("access-control-allow-methods");
      const allowed = allow ? allow.split(",").map((method) => method.trim().toUpperCase()) : [];
      if (allowed.includes("HEAD")) {
        const head = await fetch(url, { method: "HEAD" });
        return head.status !== 404;
      }
      if (allowed.includes("GET")) {
        const get = await fetch(url, { method: "GET" });
        return get.status !== 404;
      }
      return true;
    }
    const response = await fetch(url, { method: "HEAD" });
    if (response.status !== 405 && response.status !== 501) {
      return response.status !== 404;
    }
    const get = await fetch(url, { method: "GET" });
    return get.status !== 404;
  } catch (error) {
    return false;
  }
}

function getRedirectAttribute(target: ParsedRequestTarget): string | null {
  const direct = target.element.getAttribute("hy-redirect");
  if (direct) {
    return direct;
  }
  if (target.form) {
    return target.form.getAttribute("hy-redirect");
  }
  return null;
}

function resolveRequestUrl(target: ParsedRequestTarget, state: RuntimeState): InterpolationResult {
  const scope = buildRequestScope(target, state);
  let template = target.urlTemplate;
  if (
    target.element instanceof HTMLInputElement ||
    target.element instanceof HTMLSelectElement ||
    target.element instanceof HTMLTextAreaElement
  ) {
    const encoded = encodeURIComponent(target.element.value ?? "");
    template = template.replace(/\[value\]/g, encoded);
  }
  return resolveUrlTemplate(template, scope, state, {
    urlEncodeTokens: true,
    context: "request"
  });
}

function buildRequestScope(target: ParsedRequestTarget, state: RuntimeState): ScopeStack {
  const scope = buildScopeStack(target.element, state);
  const element = target.element;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const name = element.name?.trim();
    if (name) {
      const value = element instanceof HTMLInputElement ? readInputValue(element) : element.value;
      scope.push({ [name]: value });
    }
  }
  return scope;
}

async function handleActionRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<boolean> {
  if (!target.element.isConnected) {
    return false;
  }

  if (target.form && target.element instanceof HTMLButtonElement) {
    clearFormStateOnRequest(target, state);
  }

  if (target.element instanceof HTMLButtonElement && target.method === "GET") {
    const cached = getPrefetchCacheEntry(target, state);
    if (cached) {
      applyRequestPayload(target, cached.payload, state);
      dispatchCommandIfNeeded(target, state);
      emitLog(state, {
        type: "info",
        message: "prefetch:hit",
        detail: { url: resolveRequestUrl(target, state).value },
        timestamp: Date.now()
      });
      return true;
    }
  }

  let previousValue: unknown = null;
  const isOptimisticInput = target.element instanceof HTMLInputElement && target.method !== "GET";
  if (isOptimisticInput) {
    const input = target.element as HTMLInputElement;
    previousValue = getOptimisticInputValue(input, state);
    state.optimisticInputValues.set(input, readInputValue(input));
  }

  const success = await handleRequest(target, state);
  if (!success && isOptimisticInput && target.element instanceof HTMLInputElement) {
    applyControlValue(target.element, previousValue);
    state.optimisticInputValues.set(target.element, previousValue);
    return false;
  }

  if (success) {
    dispatchCommandIfNeeded(target, state);
  }

  return success;
}

function getOptimisticInputValue(input: HTMLInputElement, state: RuntimeState): unknown {
  if (state.optimisticInputValues.has(input)) {
    return state.optimisticInputValues.get(input);
  }
  const initial = readInitialInputValue(input);
  state.optimisticInputValues.set(input, initial);
  return initial;
}

function readInitialInputValue(input: HTMLInputElement): unknown {
  if (input.type === "checkbox") {
    return input.defaultChecked;
  }
  if (input.type === "radio") {
    return input.defaultChecked ? input.value : "";
  }
  return input.defaultValue;
}

function readInputValue(input: HTMLInputElement): unknown {
  if (input.type === "checkbox") {
    return input.checked;
  }
  if (input.type === "radio") {
    return input.checked ? input.value : "";
  }
  return input.value;
}

function dispatchCommandIfNeeded(target: ParsedRequestTarget, state: RuntimeState): void {
  const element = target.element;
  const command = element.getAttribute("command");
  const commandFor = element.getAttribute("commandfor");
  if (!command && !commandFor) {
    return;
  }
  if (!(element instanceof HTMLElement)) {
    return;
  }
  state.actionCommandSkip.add(element);
  try {
    element.click();
  } finally {
    state.actionCommandSkip.delete(element);
  }
}

function applyRequestPayload(target: ParsedRequestTarget, payload: unknown, state: RuntimeState): void {
  applyStore(target, payload, state);
  if (target.fillInto) {
    applyFillInto(target.fillInto, payload, state);
  }
  maybeRedirectAfterSubmit(target, payload, state);
  cleanupRequestTarget(target);
  if (target.store) {
    const cascadedStores = handleCascadeStoreUpdate(target.store, state);
    if (!state.bootstrapPending) {
      const selectors = [target.store, ...cascadedStores];
      const changes: PluginChange[] = selectors.map((selector) => ({ type: "store", selector }));
      renderDocument(state, changes);
    }
  }
}

function getPrefetchCacheEntry(
  target: ParsedRequestTarget,
  state: RuntimeState
): { timestamp: number; payload: unknown } | null {
  const resolved = resolveRequestUrl(target, state);
  const cached = state.actionPrefetchCache.get(resolved.value);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.timestamp > 10_000) {
    state.actionPrefetchCache.delete(resolved.value);
    return null;
  }
  return cached;
}

async function prefetchActionRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  if (target.method !== "GET") {
    return;
  }
  const resolved = resolveRequestUrl(target, state);
  if (state.actionPrefetchCache.has(resolved.value)) {
    return;
  }
  const existing = state.actionPrefetchInFlight.get(resolved.value);
  if (existing) {
    return;
  }
  const { finalUrl, init } = buildRequestInit(target, resolved.value, state.doc);
  const promise = fetchRequest(finalUrl, init, state)
    .then((response) => {
      if (!response.ok) {
        return;
      }
      state.actionPrefetchCache.set(resolved.value, {
        timestamp: Date.now(),
        payload: response.data
      });
      emitLog(state, {
        type: "info",
        message: "prefetch:store",
        detail: { url: resolved.value },
        timestamp: Date.now()
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      emitLog(state, {
        type: "error",
        message: "prefetch:error",
        detail: { url: resolved.value, method: target.method, error: message },
        timestamp: Date.now()
      });
    })
    .finally(() => {
      state.actionPrefetchInFlight.delete(resolved.value);
    });
  state.actionPrefetchInFlight.set(resolved.value, promise);
  await promise;
}

function recordRedirectError(state: RuntimeState, url: string, message: string): void {
  const detail: HyError["detail"] = { url, method: "REDIRECT" };
  pushError(state, createHyError("request", message, detail));
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  if (typeof console !== "undefined") {
    console.warn("[hytde] redirect error", message, detail);
  }
}

async function handleRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<boolean> {
  const { element } = target;
  if (!element.isConnected) {
    return false;
  }
  if (target.kind === "stream") {
    await handleStreamRequest(target, state);
    return true;
  }
  if (target.kind === "sse") {
    await handleSseRequest(target, state);
    return true;
  }
  if (target.kind === "polling") {
    await handlePollingRequest(target, state);
    return true;
  }
  if (target.form && state.inFlightForms.has(target.form)) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "in-flight", formId: target.form.id || undefined },
      timestamp: Date.now()
    });
    return false;
  }

  if (target.form && target.trigger === "submit") {
    clearFormStateOnRequest(target, state);
  }

  const resolvedUrl = resolveRequestUrl(target, state);

  maybeUpdateHistoryOnSubmit(target, state);

  const { finalUrl, init, logDetail } = buildRequestInit(target, resolvedUrl.value, state.doc);

  const method = target.method;
  const dedupeKey = method === "GET" ? finalUrl : null;
  const cached = dedupeKey ? state.requestCache.get(dedupeKey) : null;

  if (cached) {
    if (target.form) {
      state.inFlightForms.add(target.form);
    }
    await cached.promise.finally(() => {
      if (target.form) {
        state.inFlightForms.delete(target.form);
      }
    });
    if (cached.payloadSet) {
      applyRequestPayload(target, cached.payload, state);
    }
    return true;
  }

  if (target.kind === "fetch" && target.store) {
    markCascadeRequestPending(target, state);
  }

  const requestId = ++state.requestCounter;
  emitLog(state, {
    type: "request",
    message: `request:start(${requestId})`,
    detail: {
      url: finalUrl,
      method,
      ...(logDetail ?? {})
    },
    timestamp: Date.now()
  });

  if (target.form) {
    state.inFlightForms.add(target.form);
  }

  let succeeded = false;
  const requestPromise = fetchRequest(finalUrl, init, state)
    .then(async (response) => {
      emitLog(state, {
        type: "request",
        message: `request:complete(${requestId})`,
        detail: { url: finalUrl, method, status: response.status, mocked: response.mocked },
        timestamp: Date.now()
      });
      if (!response.ok) {
        recordError(
          state,
          new Error(`Request failed: ${response.status}`),
          finalUrl,
          method,
          response.status
        );
        return;
      }
      applyRequestPayload(target, response.data, state);
      if (dedupeKey) {
        const entry = state.requestCache.get(dedupeKey);
        if (entry) {
          entry.payload = response.data;
          entry.payloadSet = true;
        }
      }
      succeeded = true;
    })
    .catch((error: unknown) => {
      recordError(state, error, finalUrl, method);
    })
    .finally(() => {
      if (target.form) {
        state.inFlightForms.delete(target.form);
      }
      state.pendingRequests = Math.max(0, state.pendingRequests - 1);
      state.globals.hy.loading = state.pendingRequests > 0;
    });

  state.pendingRequests += 1;
  state.globals.hy.loading = true;
  setErrors(state, []);

  if (dedupeKey) {
    state.requestCache.set(dedupeKey, { promise: requestPromise, payload: undefined, payloadSet: false });
  }

  await requestPromise;
  return succeeded;
}

async function handleStreamRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  const { element, urlTemplate } = target;
  const scope = buildScopeStack(element, state);
  const resolvedUrl = resolveUrlTemplate(urlTemplate, scope, state, {
    urlEncodeTokens: true,
    context: "request"
  });
  const { finalUrl, init } = buildRequestInit(target, resolvedUrl.value, state.doc);
  const requestId = ++state.requestCounter;
  const gate = createStreamGate(target);

  emitLog(state, {
    type: "request",
    message: `stream:start(${requestId})`,
    detail: { url: finalUrl, method: target.method },
    timestamp: Date.now()
  });

  state.pendingRequests += 1;
  state.globals.hy.loading = true;
  setErrors(state, []);

  try {
    void consumeStream(finalUrl, init, target, state, gate).catch((error) => {
      recordError(state, error, finalUrl, target.method);
      gate.resolve();
    });
    await gate.promise;
    emitLog(state, {
      type: "request",
      message: `stream:complete(${requestId})`,
      detail: { url: finalUrl, method: target.method },
      timestamp: Date.now()
    });
    cleanupRequestTarget(target);
  } catch (error) {
    recordError(state, error, finalUrl, target.method);
  } finally {
    state.pendingRequests = Math.max(0, state.pendingRequests - 1);
    state.globals.hy.loading = state.pendingRequests > 0;
  }
}

async function handleSseRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  const { element, urlTemplate } = target;
  const scope = buildScopeStack(element, state);
  const resolvedUrl = resolveUrlTemplate(urlTemplate, scope, state, {
    urlEncodeTokens: true,
    context: "request"
  });
  const gate = createStreamGate(target);
  const mockRule = matchMockRule(resolvedUrl.value, "GET", state.mockRules);
  if (mockRule) {
    logMockMatch(state, "GET", resolvedUrl.value);
    emitLog(state, {
      type: "request",
      message: "sse:mock",
      detail: { url: resolvedUrl.value, method: "GET", path: mockRule.path },
      timestamp: Date.now()
    });
    if (typeof console !== "undefined") {
      console.info("[hytde] sse mock", resolvedUrl.value, mockRule.path);
    }
    const payload = await fetchMockPayload(mockRule);
    void emitMockSse(payload, target, state, gate, mockRule).catch((error) => {
      recordError(state, error, resolvedUrl.value, "GET");
      gate.resolve();
    });
    await gate.promise;
    return;
  }
  logMockUnhandled(state, "GET", resolvedUrl.value);

  const eventSource = new EventSource(resolvedUrl.value);
  state.sseSources.set(target, eventSource);
  emitLog(state, {
    type: "request",
    message: "sse:start",
    detail: { url: resolvedUrl.value, method: "GET" },
    timestamp: Date.now()
  });

  eventSource.addEventListener("message", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      const appended = appendStreamPayload(target, data, state);
      if (appended) {
        gate.increment();
      }
      if (target.store) {
        if (!state.bootstrapPending) {
          renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
        }
      }
    } catch (error) {
      recordStreamError(state, "SSE message parse error", resolvedUrl.value, "GET");
    }
  });

  eventSource.addEventListener("error", () => {
    recordStreamError(state, "SSE connection error", resolvedUrl.value, "GET");
    gate.resolve();
  });

  await gate.promise;
}

async function handlePollingRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  const { element, urlTemplate } = target;
  if (!element.isConnected) {
    return;
  }
  const scope = buildScopeStack(element, state);
  const resolvedUrl = resolveUrlTemplate(urlTemplate, scope, state, {
    urlEncodeTokens: true,
    context: "request"
  });
  const { finalUrl, init } = buildRequestInit(target, resolvedUrl.value, state.doc);
  const intervalMs = Math.max(200, target.pollIntervalMs ?? 1000);

  const tick = async () => {
    if (!element.isConnected) {
      return;
    }
    await runPollingOnce(finalUrl, init, target, state);
  };

  await tick();
  const timer = window.setInterval(() => {
    void tick();
  }, intervalMs);
  state.pollingTimers.set(target, timer);
}

async function consumeStream(
  url: string,
  init: RequestInit,
  target: ParsedRequestTarget,
  state: RuntimeState,
  gate: StreamGate
): Promise<void> {
  const mockRule = matchMockRule(url, init.method ?? "GET", state.mockRules);
  if (mockRule) {
    logMockMatch(state, init.method ?? "GET", url);
    emitLog(state, {
      type: "request",
      message: "stream:mock",
      detail: { url, method: init.method ?? "GET", path: mockRule.path },
      timestamp: Date.now()
    });
    if (typeof console !== "undefined") {
      console.info("[hytde] stream mock", url, mockRule.path);
    }
    const payload = await fetchMockPayload(mockRule);
    await emitMockStream(payload, target, state, gate, mockRule);
    return;
  }
  logMockUnhandled(state, init.method ?? "GET", url);

  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.status}`);
  }

  if (!response.body) {
    const payload = await safeJson(response);
    appendStreamPayload(target, payload, state);
    gate.increment();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseJsonLines(buffer);
    buffer = parsed.rest;
    for (const item of parsed.items) {
      const appended = appendStreamPayload(target, item, state);
      if (appended) {
        gate.increment();
      }
      if (target.store) {
        if (!state.bootstrapPending) {
          renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
        }
      }
    }
  }

  buffer += decoder.decode();
  const remaining = buffer.trim();
  if (remaining) {
    try {
      const item = JSON.parse(remaining);
      const appended = appendStreamPayload(target, item, state);
      if (appended) {
        gate.increment();
      }
      if (target.store && !state.bootstrapPending) {
        renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
      }
    } catch (error) {
      throw new Error("Stream chunk parsing failed.");
    }
  }

  gate.resolve();
}

async function fetchMockPayload(rule: MockRule): Promise<unknown> {
  const response = await fetch(rule.path, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Mock fetch failed: ${response.status}`);
  }
  return safeJson(response);
}

async function emitMockStream(
  payload: unknown,
  target: ParsedRequestTarget,
  state: RuntimeState,
  gate: StreamGate,
  rule: MockRule
): Promise<void> {
  const delay = getMockDelay(rule);
  if (Array.isArray(payload)) {
    for (const item of payload) {
      await new Promise((resolve) => setTimeout(resolve, delay()));
      const appended = appendStreamPayload(target, item, state);
      if (appended) {
        gate.increment();
      }
      if (target.store && !state.bootstrapPending) {
        renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
      }
    }
    return;
  }
  appendStreamPayload(target, payload, state);
  gate.increment();
  if (target.store) {
    if (!state.bootstrapPending || gate.ready) {
      renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
    }
  }
}

async function emitMockSse(
  payload: unknown,
  target: ParsedRequestTarget,
  state: RuntimeState,
  gate: StreamGate,
  rule: MockRule
): Promise<void> {
  const delay = getMockDelay(rule);
  if (Array.isArray(payload)) {
    for (const item of payload) {
      await new Promise((resolve) => setTimeout(resolve, delay()));
      const appended = appendStreamPayload(target, item, state);
      if (appended) {
        gate.increment();
      }
      if (target.store && !state.bootstrapPending) {
        renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
      }
    }
    gate.resolve();
    return;
  }
  appendStreamPayload(target, payload, state);
  gate.increment();
    if (target.store && !state.bootstrapPending) {
      renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
    }
  gate.resolve();
}

function parseJsonLines(buffer: string): { items: unknown[]; rest: string } {
  const items: unknown[] = [];
  let rest = buffer;
  while (true) {
    const newline = rest.indexOf("\n");
    if (newline === -1) {
      break;
    }
    const line = rest.slice(0, newline).trim();
    rest = rest.slice(newline + 1);
    if (!line) {
      continue;
    }
    try {
      items.push(JSON.parse(line));
    } catch (error) {
      rest = `${line}\n${rest}`;
      break;
    }
  }
  return { items, rest };
}

function appendStreamPayload(target: ParsedRequestTarget, payload: unknown, state: RuntimeState): boolean {
  const unwrap = target.unwrap ? resolvePath(payload, parseSelectorTokens(target.unwrap)) : payload;
  const store = target.store;
  if (!store) {
    return false;
  }
  if (Array.isArray(unwrap)) {
    let appended = false;
    for (const item of unwrap) {
      appended = appendStoreItem(store, item, state, target.streamKey) || appended;
    }
    return appended;
  }
  return appendStoreItem(store, unwrap, state, target.streamKey);
}

function appendStoreItem(store: string, item: unknown, state: RuntimeState, keySelector: string | null): boolean {
  if (keySelector) {
    const key = resolveStreamKey(item, keySelector);
    if (key != null) {
      const cache = getStreamKeyCache(store, state, keySelector);
      if (cache.has(key)) {
        return false;
      }
      cache.add(key);
    }
  }
  const existing = state.globals.hyState[store];
  const next = Array.isArray(existing) ? [...existing, item] : [item];
  state.globals.hyState[store] = next;
  return true;
}

function getMockDelay(rule: MockRule): () => number {
  const delay = rule.delayMs ?? { min: 200, max: 200 };
  return () => delay.min + Math.random() * (delay.max - delay.min);
}

async function runPollingOnce(
  url: string,
  init: RequestInit,
  target: ParsedRequestTarget,
  state: RuntimeState
): Promise<void> {
  const mockRule = matchMockRule(url, init.method ?? "GET", state.mockRules);
  if (mockRule) {
    logMockMatch(state, init.method ?? "GET", url);
    emitLog(state, {
      type: "request",
      message: "polling:mock",
      detail: { url, method: init.method ?? "GET", path: mockRule.path },
      timestamp: Date.now()
    });
    const payload = await resolvePollingMockPayload(target, mockRule, state);
    if (payload === null) {
      return;
    }
    applyPollingStore(target, payload, state);
    return;
  }
  logMockUnhandled(state, init.method ?? "GET", url);

  try {
    state.pendingRequests += 1;
    state.globals.hy.loading = true;
    const response = await fetch(url, init);
    if (response.status === 204) {
      return;
    }
    const payload = await safeJson(response);
    if (payload == null) {
      return;
    }
    applyPollingStore(target, payload, state);
  } catch (error) {
    recordError(state, error, url, init.method ?? "GET");
  } finally {
    state.pendingRequests = Math.max(0, state.pendingRequests - 1);
    state.globals.hy.loading = state.pendingRequests > 0;
  }
}

function applyPollingStore(target: ParsedRequestTarget, payload: unknown, state: RuntimeState): void {
  const unwrap = target.unwrap ? resolvePath(payload, parseSelectorTokens(target.unwrap)) : payload;
  if (unwrap == null) {
    return;
  }
  const store = target.store;
  if (!store) {
    return;
  }
  state.globals.hyState[store] = unwrap;
  if (!state.bootstrapPending) {
    const cascadedStores = handleCascadeStoreUpdate(store, state);
    const selectors = [store, ...cascadedStores];
    const changes: PluginChange[] = selectors.map((selector) => ({ type: "store", selector }));
    renderDocument(state, changes);
  }
}

async function resolvePollingMockPayload(
  target: ParsedRequestTarget,
  rule: MockRule,
  state: RuntimeState
): Promise<unknown | null> {
  let queue = state.pollingMockQueues.get(target);
  if (!queue) {
    const payload = await fetchMockPayload(rule);
    const items = Array.isArray(payload) ? payload : [payload];
    queue = { items, index: 0 };
    state.pollingMockQueues.set(target, queue);
  }
  if (queue.index >= queue.items.length) {
    return null;
  }
  const next = queue.items[queue.index];
  queue.index += 1;
  if (next == null) {
    return null;
  }
  return next;
}

function buildRequestInit(
  target: ParsedRequestTarget,
  resolvedUrl: string,
  doc: Document
): { finalUrl: string; init: RequestInit; logDetail?: Record<string, unknown> } {
  let finalUrl = resolvedUrl;
  const init: RequestInit = { method: target.method };
  let payload: Record<string, unknown> | undefined;
  let encoding: string | undefined;
  const form = target.form;
  let logDetail: Record<string, unknown> | undefined;

  if (form) {
    if (target.method === "GET") {
      finalUrl = appendFormParams(resolvedUrl, form, doc);
    } else {
      const entries = collectFormValues(form);
      const hasFile = entries.some((entry) => entryHasFile(entry.value));
      const hasEnctype = form.hasAttribute("enctype");
      const enctype = form.enctype;

      if (hasFile && enctype !== "multipart/form-data") {
        encoding = "multipart/form-data";
        payload = formEntriesToLogPayload(maskEntriesForLog(entries));
        init.body = buildFormData(entries);
      } else if (hasEnctype && enctype === "application/x-www-form-urlencoded") {
        encoding = "application/x-www-form-urlencoded";
        init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
        payload = formEntriesToPayload(entries);
        init.body = buildUrlSearchParams(entries).toString();
      } else if (hasEnctype && enctype === "multipart/form-data") {
        encoding = "multipart/form-data";
        payload = formEntriesToLogPayload(maskEntriesForLog(entries));
        init.body = buildFormData(entries);
      } else if (hasEnctype) {
        encoding = enctype;
        init.headers = { "Content-Type": enctype };
        payload = formEntriesToPayload(entries);
        init.body = JSON.stringify(payload);
      } else {
        encoding = "application/json";
        payload = formEntriesToPayload(entries);
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(payload);
      }

      logDetail = {
        contentType: (init.headers as Record<string, string> | undefined)?.["Content-Type"] ?? encoding,
        payload: payload ?? {}
      };
    }
  }

  return { finalUrl, init, logDetail };
}

function appendFormParams(urlString: string, form: HTMLFormElement, doc: Document): string {
  const fallbackBase = doc.defaultView?.location?.href ?? "";
  const url = new URL(urlString, doc.baseURI ?? fallbackBase);
  const formData = new FormData(form);
  formData.forEach((value, key) => {
    if (typeof value === "string") {
      url.searchParams.append(key, value);
    }
  });

  return url.toString();
}

type FormValue = string | number | boolean | null | File;
type FormEntry = { name: string; value: FormValue | FormValue[] };
type LogFileValue = {
  filename: string;
  contentType: string;
  size: number;
  content: "(dummy)";
};
type LogFormValue = string | number | boolean | null | LogFileValue;
type LogFormEntry = { name: string; value: LogFormValue | LogFormValue[] };

function collectFormValues(form: HTMLFormElement): FormEntry[] {
  const controls = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input[name], select[name], textarea[name]"
    )
  );
  const entries: FormEntry[] = [];

  for (const control of controls) {
    if (control.disabled || !control.name) {
      continue;
    }
    if (control instanceof HTMLInputElement) {
      const type = control.type;
      if (type === "submit" || type === "button" || type === "reset") {
        continue;
      }
      if (type === "file") {
        const files = Array.from(control.files ?? []);
        if (files.length === 0) {
          continue;
        }
        entries.push({ name: control.name, value: control.multiple ? files : files[0] });
        continue;
      }
      if (type === "checkbox") {
        const hasValue = control.hasAttribute("value");
        if (hasValue) {
          if (!control.checked) {
            continue;
          }
          entries.push({ name: control.name, value: control.value });
        } else {
          entries.push({ name: control.name, value: control.checked });
        }
        continue;
      }
      if (type === "radio") {
        if (!control.checked) {
          continue;
        }
        entries.push({ name: control.name, value: control.value });
        continue;
      }
      if (type === "number") {
        if (control.value === "") {
          entries.push({ name: control.name, value: null });
        } else if (Number.isNaN(control.valueAsNumber)) {
          entries.push({ name: control.name, value: null });
        } else {
          entries.push({ name: control.name, value: control.valueAsNumber });
        }
        continue;
      }
    }

    if (control instanceof HTMLSelectElement && control.multiple) {
      const values = Array.from(control.selectedOptions).map((option) => option.value);
      entries.push({ name: control.name, value: values });
      continue;
    }

    entries.push({ name: control.name, value: control.value });
  }

  return entries;
}

function formEntriesToPayload(entries: FormEntry[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const entry of entries) {
    const value = normalizeEntryValue(entry.value);
    if (Object.prototype.hasOwnProperty.call(data, entry.name)) {
      const existing = data[entry.name];
      if (Array.isArray(existing)) {
        data[entry.name] = existing.concat(value);
      } else {
        data[entry.name] = Array.isArray(value) ? [existing as FormValue, ...value] : [existing as FormValue, value];
      }
    } else {
      data[entry.name] = value;
    }
  }
  return data;
}

function buildUrlSearchParams(entries: FormEntry[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const entry of entries) {
    const value = entry.value;
    if (value == null) {
      params.append(entry.name, "");
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(entry.name, stringifyFormValue(item));
      }
      continue;
    }
    params.append(entry.name, stringifyFormValue(value));
  }
  return params;
}

function buildFormData(entries: FormEntry[]): FormData {
  const formData = new FormData();
  for (const entry of entries) {
    const value = entry.value;
    if (value == null) {
      formData.append(entry.name, "");
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        formData.append(entry.name, item instanceof File ? item : stringifyFormValue(item));
      }
      continue;
    }
    formData.append(entry.name, value instanceof File ? value : stringifyFormValue(value));
  }
  return formData;
}

function normalizeEntryValue(value: FormValue | FormValue[]): FormValue | FormValue[] {
  if (Array.isArray(value)) {
    return value.map((item) => (item instanceof File ? item.name : item));
  }
  if (value instanceof File) {
    return value.name;
  }
  return value;
}

function stringifyFormValue(value: FormValue): string {
  if (value == null) {
    return "";
  }
  return String(value);
}

function entryHasFile(value: FormValue | FormValue[]): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => item instanceof File);
  }
  return value instanceof File;
}

function maskEntriesForLog(entries: FormEntry[]): LogFormEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    value: maskEntryValue(entry.value)
  }));
}

function maskEntryValue(value: FormValue | FormValue[]): LogFormValue | LogFormValue[] {
  if (Array.isArray(value)) {
    return value.map((item) => (item instanceof File ? fileToLogObject(item) : item));
  }
  if (value instanceof File) {
    return fileToLogObject(value);
  }
  return value;
}

function fileToLogObject(file: File): LogFileValue {
  return {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    content: "(dummy)"
  };
}

function formEntriesToLogPayload(entries: LogFormEntry[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const entry of entries) {
    const value = entry.value;
    if (Object.prototype.hasOwnProperty.call(data, entry.name)) {
      const existing = data[entry.name];
      if (Array.isArray(existing)) {
        data[entry.name] = existing.concat(value);
      } else {
        data[entry.name] = Array.isArray(value)
          ? [existing as LogFormValue, ...value]
          : [existing as LogFormValue, value];
      }
    } else {
      data[entry.name] = value;
    }
  }
  return data;
}

interface FetchResult {
  data: unknown;
  status: number;
  mocked: boolean;
  ok: boolean;
}

async function fetchRequest(url: string, init: RequestInit, state: RuntimeState): Promise<FetchResult> {
  const method = (init.method ?? "GET").toUpperCase();
  if (!state.useMswMock) {
    const mockRule = matchMockRule(url, method, state.mockRules);
    if (mockRule) {
      logMockMatch(state, method, url);
      const delay = mockRule.delayMs ?? { min: 100, max: 500 };
      const wait = delay.min + Math.random() * (delay.max - delay.min);
      await new Promise((resolve) => setTimeout(resolve, wait));
      const response = await fetch(mockRule.path, { method: "GET" });
      if (!response.ok) {
        throw new Error(`Mock fetch failed: ${response.status}`);
      }
      const payload = await safeJson(response);
      const status = mockRule.status ?? response.status;
      return {
        data: payload,
        status,
        mocked: true,
        ok: status >= 200 && status < 300
      };
    }
    logMockUnhandled(state, method, url);
  }

  const response = await fetch(url, init);
  return {
    data: await safeJson(response),
    status: response.status,
    mocked: false,
    ok: response.ok
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function markCascadeRequestPending(target: ParsedRequestTarget, state: RuntimeState): void {
  if (!target.store) {
    return;
  }
  const selects = state.cascade.storeToSelects.get(target.store);
  if (!selects) {
    return;
  }
  for (const select of selects) {
    disableCascadeSelect(select, state);
  }
}

function disableCascadeSelect(select: HTMLSelectElement, state: RuntimeState): void {
  const existing = state.cascade.disabledState.get(select);
  if (existing) {
    return;
  }
  state.cascade.disabledState.set(select, {
    prevDisabled: select.disabled,
    prevAriaBusy: select.getAttribute("aria-busy")
  });
  select.disabled = true;
  select.setAttribute("aria-busy", "true");
}

function enableCascadeSelect(select: HTMLSelectElement, state: RuntimeState): void {
  const existing = state.cascade.disabledState.get(select);
  if (!existing) {
    return;
  }
  if (!existing.prevDisabled) {
    select.disabled = false;
  }
  if (existing.prevAriaBusy === null) {
    select.removeAttribute("aria-busy");
  } else {
    select.setAttribute("aria-busy", existing.prevAriaBusy);
  }
  state.cascade.disabledState.delete(select);
}

function resetCascadeSelect(select: HTMLSelectElement, state: RuntimeState): boolean {
  if (select.multiple) {
    let changed = false;
    for (const option of Array.from(select.options)) {
      if (option.selected) {
        option.selected = false;
        changed = true;
      }
    }
    if (changed) {
      state.cascade.actionSkip.add(select);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return changed;
  }

  const hasEmpty = Array.from(select.options).some((option) => option.value === "");
  const previousValue = select.value;
  if (hasEmpty) {
    select.value = "";
  } else {
    select.selectedIndex = -1;
  }
  const changed = select.value !== previousValue;
  if (changed) {
    state.cascade.actionSkip.add(select);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return changed;
}

function handleCascadeStoreUpdate(store: string, state: RuntimeState): string[] {
  const clearedStores = new Set<string>();
  const pending = [store];
  const processed = new Set<string>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      continue;
    }
    if (processed.has(current)) {
      continue;
    }
    processed.add(current);

    const selects = state.cascade.storeToSelects.get(current);
    if (!selects) {
      continue;
    }

    for (const select of selects) {
      if (state.cascade.cycleSelects.has(select)) {
        continue;
      }
      resetCascadeSelect(select, state);
      const downstreamStores = state.cascade.selectToStores.get(select);
      if (!downstreamStores) {
        continue;
      }
      for (const downstream of downstreamStores) {
        if (clearedStores.has(downstream)) {
          continue;
        }
        state.globals.hyState[downstream] = null;
        clearedStores.add(downstream);
        pending.push(downstream);
      }
    }

    for (const select of selects) {
      enableCascadeSelect(select, state);
    }
  }

  return Array.from(clearedStores);
}

function logMockMatch(state: RuntimeState, method: string, url: string): void {
  if (state.parsed.executionMode !== "mock") {
    return;
  }
  if (typeof console !== "undefined") {
    console.debug("request:match", { method, url, mocked: true });
  }
}

function logMockUnhandled(state: RuntimeState, method: string, url: string): void {
  void state;
  void method;
  void url;
}

function matchMockRule(url: string, method: string, rules: MockRule[]): MockRule | null {
  const fallbackBase = typeof window !== "undefined" ? window.location.href : "";
  const urlObj = new URL(url, fallbackBase);
  const pathname = urlObj.pathname;
  const upperMethod = method.toUpperCase();

  for (const rule of rules) {
    if (rule.method !== upperMethod) {
      continue;
    }
    if (rule.pattern.test(pathname)) {
      return rule;
    }
  }

  return null;
}

function applyStore(target: ParsedRequestTarget, response: unknown, state: RuntimeState): unknown {
  const unwrap = target.unwrap;
  const payload = unwrap ? resolvePath(response, parseSelectorTokens(unwrap)) : response;
  const store = target.store;
  if (store) {
    state.globals.hyState[store] = payload;
  }
  return payload;
}

function applyFillInto(selector: string, payload: unknown, state: RuntimeState): void {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const forms = Array.from(state.doc.querySelectorAll<HTMLFormElement>(selector)).filter(
    (element) => element instanceof HTMLFormElement
  );
  for (const form of forms) {
    fillForm(form, payload as Record<string, unknown>);
  }
}

function recordError(state: RuntimeState, error: unknown, url: string, method: string, status?: number): void {
  const message = error instanceof Error ? error.message : String(error);
  const detail: HyError["detail"] = { url, method };
  if (status != null) {
    detail.status = status;
  }
  setErrors(state, [createHyError("request", message, detail)]);
  state.globals.hy.loading = false;
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  if (typeof console !== "undefined") {
    console.error("[hytde] request error", error);
  }
}

function recordStreamError(state: RuntimeState, message: string, url: string, method: string): void {
  const detail: HyError["detail"] = { url, method };
  pushError(state, createHyError("request", message, detail));
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  if (typeof console !== "undefined") {
    console.warn("[hytde] stream error", message, detail);
  }
}

function emitLog(state: RuntimeState, entry: HyLogEntry): void {
  for (const callback of state.logCallbacks) {
    try {
      callback(entry);
    } catch (error) {
      if (typeof console !== "undefined") {
        console.error("[hytde] log callback error", error);
      }
    }
  }
}

function emitTransformError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("transform", message, detail));
  if (typeof console !== "undefined") {
    console.error("[hytde] transform error", message, detail);
  }
}

function emitExpressionError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("syntax", message, detail));
  if (typeof console !== "undefined") {
    console.error("[hytde] expression error", message, detail);
  }
}

function createHyError(type: HyError["type"], message: string, detail?: HyError["detail"]): HyError {
  return {
    type,
    message,
    detail,
    timestamp: Date.now()
  };
}

function setErrors(state: RuntimeState, errors: HyError[]): void {
  state.globals.hy.errors = errors;
  dispatchErrors(state, errors);
}

function pushError(state: RuntimeState, error: HyError): void {
  const key = `${error.type}:${error.message}:${JSON.stringify(error.detail ?? {})}`;
  if (state.errorDedup.has(key)) {
    return;
  }
  state.errorDedup.add(key);
  const next = [...state.globals.hy.errors, error];
  state.globals.hy.errors = next;
  dispatchErrors(state, next);
}

function dispatchErrors(state: RuntimeState, errors: HyError[]): void {
  const onError = state.globals.hy.onError;
  if (typeof onError === "function") {
    onError(errors);
    return;
  }

  if (errors.length === 0) {
    if (state.errorUi) {
      updateErrorUi(state.errorUi, errors);
    }
    return;
  }

  const popover = state.parsed.hasErrorPopover ? state.doc.getElementById("hy-error") : null;
  if (errors.length > 0 && popover && "showPopover" in popover && typeof popover.showPopover === "function") {
    popover.showPopover();
    return;
  }

  if (state.parsed.handlesErrors) {
    return;
  }

  const ui = ensureErrorUi(state);
  updateErrorUi(ui, errors);
}

function ensureErrorUi(state: RuntimeState): ErrorUiState {
  if (state.errorUi) {
    return state.errorUi;
  }

  const doc = state.doc;
  const toast = doc.createElement("div");
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "polite");
  toast.style.position = "fixed";
  toast.style.bottom = "1rem";
  toast.style.right = "1rem";
  toast.style.background = "#1f2937";
  toast.style.color = "#f9fafb";
  toast.style.padding = "0.75rem 0.9rem";
  toast.style.borderRadius = "0.75rem";
  toast.style.boxShadow = "0 10px 24px rgba(0,0,0,0.2)";
  toast.style.display = "none";
  toast.style.fontFamily = "system-ui, sans-serif";
  toast.style.fontSize = "0.875rem";
  toast.style.alignItems = "center";
  toast.style.gap = "0.5rem";
  toast.style.cursor = "pointer";
  toast.style.zIndex = "2147483647";

  const toastText = doc.createElement("span");
  toastText.textContent = "Error occurred";
  const toastCount = doc.createElement("span");
  toastCount.style.marginLeft = "0.5rem";
  toastCount.style.fontWeight = "600";

  const toastClose = doc.createElement("button");
  toastClose.type = "button";
  toastClose.textContent = "x";
  toastClose.style.marginLeft = "0.75rem";
  toastClose.style.background = "transparent";
  toastClose.style.border = "none";
  toastClose.style.color = "inherit";
  toastClose.style.cursor = "pointer";
  toastClose.addEventListener("click", (event) => {
    event.stopPropagation();
    toast.style.display = "none";
  });

  toast.append("!", " ", toastText, toastCount, toastClose);

  const dialog = doc.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.style.position = "fixed";
  dialog.style.inset = "0";
  dialog.style.display = "none";
  dialog.style.alignItems = "center";
  dialog.style.justifyContent = "center";
  dialog.style.background = "rgba(15, 23, 42, 0.45)";
  dialog.style.zIndex = "2147483647";

  const panel = doc.createElement("div");
  panel.style.background = "#fff";
  panel.style.borderRadius = "0.75rem";
  panel.style.padding = "1.25rem";
  panel.style.width = "min(640px, 90vw)";
  panel.style.maxHeight = "70vh";
  panel.style.overflow = "auto";
  panel.style.fontFamily = "system-ui, sans-serif";

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.marginBottom = "1rem";

  const title = doc.createElement("h2");
  title.textContent = "HyTDE Errors";
  title.style.fontSize = "1.1rem";
  title.style.fontWeight = "600";
  title.style.margin = "0";

  const controls = doc.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "0.5rem";

  const clearButton = doc.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  clearButton.style.border = "1px solid #e5e7eb";
  clearButton.style.borderRadius = "0.5rem";
  clearButton.style.padding = "0.35rem 0.75rem";
  clearButton.style.background = "#f3f4f6";
  clearButton.style.cursor = "pointer";

  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.style.border = "1px solid #e5e7eb";
  closeButton.style.borderRadius = "0.5rem";
  closeButton.style.padding = "0.35rem 0.75rem";
  closeButton.style.background = "#fff";
  closeButton.style.cursor = "pointer";

  controls.append(clearButton, closeButton);
  header.append(title, controls);

  const list = doc.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "0.75rem";

  panel.append(header, list);
  dialog.append(panel);
  doc.body.append(toast, dialog);

  const ui: ErrorUiState = {
    toast,
    toastCount,
    dialog,
    list,
    clearButton,
    closeButton
  };

  toast.addEventListener("click", () => {
    dialog.style.display = "flex";
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.style.display = "none";
    }
  });
  closeButton.addEventListener("click", () => {
    dialog.style.display = "none";
  });
  clearButton.addEventListener("click", () => {
    setErrors(state, []);
    dialog.style.display = "none";
  });

  state.errorUi = ui;
  return ui;
}

function updateErrorUi(ui: ErrorUiState, errors: HyError[]): void {
  if (errors.length === 0) {
    ui.toast.style.display = "none";
    ui.dialog.style.display = "none";
    return;
  }

  ui.toast.style.display = "flex";
  ui.toastCount.textContent = errors.length > 1 ? `(${errors.length})` : "";

  while (ui.list.firstChild) {
    ui.list.removeChild(ui.list.firstChild);
  }

  for (const error of [...errors].reverse()) {
    const item = ui.list.ownerDocument.createElement("div");
    item.style.border = "1px solid #e5e7eb";
    item.style.borderRadius = "0.5rem";
    item.style.padding = "0.75rem";
    item.style.display = "flex";
    item.style.flexDirection = "column";
    item.style.gap = "0.35rem";

    const title = ui.list.ownerDocument.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = `${error.type}: ${error.message}`;

    const time = ui.list.ownerDocument.createElement("div");
    time.style.fontSize = "0.8rem";
    time.style.opacity = "0.7";
    time.textContent = new Date(error.timestamp).toLocaleString();

    const detail = ui.list.ownerDocument.createElement("div");
    detail.style.fontSize = "0.8rem";
    detail.style.color = "#374151";
    if (error.detail) {
      detail.textContent = Object.entries(error.detail)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(" | ");
    }

    item.append(title, time);
    if (error.detail) {
      item.append(detail);
    }
    ui.list.append(item);
  }
}

function emitRenderComplete(state: RuntimeState): void {
  for (const callback of state.renderCallbacks) {
    try {
      callback();
    } catch (error) {
      if (typeof console !== "undefined") {
        console.error("[hytde] render callback error", error);
      }
    }
  }
}

function renderDocument(
  state: RuntimeState,
  changes?: PluginChange[],
  options?: { appendStores?: string[] }
): void {
  const doc = state.doc;
  if (!doc.body) {
    return;
  }
  state.appendStores = options?.appendStores ? new Set(options.appendStores) : null;
  state.appendLogOnlyNew = Boolean(options?.appendStores && options.appendStores.length > 0);

  state.errorDedup.clear();
  emitLog(state, {
    type: "render",
    message: "render:start",
    timestamp: Date.now()
  });

  renderParsedSubtree(state.parsed, state, [], changes);
  cleanupRequestTargets(state.parsed.requestTargets);

  emitLog(state, {
    type: "render",
    message: "render:complete",
    timestamp: Date.now()
  });
  emitRenderComplete(state);
  const reason = state.pluginsInitialized ? "update" : "init";
  runPluginRender(state, reason, changes);
  state.pluginsInitialized = true;
  applyHyCloak(state);
  clearAppendMarkers(state);
  state.appendStores = null;
  state.appendLogOnlyNew = false;
}

function applyHyCloak(state: RuntimeState): void {
  if (state.cloakApplied) {
    return;
  }
  const elements = state.parsed.cloakElements;
  if (!elements || elements.length === 0) {
    state.cloakApplied = true;
    return;
  }

  for (const element of elements) {
    if (!element.isConnected) {
      continue;
    }
    if (!(element instanceof HTMLElement)) {
      element.removeAttribute("hy-cloak");
      continue;
    }
    element.style.removeProperty("display");
    if (!element.style.transition) {
      element.style.transition = "opacity 160ms ease";
    }
    element.style.opacity = "0";
    element.removeAttribute("hy-cloak");
    requestAnimationFrame(() => {
      element.style.opacity = "1";
    });
  }

  state.cloakApplied = true;
}

const APPEND_MARK_ATTR = "data-hy-append";

function clearAppendMarkers(state: RuntimeState): void {
  if (!state.appendLogOnlyNew) {
    return;
  }
  const elements = Array.from(state.doc.querySelectorAll(`[${APPEND_MARK_ATTR}]`));
  for (const element of elements) {
    element.removeAttribute(APPEND_MARK_ATTR);
  }
}

function getStreamKeyCache(store: string, state: RuntimeState, keySelector: string): Set<string> {
  const existing = state.streamKeyCache.get(store);
  if (existing) {
    return existing;
  }
  const cache = new Set<string>();
  const current = state.globals.hyState[store];
  if (Array.isArray(current)) {
    for (const item of current) {
      const key = resolveStreamKey(item, keySelector);
      if (key != null) {
        cache.add(key);
      }
    }
  }
  state.streamKeyCache.set(store, cache);
  return cache;
}

function resolveStreamKey(item: unknown, keySelector: string): string | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const tokens = parseSelectorTokens(keySelector);
  const value = resolvePath(item, tokens);
  if (value == null) {
    return null;
  }
  return String(value);
}

type StreamGate = {
  promise: Promise<void>;
  ready: boolean;
  increment: () => void;
  resolve: () => void;
};

function createStreamGate(target: ParsedRequestTarget): StreamGate {
  const required = target.streamInitial;
  const timeoutMs = target.streamTimeoutMs;
  if (!required || required <= 0) {
    return {
      promise: Promise.resolve(),
      ready: true,
      increment: () => {
        return;
      },
      resolve: () => {
        return;
      }
    };
  }

  let current = 0;
  let resolveFn: () => void = () => {
    return;
  };
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  let timer: number | null = null;
  if (timeoutMs && timeoutMs > 0) {
    timer = window.setTimeout(() => {
      resolveFn();
    }, timeoutMs);
  }

  const gate: StreamGate = {
    promise,
    ready: false,
    increment: () => {
      current += 1;
      if (current >= required && !gate.ready) {
        gate.ready = true;
        if (timer != null) {
          window.clearTimeout(timer);
        }
        resolveFn();
      }
    },
    resolve: () => {
      if (!gate.ready) {
        gate.ready = true;
        if (timer != null) {
          window.clearTimeout(timer);
        }
        resolveFn();
      }
    }
  };

  return gate;
}

function renderForTemplate(template: ParsedForTemplate, state: RuntimeState, scope: ScopeStack): void {
  if (!template.marker.isConnected) {
    return;
  }
  const select =
    template.template.tagName === "OPTION" && template.marker.parentNode instanceof HTMLSelectElement
      ? template.marker.parentNode
      : null;
  const selectionSnapshot = select ? captureSelectSelection(select) : null;
  const items = evaluateSelector(template.selector, scope, state);
  const appendMode = state.appendStores?.has(template.selector) ?? false;
  const appendCount = Array.isArray(items) ? Math.max(0, items.length - template.rendered.length) : 0;
  const logValue = appendMode ? undefined : items;
  emitLog(state, {
    type: "render",
    message: "for:before",
    detail: appendMode
      ? { selector: template.selector, appended: appendCount }
      : { selector: template.selector, value: logValue },
    timestamp: Date.now()
  });
  if (!Array.isArray(items)) {
    for (const node of template.rendered) {
      node.parentNode?.removeChild(node);
    }
    template.rendered = [];
    emitLog(state, {
      type: "render",
      message: "for:after",
      detail: { selector: template.selector, rendered: 0 },
      timestamp: Date.now()
    });
    if (select && selectionSnapshot) {
      restoreSelectSelection(select, selectionSnapshot);
    }
    return;
  }

  if (appendMode && items.length >= template.rendered.length) {
    let insertAfter: Node = template.rendered[template.rendered.length - 1] ?? template.marker;
    for (let index = template.rendered.length; index < items.length; index += 1) {
      const item = items[index];
      const clone = template.template.cloneNode(true) as Element;
      clone.setAttribute(APPEND_MARK_ATTR, "true");
      const nextScope = [...scope, { [template.varName]: item }];
      const parsedClone = state.parser.parseSubtree(clone);
      renderParsedSubtree(parsedClone, state, nextScope);

      template.marker.parentNode?.insertBefore(clone, insertAfter.nextSibling);
      template.rendered.push(clone);
      insertAfter = clone;
    }
    emitLog(state, {
      type: "render",
      message: "for:append",
      detail: { selector: template.selector, rendered: template.rendered.length },
      timestamp: Date.now()
    });
    return;
  }

  for (const node of template.rendered) {
    node.parentNode?.removeChild(node);
  }
  template.rendered = [];

  let insertAfter: Node = template.marker;
  for (const item of items) {
    const clone = template.template.cloneNode(true) as Element;
    const nextScope = [...scope, { [template.varName]: item }];
    const parsedClone = state.parser.parseSubtree(clone);
    renderParsedSubtree(parsedClone, state, nextScope);

    template.marker.parentNode?.insertBefore(clone, insertAfter.nextSibling);
    template.rendered.push(clone);
    insertAfter = clone;
  }
  emitLog(state, {
    type: "render",
    message: "for:after",
    detail: { selector: template.selector, rendered: template.rendered.length },
    timestamp: Date.now()
  });
  if (select && selectionSnapshot) {
    restoreSelectSelection(select, selectionSnapshot);
  }
}

type SelectSelectionSnapshot = { multiple: true; values: string[] } | { multiple: false; value: string };

function captureSelectSelection(select: HTMLSelectElement): SelectSelectionSnapshot {
  if (select.multiple) {
    return {
      multiple: true,
      values: Array.from(select.selectedOptions).map((option) => option.value)
    };
  }
  return { multiple: false, value: select.value };
}

function restoreSelectSelection(select: HTMLSelectElement, snapshot: SelectSelectionSnapshot): void {
  if (snapshot.multiple) {
    const values = new Set(snapshot.values);
    for (const option of Array.from(select.options)) {
      option.selected = values.has(option.value);
    }
    return;
  }
  if (snapshot.value === "") {
    return;
  }
  const exists = Array.from(select.options).some((option) => option.value === snapshot.value);
  if (exists) {
    select.value = snapshot.value;
  }
}

type ScopeStack = Array<Record<string, unknown>>;

function buildScopeStack(element: Element, state: RuntimeState): ScopeStack {
  const scopes: ScopeStack = [];
  const parent = element.closest("[hy-for]");
  if (!parent) {
    return scopes;
  }

  // Loop scopes created via templates are injected during render and not stored on DOM.
  return scopes;
}

function renderParsedSubtree(
  parsed: ParsedSubtree,
  state: RuntimeState,
  scope: ScopeStack,
  changes?: PluginChange[]
): void {
  removeDummyNodes(parsed.dummyElements);

  processIfChains(parsed.ifChains, state, scope);
  for (const template of parsed.forTemplates) {
    if (shouldRenderForTemplate(template, changes)) {
      renderForTemplate(template, state, scope);
    }
  }
  processBindings(parsed, state, scope);
  setupFillActionHandlers(state, parsed.fillActions);
  applyFillTargets(parsed.fillTargets, state, scope);
}

function shouldRenderForTemplate(template: ParsedForTemplate, changes?: PluginChange[]): boolean {
  if (!changes || changes.length === 0) {
    return true;
  }
  if (changes.some((change) => change.type === "dom")) {
    return true;
  }
  return changes.some((change) => {
    if (change.type !== "store") {
      return false;
    }
    if (change.selector === template.selector) {
      return true;
    }
    return template.selector.startsWith(`${change.selector}.`);
  });
}

function processIfChains(chains: ParsedIfChain[], state: RuntimeState, scope: ScopeStack): void {
  for (const chain of chains) {
    const parent = chain.anchor.parentNode;
    if (!parent) {
      continue;
    }

    let kept: ParsedIfChainNode | null = null;
    for (const entry of chain.nodes) {
      let condition = true;
      if (entry.kind === "if" || entry.kind === "else-if") {
        condition = Boolean(evaluateExpression(entry.expression ?? "", scope, state));
      }

      if (!kept && condition) {
        kept = entry;
      }
    }

    for (const entry of chain.nodes) {
      const node = entry.node;
      if (kept && node === kept.node) {
        if (node.parentNode !== parent || node.previousSibling !== chain.anchor) {
          parent.insertBefore(node, chain.anchor.nextSibling);
        }
        if (node.hasAttribute("hidden")) {
          const hidden = node.getAttribute("hidden");
          if (hidden === "" || hidden === "hy-ignore") {
            node.removeAttribute("hidden");
          }
        }
      } else if (node.isConnected) {
        node.remove();
      }
    }
  }
}

function cleanupRequestTargets(targets: ParsedRequestTarget[]): void {
  for (const target of targets) {
    cleanupRequestTarget(target);
  }
}

function cleanupRequestTarget(target: ParsedRequestTarget): void {
  const element = target.element;
  element.removeAttribute("hy-get");
  element.removeAttribute("hy-post");
  element.removeAttribute("hy-put");
  element.removeAttribute("hy-patch");
  element.removeAttribute("hy-delete");
  element.removeAttribute("hy-get-stream");
  element.removeAttribute("hy-sse");
  element.removeAttribute("hy-get-polling");
  element.removeAttribute("hy-store");
  element.removeAttribute("hy-unwrap");
  element.removeAttribute("hy-stream-initial");
  element.removeAttribute("hy-stream-timeout");
  element.removeAttribute("hy-stream-key");
  element.removeAttribute("stream-initial");
  element.removeAttribute("stream-timeout");
  element.removeAttribute("stream-key");
  element.removeAttribute("interval");
}


function processBindings(parsed: ParsedSubtree, state: RuntimeState, scope: ScopeStack): void {
  for (const binding of parsed.textBindings) {
    const value = evaluateExpression(binding.expression, scope, state);
    if (state.appendLogOnlyNew) {
      const inAppend = binding.element.closest(`[${APPEND_MARK_ATTR}]`);
      if (!inAppend) {
        binding.element.textContent = value == null ? "" : String(value);
        continue;
      }
    }
    binding.element.textContent = value == null ? "" : String(value);
    emitLog(state, {
      type: "render",
      message: "hy:text",
      detail: { expression: binding.expression, value },
      timestamp: Date.now()
    });
    binding.element.removeAttribute("hy");
  }

  for (const binding of parsed.attrBindings) {
    const shouldUseNav = binding.target === "href" && binding.element instanceof HTMLAnchorElement;
    const interpolated = shouldUseNav
      ? resolveUrlTemplate(binding.template, scope, state, {
        urlEncodeTokens: true,
        context: "nav"
      })
      : interpolateTemplate(binding.template, scope, state, {
        urlEncodeTokens: binding.target === "href"
      });

    if (interpolated.isSingleToken && interpolated.tokenValue == null) {
      binding.element.removeAttribute(binding.target);
    } else {
      binding.element.setAttribute(binding.target, interpolated.value);
    }
    if (shouldUseNav) {
      if (state.pathMeta.mode === "hash" && interpolated.navFallback) {
        binding.element.setAttribute(NAV_FALLBACK_ATTR, interpolated.navFallback);
      } else {
        binding.element.removeAttribute(NAV_FALLBACK_ATTR);
      }
    }
    if (binding.attr.startsWith("hy-")) {
      binding.element.removeAttribute(binding.attr);
    }
  }
}

function applyFillTargets(targets: ParsedFillTarget[], state: RuntimeState, scope: ScopeStack): void {
  if (targets.length === 0) {
    return;
  }
  for (const target of targets) {
    const source = evaluateExpression(target.selector, scope, state);
    if (!source || typeof source !== "object") {
      continue;
    }
    fillForm(target.form, source as Record<string, unknown>);
  }
}

function fillForm(form: HTMLFormElement, source: Record<string, unknown>): void {
  const controls = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name], select[name], textarea[name]")
  );

  for (const control of controls) {
    const name = control.name;
    if (!name) {
      continue;
    }
    const resolved = resolveFormValue(source, name);
    if (!resolved.found || resolved.value == null) {
      continue;
    }
    applyControlValue(control, resolved.value);
  }
}

function resolveFormValue(
  source: Record<string, unknown>,
  name: string
): { found: boolean; value: unknown } {
  const tokens = name.split(".").filter(Boolean);
  let current: unknown = source;

  for (const token of tokens) {
    if (!current || typeof current !== "object") {
      return { found: false, value: null };
    }
    if (!Object.prototype.hasOwnProperty.call(current, token)) {
      return { found: false, value: null };
    }
    current = (current as Record<string, unknown>)[token];
  }

  if (current === undefined) {
    return { found: false, value: null };
  }
  return { found: true, value: current };
}

function applyControlValue(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: unknown): void {
  if (control instanceof HTMLInputElement) {
    if (control.type === "file") {
      return;
    }
    if (control.type === "checkbox") {
      if (typeof value === "boolean") {
        control.checked = value;
      } else if (Array.isArray(value)) {
        control.checked = value.map(String).includes(control.value);
      } else {
        control.checked = String(value) === control.value;
      }
      return;
    }
    if (control.type === "radio") {
      control.checked = String(value) === control.value;
      return;
    }
    control.value = String(value);
    return;
  }

  if (control instanceof HTMLSelectElement) {
    if (control.multiple && Array.isArray(value)) {
      const values = value.map(String);
      for (const option of Array.from(control.options)) {
        option.selected = values.includes(option.value);
      }
      return;
    }
    control.value = String(value);
    return;
  }

  control.value = String(value);
}

interface InterpolationResult {
  value: string;
  isSingleToken: boolean;
  tokenValue: unknown;
  navFallback?: string | null;
}

type UrlInterpolationContext = "nav" | "request";

function resolveUrlTemplate(
  template: string,
  scope: ScopeStack,
  state: RuntimeState,
  options: { urlEncodeTokens: boolean; context: UrlInterpolationContext }
): InterpolationResult {
  const resolved = interpolateTemplate(template, scope, state, {
    urlEncodeTokens: options.urlEncodeTokens
  });
  const navResult = applyPathParamsToUrl(resolved.value, template, scope, state, options.context);
  return { ...resolved, value: navResult.value, navFallback: navResult.fallback };
}

function applyPathParamsToUrl(
  urlString: string,
  template: string,
  scope: ScopeStack,
  state: RuntimeState,
  context: UrlInterpolationContext
): { value: string; fallback: string | null } {
  const tokens = collectPathTokens(template);
  if (tokens.length === 0) {
    return { value: urlString, fallback: null };
  }
  if (context === "nav") {
    return resolveNavUrl(urlString, template, tokens, scope, state);
  }
  return { value: replacePathTokens(urlString, tokens, scope, state), fallback: null };
}

function collectPathTokens(template: string): string[] {
  const tokens: string[] = [];
  const regex = /\[([A-Za-z0-9_$-]+)\]/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(template)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function resolveNavUrl(
  urlString: string,
  template: string,
  tokens: string[],
  scope: ScopeStack,
  state: RuntimeState
): { value: string; fallback: string | null } {
  const [base, hash = ""] = urlString.split("#");
  const hashParams = parseHashParams(hash);
  const resolved = replacePathTokensWithValues(base, tokens, hashParams, scope, state);
  const value = resolved.value;
  const fallback = hash ? urlString : null;
  return { value, fallback };
}

function replacePathTokens(urlString: string, tokens: string[], scope: ScopeStack, state: RuntimeState): string {
  return replacePathTokensWithValues(urlString, tokens, null, scope, state).value;
}

function replacePathTokensWithValues(
  urlString: string,
  tokens: string[],
  hashParams: Record<string, string> | null,
  scope: ScopeStack,
  state: RuntimeState
): { value: string } {
  let result = urlString;
  for (const token of tokens) {
    const value = hashParams?.[token] ?? resolvePathTokenValue(token, scope, state);
    if (value == null) {
      recordMissingPathParam(state, token, urlString);
      continue;
    }
    const encoded = encodeURIComponent(value);
    result = result.replace(new RegExp(`\\[${token}\\]`, "g"), encoded);
  }
  return { value: result };
}

function resolvePathTokenValue(token: string, scope: ScopeStack, state: RuntimeState): string | null {
  const evaluated = evaluateSelector(token, scope, state);
  if (isJsonScalar(evaluated) && evaluated != null) {
    return String(evaluated);
  }
  const params = state.globals.hyParams;
  if (Object.prototype.hasOwnProperty.call(params, token)) {
    return params[token];
  }
  return null;
}

function recordMissingPathParam(state: RuntimeState, token: string, template: string): void {
  const key = `${token}@${template}`;
  if (state.missingPathParams.has(key)) {
    return;
  }
  state.missingPathParams.add(key);
  const detail = { context: "path", param: token, template };
  emitLog(state, {
    type: "error",
    message: "path:param-missing",
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("data", "Missing path param", detail));
}

function interpolateTemplate(
  template: string,
  scope: ScopeStack,
  state: RuntimeState,
  options: { urlEncodeTokens: boolean }
): InterpolationResult {
  const pieces: Array<{ type: "text"; value: string } | { type: "token"; value: string }> = [];
  let cursor = 0;

  while (cursor < template.length) {
    const char = template[cursor];
    const next = template[cursor + 1];

    if (char === "{" && next === "{") {
      pieces.push({ type: "text", value: "{" });
      cursor += 2;
      continue;
    }

    if (char === "}" && next === "}") {
      pieces.push({ type: "text", value: "}" });
      cursor += 2;
      continue;
    }

    if (char === "{") {
      const end = template.indexOf("}", cursor + 1);
      if (end === -1) {
        pieces.push({ type: "text", value: template.slice(cursor) });
        break;
      }
      const token = template.slice(cursor + 1, end).trim();
      pieces.push({ type: "token", value: token });
      cursor = end + 1;
      continue;
    }

    pieces.push({ type: "text", value: char });
    cursor += 1;
  }

  const isSingleToken = pieces.length === 1 && pieces[0].type === "token";
  let tokenValue: unknown = null;
  let value = "";

  for (const piece of pieces) {
    if (piece.type === "text") {
      value += piece.value;
    } else {
      const evaluated = evaluateExpression(piece.value, scope, state);
      tokenValue = evaluated;
      if (evaluated == null) {
        value += "";
      } else {
        const raw = String(evaluated);
        value += options.urlEncodeTokens ? encodeURIComponent(raw) : raw;
      }
    }
  }

  return { value, isSingleToken, tokenValue };
}

function evaluateExpression(expression: string, scope: ScopeStack, state: RuntimeState): unknown {
  const parts = expression.split("|>").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  let value = evaluateSelector(parts[0], scope, state);
  for (let index = 1; index < parts.length; index += 1) {
    const transform = parseTransform(parts[index]);
    value = applyTransform(transform, value, state);
  }

  return value;
}

function parseTransform(transform: string): { name: string; args: unknown[] } {
  const match = transform.match(/^([A-Za-z_$][\w$]*)(?:\((.*)\))?$/);
  if (!match) {
    return { name: transform, args: [] };
  }

  const name = match[1];
  const args = match[2] ? parseLiteralArgs(match[2]) : [];
  return { name, args };
}

function parseLiteralArgs(text: string): unknown[] {
  const args: unknown[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    while (text[cursor] === " " || text[cursor] === "\n" || text[cursor] === "\t" || text[cursor] === ",") {
      cursor += 1;
    }
    if (cursor >= text.length) {
      break;
    }

    const char = text[cursor];
    if (char === "'" || char === "\"") {
      const quote = char;
      let end = cursor + 1;
      let value = "";
      while (end < text.length) {
        if (text[end] === "\\" && end + 1 < text.length) {
          value += text[end + 1];
          end += 2;
          continue;
        }
        if (text[end] === quote) {
          break;
        }
        value += text[end];
        end += 1;
      }
      args.push(value);
      cursor = end + 1;
      continue;
    }

    const nextComma = text.indexOf(",", cursor);
    const token = (nextComma === -1 ? text.slice(cursor) : text.slice(cursor, nextComma)).trim();
    args.push(parsePrimitive(token));
    cursor = nextComma === -1 ? text.length : nextComma + 1;
  }

  return args;
}

function parsePrimitive(token: string): unknown {
  if (token === "true") {
    return true;
  }
  if (token === "false") {
    return false;
  }
  if (token === "null") {
    return null;
  }
  const num = Number(token);
  if (!Number.isNaN(num)) {
    return num;
  }
  return token;
}

function applyTransform(transform: { name: string; args: unknown[] }, value: unknown, state: RuntimeState): unknown {
  const registry = getTransformRegistry(state.globals.hy as unknown as Record<string, unknown>);
  const entry = registry.get(transform.name);
  if (!entry) {
    emitTransformError(state, `Transform "${transform.name}" is not registered.`, {
      transform: transform.name
    });
    return null;
  }

  if (transform.args.length > 3) {
    emitTransformError(state, `Transform "${transform.name}" supports up to 3 arguments.`, {
      transform: transform.name,
      args: transform.args.length
    });
    return null;
  }

  if (!matchesInputType(value, entry.inputType)) {
    emitTransformError(state, `Transform "${transform.name}" expected ${entry.inputType}.`, {
      transform: transform.name,
      inputType: entry.inputType,
      value
    });
    return null;
  }

  const output = entry.fn(value as JsonScalar, ...transform.args);
  if (!isJsonScalar(output)) {
    emitTransformError(state, `Transform "${transform.name}" returned non-scalar.`, {
      transform: transform.name,
      value: output
    });
    return null;
  }

  return output;
}

function evaluateSelector(selector: string, scope: ScopeStack, state: RuntimeState): unknown {
  const parsed = parseSelectorTokensStrict(selector);
  if (parsed.error) {
    emitExpressionError(state, "Expression selector is invalid.", {
      selector,
      reason: parsed.error
    });
    return null;
  }
  const tokens = parsed.tokens;
  if (tokens.length === 0) {
    return null;
  }

  const first = tokens[0];
  if (typeof first !== "string") {
    return null;
  }

  let current = resolveRootValue(first, scope, state.globals);
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (current == null) {
      return null;
    }
    if (typeof token === "number") {
      current = (current as unknown[])[token];
    } else {
      if (token === "last" && Array.isArray(current)) {
        current = current.length > 0 ? current[current.length - 1] : null;
        continue;
      }
      current = (current as Record<string, unknown>)[token];
    }
  }

  return current ?? null;
}

function resolveRootValue(name: string, scope: ScopeStack, globals: RuntimeGlobals): unknown {
  for (let index = scope.length - 1; index >= 0; index -= 1) {
    const locals = scope[index];
    if (Object.prototype.hasOwnProperty.call(locals, name)) {
      return locals[name];
    }
  }

  if (Object.prototype.hasOwnProperty.call(globals.hyState, name)) {
    return globals.hyState[name];
  }

  if (name === "hy") {
    return globals.hy;
  }
  if (name === "hyState") {
    return globals.hyState;
  }
  if (name === "hyParams") {
    return globals.hyParams;
  }

  return null;
}

function parseSelectorTokens(selector: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let cursor = 0;
  const length = selector.length;

  const readIdentifier = (): string | null => {
    const match = selector.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
    if (!match) {
      return null;
    }
    cursor += match[1].length;
    return match[1];
  };

  const first = readIdentifier();
  if (!first) {
    return tokens;
  }
  tokens.push(first);

  while (cursor < length) {
    const char = selector[cursor];
    if (char === ".") {
      cursor += 1;
      const ident = readIdentifier();
      if (!ident) {
        break;
      }
      tokens.push(ident);
      continue;
    }

    if (char === "[") {
      cursor += 1;
      while (selector[cursor] === " ") {
        cursor += 1;
      }
      const quote = selector[cursor];
      if (quote === "'" || quote === "\"") {
        cursor += 1;
        let value = "";
        while (cursor < length) {
          if (selector[cursor] === "\\" && cursor + 1 < length) {
            value += selector[cursor + 1];
            cursor += 2;
            continue;
          }
          if (selector[cursor] === quote) {
            break;
          }
          value += selector[cursor];
          cursor += 1;
        }
        cursor += 1;
        tokens.push(value);
      } else {
        const end = selector.indexOf("]", cursor);
        const raw = selector.slice(cursor, end === -1 ? length : end).trim();
        const num = Number(raw);
        tokens.push(Number.isNaN(num) ? raw : num);
        cursor = end === -1 ? length : end;
      }

      while (cursor < length && selector[cursor] !== "]") {
        cursor += 1;
      }
      cursor += 1;
      continue;
    }

    break;
  }

  return tokens;
}

function parseSelectorTokensStrict(
  selector: string
): { tokens: Array<string | number>; error: string | null } {
  const tokens: Array<string | number> = [];
  if (!selector) {
    return { tokens, error: "Selector is empty." };
  }
  let cursor = 0;
  const length = selector.length;

  const readIdentifier = (): string | null => {
    const match = selector.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
    if (!match) {
      return null;
    }
    cursor += match[1].length;
    return match[1];
  };

  const first = readIdentifier();
  if (!first) {
    return { tokens, error: "Selector must start with an identifier." };
  }
  tokens.push(first);

  while (cursor < length) {
    const char = selector[cursor];
    if (char === ".") {
      cursor += 1;
      const ident = readIdentifier();
      if (!ident) {
        return { tokens, error: "Selector dot segment must be an identifier." };
      }
      tokens.push(ident);
      continue;
    }

    if (char === "[") {
      cursor += 1;
      while (selector[cursor] === " ") {
        cursor += 1;
      }
      const quote = selector[cursor];
      if (quote === "'" || quote === "\"") {
        cursor += 1;
        let value = "";
        while (cursor < length) {
          if (selector[cursor] === "\\" && cursor + 1 < length) {
            value += selector[cursor + 1];
            cursor += 2;
            continue;
          }
          if (selector[cursor] === quote) {
            break;
          }
          value += selector[cursor];
          cursor += 1;
        }
        if (cursor >= length) {
          return { tokens, error: "Selector has unterminated string literal." };
        }
        cursor += 1;
        tokens.push(value);
      } else {
        const end = selector.indexOf("]", cursor);
        if (end === -1) {
          return { tokens, error: "Selector has unterminated bracket." };
        }
        const raw = selector.slice(cursor, end).trim();
        if (!raw) {
          return { tokens, error: "Selector has empty bracket segment." };
        }
        const num = Number(raw);
        if (!Number.isNaN(num)) {
          tokens.push(num);
        } else if (isValidIdentifier(raw)) {
          tokens.push(raw);
        } else {
          return { tokens, error: "Selector bracket segment must be a number or identifier." };
        }
        cursor = end;
      }

      while (cursor < length && selector[cursor] !== "]") {
        if (selector[cursor] !== " ") {
          return { tokens, error: "Selector has invalid bracket syntax." };
        }
        cursor += 1;
      }
      if (selector[cursor] !== "]") {
        return { tokens, error: "Selector has unterminated bracket." };
      }
      cursor += 1;
      continue;
    }

    return { tokens, error: "Selector contains invalid character." };
  }

  return { tokens, error: null };
}

function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function resolvePath(value: unknown, tokens: Array<string | number>): unknown {
  let current = value as unknown;
  for (const token of tokens) {
    if (current == null) {
      return null;
    }
    if (typeof token === "number") {
      current = (current as unknown[])[token];
    } else {
      if (token === "last" && Array.isArray(current)) {
        current = current.length > 0 ? current[current.length - 1] : null;
        continue;
      }
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current ?? null;
}
