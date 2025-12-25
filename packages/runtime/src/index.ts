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

export interface HyGlobals {
  loading: boolean;
  errors: HyError[];
  onRenderComplete?: (callback: () => void) => void;
  onLog?: (callback: (entry: HyLogEntry) => void) => void;
  onError?: (errors: HyError[]) => void;
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
  isForm: boolean;
  trigger: "startup" | "submit";
  form: HTMLFormElement | null;
  fillInto: string | null;
}

export interface ParsedFillTarget {
  form: HTMLFormElement;
  selector: string;
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

export interface ParsedIfChain {
  nodes: Element[];
}

export interface ParsedSubtree {
  dummyElements: Element[];
  forTemplates: ParsedForTemplate[];
  ifChains: ParsedIfChain[];
  textBindings: ParsedTextBinding[];
  attrBindings: ParsedAttrBinding[];
  fillTargets: ParsedFillTarget[];
}

export interface ParsedDocument extends ParsedSubtree {
  doc: Document;
  executionMode: "production" | "mock" | "disable";
  mockRules: MockRule[];
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
  parsed: ParsedDocument;
  parser: ParserAdapter;
  bootstrapPending: boolean;
  requestCache: Map<string, Promise<unknown>>;
  requestCounter: number;
  pendingRequests: number;
  formListeners: WeakSet<HTMLFormElement>;
  formTargets: Map<HTMLFormElement, ParsedRequestTarget>;
  autoSubmitListeners: WeakSet<HTMLFormElement>;
  autoSubmitState: WeakMap<HTMLFormElement, AutoSubmitState>;
  inFlightForms: WeakSet<HTMLFormElement>;
  historyListenerAttached: boolean;
  renderCallbacks: Array<() => void>;
  logCallbacks: Array<(entry: HyLogEntry) => void>;
  errorUi: ErrorUiState | null;
  errorDedup: Set<string>;
}

interface ErrorUiState {
  toast: HTMLDivElement;
  toastCount: HTMLSpanElement;
  dialog: HTMLDivElement;
  list: HTMLDivElement;
  clearButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

const runtimeStates = new WeakMap<Document, RuntimeState>();
const RENDER_CALLBACK_KEY = "__hytdeRenderCallbacks";
const LOG_CALLBACK_KEY = "__hytdeLogCallbacks";
const TRANSFORM_REGISTRY_KEY = "__hytdeTransforms";

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

const TRANSFORM_TYPES: JsonScalarType[] = ["string", "number", "boolean", "null"];

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
      state.mockRules = parsed.executionMode === "mock" ? parsed.mockRules : [];

      void bootstrapRuntime(state);
    }
  };
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

  return {
    hy: hy as HyGlobals,
    hyState: scope.hyState as Record<string, unknown>,
    hyParams: scope.hyParams as Record<string, string>
  };
}

function getRuntimeState(
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
    return existing;
  }

  const hy = globals.hy as HyGlobals & Record<string, unknown>;
  const renderCallbacks = ensureCallbackStore(hy, RENDER_CALLBACK_KEY) as Array<() => void>;
  const logCallbacks = ensureCallbackStore(hy, LOG_CALLBACK_KEY) as Array<(entry: HyLogEntry) => void>;

  const state: RuntimeState = {
    doc,
    globals,
    mockRules: [],
    parsed,
    parser,
    bootstrapPending: false,
    requestCache: new Map(),
    requestCounter: 0,
    pendingRequests: 0,
    formListeners: new WeakSet(),
    formTargets: new Map(),
    autoSubmitListeners: new WeakSet(),
    autoSubmitState: new WeakMap(),
    inFlightForms: new WeakSet(),
    historyListenerAttached: false,
    renderCallbacks,
    logCallbacks,
    errorUi: null,
    errorDedup: new Set()
  };

  runtimeStates.set(doc, state);
  return state;
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
  setupAutoSubmitHandlers(state);
  setupHistoryHandlers(state);
  const hasStartupRequests = state.parsed.requestTargets.some((target) => target.trigger === "startup");
  const hasHistoryRequests = hasHistoryAutoSubmit(state);
  if (hasStartupRequests || hasHistoryRequests) {
    state.bootstrapPending = true;
    await Promise.all([runStartupRequests(state), runHistoryAutoSubmits(state)]);
    state.bootstrapPending = false;
  }
  renderDocument(state);
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
  const params = parseParams(view.location.search, view.location.hash);
  view.hyParams = params;
  state.globals.hyParams = params;
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
  const resolved = interpolateTemplate(redirectAttr, scope, state, { urlEncodeTokens: true });
  const redirectUrl = resolved.value;
  if (!redirectUrl) {
    return;
  }
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  let finalUrl: URL;
  try {
    finalUrl = new URL(redirectUrl, view.location.href);
  } catch (error) {
    recordRedirectError(state, redirectUrl, "Invalid redirect URL.");
    return;
  }
  if (finalUrl.origin !== view.location.origin) {
    recordRedirectError(state, finalUrl.toString(), "Cross-origin redirect is blocked.");
    return;
  }

  emitLog(state, {
    type: "info",
    message: "redirect:navigate",
    detail: { url: finalUrl.toString(), formId: target.form?.id || undefined },
    timestamp: Date.now()
  });
  view.location.assign(finalUrl.toString());
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

