export interface HyError {
  message: string;
  url?: string;
  method?: string;
  status?: number;
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
  registerTransform?: (name: string, inputType: JsonScalarType, fn: (input: JsonScalar) => JsonScalar) => void;
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
}

export interface ParsedDocument extends ParsedSubtree {
  doc: Document;
  executionMode: "production" | "mock" | "disable";
  mockRules: MockRule[];
  requestTargets: ParsedRequestTarget[];
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
  renderCallbacks: Array<() => void>;
  logCallbacks: Array<(entry: HyLogEntry) => void>;
}

const runtimeStates = new WeakMap<Document, RuntimeState>();
const RENDER_CALLBACK_KEY = "__hytdeRenderCallbacks";
const LOG_CALLBACK_KEY = "__hytdeLogCallbacks";
const TRANSFORM_REGISTRY_KEY = "__hytdeTransforms";

type JsonScalar = string | number | boolean | null;
type JsonScalarType = "string" | "number" | "boolean" | "null";

interface TransformDefinition {
  inputType: JsonScalarType;
  fn: (input: JsonScalar) => JsonScalar;
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
    renderCallbacks,
    logCallbacks
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

  hy.registerTransform = (name: string, inputType: JsonScalarType, fn: (input: JsonScalar) => JsonScalar) => {
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
  const hasStartupRequests = state.parsed.requestTargets.some((target) => !target.isForm);
  if (hasStartupRequests) {
    state.bootstrapPending = true;
    await runStartupRequests(state);
    state.bootstrapPending = false;
  }
  renderDocument(state);
}
async function runStartupRequests(state: RuntimeState): Promise<void> {
  const requests: Promise<unknown>[] = [];

  for (const target of state.parsed.requestTargets) {
    if (target.isForm) {
      continue;
    }

    requests.push(handleRequest(target, state));
  }

  await Promise.all(requests);
}

function setupFormHandlers(state: RuntimeState): void {
  for (const target of state.parsed.requestTargets) {
    if (!target.isForm) {
      continue;
    }

    const form = target.element as HTMLFormElement;
    if (state.formListeners.has(form)) {
      continue;
    }

    state.formListeners.add(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void handleRequest(target, state);
    });
  }
}

async function handleRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  const { element, urlTemplate } = target;
  if (!element.isConnected) {
    return;
  }

  const scope = buildScopeStack(element, state);
  const resolvedUrl = interpolateTemplate(urlTemplate, scope, state, {
    urlEncodeTokens: true
  });

  const finalUrl = target.isForm
    ? appendFormParams(resolvedUrl.value, element as HTMLFormElement, state.doc)
    : resolvedUrl.value;

  const method = target.method;
  const dedupeKey = method === "GET" ? finalUrl : null;
  const promise = dedupeKey ? state.requestCache.get(dedupeKey) : null;

  if (promise) {
    await promise;
    return;
  }

  const requestId = ++state.requestCounter;
  emitLog(state, {
    type: "request",
    message: `request:start(${requestId})`,
    detail: { url: finalUrl, method, requestId },
    timestamp: Date.now()
  });

  const requestPromise = fetchRequest(finalUrl, method, state)
    .then(async (response) => {
      emitLog(state, {
        type: "request",
        message: `request:complete(${requestId})`,
        detail: { url: finalUrl, method, status: response.status, mocked: response.mocked, requestId },
        timestamp: Date.now()
      });
      const stored = await applyStore(target, response.data, scope, state);
      cleanupRequestTarget(target);
      if (stored && !state.bootstrapPending) {
        renderDocument(state);
      }
    })
    .catch((error: unknown) => {
      recordError(state, error, finalUrl, method);
    })
    .finally(() => {
      state.pendingRequests = Math.max(0, state.pendingRequests - 1);
      state.globals.hy.loading = state.pendingRequests > 0;
    });

  state.pendingRequests += 1;
  state.globals.hy.loading = true;
  state.globals.hy.errors = [];

  if (dedupeKey) {
    state.requestCache.set(dedupeKey, requestPromise);
  }

  await requestPromise;
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

interface FetchResult {
  data: unknown;
  status: number;
  mocked: boolean;
}

async function fetchRequest(url: string, method: string, state: RuntimeState): Promise<FetchResult> {
  const mockRule = matchMockRule(url, method, state.mockRules);
  if (mockRule) {
    const response = await fetch(mockRule.path, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Mock fetch failed: ${response.status}`);
    }
    return {
      data: await response.json(),
      status: response.status,
      mocked: true
    };
  }

  const response = await fetch(url, { method });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return {
    data: await response.json(),
    status: response.status,
    mocked: false
  };
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

async function applyStore(
  target: ParsedRequestTarget,
  response: unknown,
  scope: ScopeStack,
  state: RuntimeState
): Promise<boolean> {
  const store = target.store;
  if (!store) {
    return false;
  }

  let payload = response;
  const unwrap = target.unwrap;
  if (unwrap) {
    payload = resolvePath(response, parseSelectorTokens(unwrap));
  }

  state.globals.hyState[store] = payload;
  return true;
}

function recordError(state: RuntimeState, error: unknown, url: string, method: string): void {
  const message = error instanceof Error ? error.message : String(error);
  state.globals.hy.errors = [{ message, url, method }];
  state.globals.hy.loading = false;
  emitLog(state, {
    type: "error",
    message,
    detail: { url, method },
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
  if (typeof console !== "undefined") {
    console.error("[hytde] transform error", message, detail);
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
      name: transform.name
    });
    return value;
  }

  if (!matchesInputType(value, entry.inputType)) {
    emitTransformError(state, `Transform "${transform.name}" expected ${entry.inputType}.`, {
      name: transform.name,
      inputType: entry.inputType,
      value
    });
    return null;
  }

  const output = entry.fn(value as JsonScalar);
  if (!isJsonScalar(output)) {
    emitTransformError(state, `Transform "${transform.name}" returned non-scalar.`, {
      name: transform.name,
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