async function handleRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  const { element, urlTemplate } = target;
  if (!element.isConnected) {
    return;
  }
  if (target.form && state.inFlightForms.has(target.form)) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "in-flight", formId: target.form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }

  const scope = buildScopeStack(element, state);
  const resolvedUrl = interpolateTemplate(urlTemplate, scope, state, {
    urlEncodeTokens: true
  });

  maybeUpdateHistoryOnSubmit(target, state);

  const { finalUrl, init, logDetail } = buildRequestInit(target, resolvedUrl.value, state.doc);

  const method = target.method;
  const dedupeKey = method === "GET" ? finalUrl : null;
  const promise = dedupeKey ? state.requestCache.get(dedupeKey) : null;

  if (promise) {
    if (target.form) {
      state.inFlightForms.add(target.form);
    }
    await promise.finally(() => {
      if (target.form) {
        state.inFlightForms.delete(target.form);
      }
    });
    return;
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
      const payload = applyStore(target, response.data, state);
      if (target.fillInto) {
        applyFillInto(target.fillInto, payload, state);
      }
      maybeRedirectAfterSubmit(target, payload, state);
      cleanupRequestTarget(target);
      if (target.store && !state.bootstrapPending) {
        renderDocument(state);
      }
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
    state.requestCache.set(dedupeKey, requestPromise);
  }

  await requestPromise;
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
  const mockRule = matchMockRule(url, method, state.mockRules);
  if (mockRule) {
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

function renderDocument(state: RuntimeState): void {
  const doc = state.doc;
  if (!doc.body) {
    return;
  }

  state.errorDedup.clear();
  emitLog(state, {
    type: "render",
    message: "render:start",
    timestamp: Date.now()
  });

  renderParsedSubtree(state.parsed, state, []);
  cleanupRequestTargets(state.parsed.requestTargets);

  emitLog(state, {
    type: "render",
    message: "render:complete",
    timestamp: Date.now()
  });
  emitRenderComplete(state);
}

function renderForTemplate(template: ParsedForTemplate, state: RuntimeState, scope: ScopeStack): void {
  if (!template.marker.isConnected) {
    return;
  }
  const items = evaluateSelector(template.selector, scope, state.globals);
  emitLog(state, {
    type: "render",
    message: "for:before",
    detail: { selector: template.selector, value: items },
    timestamp: Date.now()
  });
  for (const node of template.rendered) {
    node.parentNode?.removeChild(node);
  }
  template.rendered = [];

  if (!Array.isArray(items)) {
    emitLog(state, {
      type: "render",
      message: "for:after",
      detail: { selector: template.selector, rendered: 0 },
      timestamp: Date.now()
    });
    return;
  }

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

function renderParsedSubtree(parsed: ParsedSubtree, state: RuntimeState, scope: ScopeStack): void {
  removeDummyNodes(parsed.dummyElements);

  for (const template of parsed.forTemplates) {
    renderForTemplate(template, state, scope);
  }

  processIfChains(parsed.ifChains, state, scope);
  processBindings(parsed, state, scope);
  applyFillTargets(parsed.fillTargets, state, scope);
}

function processIfChains(chains: ParsedIfChain[], state: RuntimeState, scope: ScopeStack): void {
  for (const chain of chains) {
    const nodes = chain.nodes.filter((node) => node.isConnected);
    if (nodes.length === 0) {
      continue;
    }

    let kept: Element | null = null;
    for (const node of nodes) {
      let condition = true;
      if (node.hasAttribute("hy-if")) {
        const expr = node.getAttribute("hy-if") ?? "";
        condition = Boolean(evaluateExpression(expr, scope, state));
      } else if (node.hasAttribute("hy-else-if")) {
        const expr = node.getAttribute("hy-else-if") ?? "";
        condition = Boolean(evaluateExpression(expr, scope, state));
      }

      if (!kept && condition) {
        kept = node;
      } else if (node !== kept) {
        node.remove();
      }

      node.removeAttribute("hy-if");
      node.removeAttribute("hy-else-if");
      node.removeAttribute("hy-else");
    }

    if (kept && kept.hasAttribute("hidden")) {
      const hidden = kept.getAttribute("hidden");
      if (hidden === "" || hidden === "hy-ignore") {
        kept.removeAttribute("hidden");
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
  element.removeAttribute("hy-store");
  element.removeAttribute("hy-unwrap");
}


function processBindings(parsed: ParsedSubtree, state: RuntimeState, scope: ScopeStack): void {
  for (const binding of parsed.textBindings) {
    const value = evaluateExpression(binding.expression, scope, state);
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
    const interpolated = interpolateTemplate(binding.template, scope, state, {
      urlEncodeTokens: binding.target === "href"
    });

    if (interpolated.isSingleToken && interpolated.tokenValue == null) {
      binding.element.removeAttribute(binding.target);
    } else {
      binding.element.setAttribute(binding.target, interpolated.value);
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

  let value = evaluateSelector(parts[0], scope, state.globals);
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

function evaluateSelector(selector: string, scope: ScopeStack, globals: RuntimeGlobals): unknown {
  const tokens = parseSelectorTokens(selector);
  if (tokens.length === 0) {
    return null;
  }

  const first = tokens[0];
  if (typeof first !== "string") {
    return null;
  }

  let current = resolveRootValue(first, scope, globals);
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (current == null) {
      return null;
    }
    if (typeof token === "number") {
      current = (current as unknown[])[token];
    } else {
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

function resolvePath(value: unknown, tokens: Array<string | number>): unknown {
  let current = value as unknown;
  for (const token of tokens) {
    if (current == null) {
      return null;
    }
    if (typeof token === "number") {
      current = (current as unknown[])[token];
    } else {
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current ?? null;
}
