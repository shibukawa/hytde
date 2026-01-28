import { delay, http, HttpResponse, sse } from "msw";
import { setupWorker } from "msw/browser";
import type { MockRule } from "@hytde/parser";
import type { HttpResponseResolver, JsonBodyType, RequestHandler, WebSocketHandler } from "msw";

type HyLogEntry = {
  type: "render" | "request" | "error" | "info";
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
};

type HyLogState = {
  loading: boolean;
  errors: unknown[];
  __hytdeLogCallbacks?: Array<(entry: HyLogEntry) => void>;
  __hytdeLogBuffer?: HyLogEntry[];
  __hytdeMswState?: MswState;
  __hytdeRegisterMswMetaHandlers?: (rules: MockRule[], doc: Document) => void;
  __hytdeInitDone?: boolean;
  mockServiceWorker?: (...args: unknown[]) => void | Promise<void>;
  msw?: Record<string, unknown>;
};

type MswHandler = RequestHandler | WebSocketHandler;

type MswState = {
  worker: ReturnType<typeof setupWorker> | null;
  started: boolean;
  userHandlers: MswHandler[];
  metaHandlers: MswHandler[];
  userHandlerKeys: Set<string>;
  metaHandlerKeys: Set<string>;
  fixtureUrls: Set<string>;
  fixturePathnames: Set<string>;
  startOptions: Record<string, unknown> | null;
  pendingStart: boolean;
  loggingAttached: boolean;
  start: (mode: "production" | "mock" | "disable") => Promise<void> | void;
};

const LOG_CALLBACK_KEY = "__hytdeLogCallbacks";
const LOG_BUFFER_KEY = "__hytdeLogBuffer";
const MSW_STATE_KEY = "__hytdeMswState";
const INIT_DONE_KEY = "__hytdeInitDone";

const MSW_OPTION_KEYS = new Set([
  "serviceWorker",
  "onUnhandledRequest",
  "quiet",
  "findWorker",
  "waitUntilReady"
]);

export function installMockServiceWorkerApi(scope: typeof globalThis): void {
  const hy = ensureHy(scope);
  installMswGlobals(scope, hy);
      console.debug("[hytde] msw:api:init", {
      hasMockServiceWorker: !!hy.mockServiceWorker
    });
  if (hy.mockServiceWorker) {
          console.debug("[hytde] msw:api:already-installed");
    return;
  }
  const state = getMswState(scope);
  hy.mockServiceWorker = (...args: unknown[]) => {
          console.debug("[hytde] msw:api:call", summarizeMswArgs(args));
    registerMockServiceWorker(scope, state, args);
  };
  hy.__hytdeRegisterMswMetaHandlers = async (rules: MockRule[], doc: Document) => {
          console.debug("[hytde] msw:meta:register:start", {
        count: rules.length,
        doc: doc.URL
      });
    await registerMetaMockHandlers(scope, state, rules, doc);
          console.debug("[hytde] msw:meta:register:done", {
        handlers: state.metaHandlers.length
      });
  };
      console.debug("[hytde] msw:api:installed");
}

function installMswGlobals(scope: typeof globalThis, hy: HyLogState): void {
  const globals: Array<[string, unknown]> = [
    ["http", http],
    ["HttpResponse", HttpResponse],
    ["sse", sse],
    ["delay", delay]
  ];
  const target = scope as Record<string, unknown>;
  const collisions: string[] = [];
  for (const [key, value] of globals) {
    if (!(key in target)) {
      target[key] = value;
      continue;
    }
    if (target[key] !== value) {
      collisions.push(key);
    }
  }
  if (!hy.msw || typeof hy.msw !== "object") {
    hy.msw = {};
  }
  const hyMsw = hy.msw as Record<string, unknown>;
  for (const [key, value] of globals) {
    if (!(key in hyMsw)) {
      hyMsw[key] = value;
    }
  }
  if (collisions.length > 0) {
    return;
  }
}

function registerMockServiceWorker(scope: typeof globalThis, state: MswState, args: unknown[]): void {
  if (isInitDone(scope)) {
    console.error("[hytde] mockServiceWorker must run before DOMContentLoaded. Do not use defer/async.");
    return;
  }
  const { handlers, options } = parseMswArgs(args);
  const newHandlers: MswHandler[] = [];

      console.debug("[hytde] msw:register:start", {
      handlerArgs: args.length,
      pendingStart: state.pendingStart,
      started: state.started,
      userHandlers: state.userHandlers.length,
      metaHandlers: state.metaHandlers.length
    });

  for (const handler of handlers) {
    if (!isHandlerLike(handler)) {
      logMsw(scope, "msw:error", { reason: "invalid-handler" });
      pushHyError(scope, "Invalid MSW handler.", {});
    }
    const key = extractHandlerKey(handler);
    if (key && state.userHandlerKeys.has(key)) {
      logMsw(scope, "msw:error", { reason: "duplicate-handler", key });
      pushHyError(scope, "Duplicate MSW handler detected.", { key });
      continue;
    }
    if (key) {
      state.userHandlerKeys.add(key);
    }
    newHandlers.push(handler as MswHandler);
  }

  if (newHandlers.length === 0 && !options) {
          console.debug("[hytde] msw:handlers:none");
    return;
  }

  state.userHandlers.push(...newHandlers);
      console.debug("[hytde] msw:handlers:register", {
      added: newHandlers.length,
      totalUser: state.userHandlers.length,
      totalMeta: state.metaHandlers.length
    });
  if (options && !state.started) {
    state.startOptions = options;
          console.debug("[hytde] msw:start:options", sanitizeOptions(options));
  }

  if (state.started && state.worker && newHandlers.length > 0) {
          console.debug("[hytde] msw:use:runtime", {
        added: newHandlers.length,
        totalUser: state.userHandlers.length,
        totalMeta: state.metaHandlers.length
      });
    state.worker.use(...newHandlers);
    logMsw(scope, "msw:reuse", { handlers: newHandlers.length });
    return;
  }

  state.pendingStart = true;
      console.debug("[hytde] msw:queue", {
      userHandlers: state.userHandlers.length,
      metaHandlers: state.metaHandlers.length
    });
}

function parseMswArgs(args: unknown[]): {
  handlers: unknown[];
  options: Record<string, unknown> | null;
} {
  if (args.length === 0) {
    return { handlers: [], options: null };
  }
  const last = args[args.length - 1];
  if (isMswStartOptions(last)) {
    return { handlers: args.slice(0, -1), options: last as Record<string, unknown> };
  }
  return { handlers: args, options: null };
}

function isMswStartOptions(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (extractHandlerKey(value) !== null) {
    return false;
  }
  return Object.keys(value as Record<string, unknown>).some((key) => MSW_OPTION_KEYS.has(key));
}

function extractHandlerKey(handler: unknown): string | null {
  if (!handler || typeof handler !== "object") {
    return null;
  }
  const info = (handler as { info?: { method?: unknown; path?: unknown } }).info;
  if (!info || typeof info !== "object") {
    return null;
  }
  const method = typeof info.method === "string" ? info.method : null;
  const path = typeof info.path === "string" ? info.path : info.path instanceof RegExp ? info.path.source : null;
  if (!method || !path) {
    return null;
  }
  return `${method.toUpperCase()}:${path}`;
}

function isHandlerLike(handler: unknown): boolean {
  return typeof handler === "function" || (typeof handler === "object" && handler !== null);
}

function getMswState(scope: typeof globalThis): MswState {
  const hy = ensureHy(scope);
  if (hy[MSW_STATE_KEY]) {
          console.debug("[hytde] msw:state:reuse");
    return hy[MSW_STATE_KEY] as MswState;
  }
  const state: MswState = {
    worker: null,
    started: false,
    userHandlers: [],
    metaHandlers: [],
    userHandlerKeys: new Set(),
    metaHandlerKeys: new Set(),
    fixtureUrls: new Set(),
    fixturePathnames: new Set(),
    startOptions: null,
    pendingStart: false,
    loggingAttached: false,
    start: async (mode) => {
              console.debug("[hytde] msw:start:check", {
          pendingStart: state.pendingStart,
          started: state.started,
          mode,
          userHandlers: state.userHandlers.length,
          metaHandlers: state.metaHandlers.length
        });
      if (!state.pendingStart && !state.started) {
                  console.debug("[hytde] msw:start:skip:idle");
        return;
      }
              console.debug("[hytde] msw:start:begin", {
          mode,
          userHandlers: state.userHandlers.length,
          metaHandlers: state.metaHandlers.length
        });
      if (mode !== "mock") {
        logMsw(scope, "msw:skip", { reason: "mode", mode });
        state.pendingStart = false;
        return;
      }
      if (state.userHandlers.length === 0 && state.metaHandlers.length === 0) {
        logMsw(scope, "msw:skip", { reason: "no-handlers" });
        state.pendingStart = false;
        return;
      }
      if (!state.worker) {
        try {
          state.worker = setupWorker(...state.userHandlers, ...state.metaHandlers);
          attachMswRequestLogs(state.worker, state);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logMsw(scope, "msw:error", { error: message });
          pushHyError(scope, "Mock Service Worker setup failed.", { error: message });
          state.pendingStart = false;
          return;
        }
      }
      if (!state.started && state.worker) {
        try {
          const startOptions = state.startOptions ?? { onUnhandledRequest: "bypass" };
                      console.debug("[hytde] msw:start:options:effective", sanitizeOptions(startOptions));
          await state.worker.start(startOptions);
          state.started = true;
          logMsw(scope, "msw:start", { handlers: state.userHandlers.length + state.metaHandlers.length });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logMsw(scope, "msw:error", { error: message });
          pushHyError(scope, "Mock Service Worker start failed.", { error: message });
        }
      }
      state.pendingStart = false;
    }
  };
  hy[MSW_STATE_KEY] = state;
  return state;
}

function isInitDone(scope: typeof globalThis): boolean {
  const hy = scope.hy as HyLogState | undefined;
  return Boolean(hy?.[INIT_DONE_KEY]);
}

async function registerMetaMockHandlers(
  scope: typeof globalThis,
  state: MswState,
  rules: MockRule[],
  doc: Document
): Promise<void> {
  const errors: Array<{ url: string; message: string }> = [];
  const newHandlers: MswHandler[] = [];
  for (const rule of rules) {
    const key = `${rule.method.toUpperCase()}:${rule.rawPattern ?? rule.pattern.source}`;
    if (key && state.metaHandlerKeys.has(key)) {
      continue;
    }
    if (key) {
      state.metaHandlerKeys.add(key);
    }
    const fixtureUrl = resolveFixtureUrl(rule.path, doc);
    trackFixtureUrl(state, fixtureUrl);
    const { payload, error } = await preloadFixture(fixtureUrl);
    if (error) {
      errors.push({ url: fixtureUrl, message: error });
      continue;
    }
    const handler = buildMetaHandlerFromPayload(rule, fixtureUrl, payload);
    if (handler) {
      newHandlers.push(handler);
    }
  }
  if (errors.length > 0) {
    for (const error of errors) {
              console.error("[hytde] mock fixture preload failed", error.message, error.url);
      pushHyError(scope, "Mock fixture preload failed.", { url: error.url, error: error.message });
    }
  }
  if (newHandlers.length === 0) {
    return;
  }
  state.metaHandlers.push(...newHandlers);
  state.pendingStart = true;

  if (state.started && state.worker) {
    if (typeof state.worker.resetHandlers === "function") {
      state.worker.resetHandlers(...state.userHandlers, ...state.metaHandlers);
    }
  }
}

function buildMetaHandlerFromPayload(rule: MockRule, fixtureUrl: string, payload: JsonBodyType): MswHandler | null {
  const method = rule.method.toUpperCase();
  const path = resolveMswPath(rule);
  const handler = resolveHandlerFactory(method);
  if (!handler) {
    return null;
  }
  return handler(path, async (info) => {
    const request = (info as { request?: Request }).request;
          console.debug("[hytde] msw:meta:request", {
        method,
        url: request?.url ?? "",
        fixtureUrl
      });
    const delayMs = rule.delayMs ?? { min: 100, max: 500 };
    const waitMs = delayMs.min + Math.random() * (delayMs.max - delayMs.min);
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    const status = rule.status ?? 200;
    const body = clonePayload(payload);
          console.debug("[hytde] msw:meta:response", {
        status,
        summary: summarizePayload(body)
      });
    return HttpResponse.json(body, { status });
  });
}

async function preloadFixture(
  fixtureUrl: string
): Promise<{ payload: JsonBodyType; error?: string }> {
      console.debug("[hytde] msw:meta:preload", { fixtureUrl });
  try {
    const response = await fetch(fixtureUrl, { method: "GET" });
    if (!response.ok) {
      return { payload: null, error: `HTTP ${response.status}` };
    }
    const payload = (await safeJson(response)) as JsonBodyType;
          console.debug("[hytde] msw:meta:preload:done", {
        fixtureUrl,
        summary: summarizePayload(payload)
      });
    return { payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { payload: null, error: message };
  }
}

function clonePayload(payload: JsonBodyType): JsonBodyType {
  if (payload && typeof payload === "object" && typeof structuredClone === "function") {
    try {
      return structuredClone(payload);
    } catch {
      return payload;
    }
  }
  return payload;
}

type HttpHandlerFactory = (path: string | RegExp, resolver: HttpResponseResolver) => MswHandler;

function resolveHandlerFactory(method: string): HttpHandlerFactory | null {
  const table: Record<string, HttpHandlerFactory> = {
    GET: http.get,
    POST: http.post,
    PUT: http.put,
    PATCH: http.patch,
    DELETE: http.delete
  };
  return table[method] ?? null;
}

function resolveMswPath(rule: MockRule): string | RegExp {
  if (rule.rawPattern) {
    return rule.rawPattern.replace(/\[([^\]]+)\]/g, ":$1");
  }
  const source = rule.pattern.source;
  const adjusted = source.startsWith("^") ? source.slice(1) : source;
  return new RegExp(`.*${adjusted}`);
}

function resolveFixtureUrl(path: string, doc: Document): string {
  const base = doc.baseURI ?? doc.defaultView?.location?.href ?? "";
  return new URL(path, base).toString();
}

function summarizePayload(payload: JsonBodyType): Record<string, unknown> {
  if (payload == null) {
    return { type: "null" };
  }
  if (Array.isArray(payload)) {
    return { type: "array", length: payload.length };
  }
  const type = typeof payload;
  if (type === "object") {
    const keys = Object.keys(payload as Record<string, unknown>);
    return { type: "object", keys: keys.slice(0, 8), keyCount: keys.length };
  }
  return { type, value: payload };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function attachMswRequestLogs(worker: ReturnType<typeof setupWorker>, state: MswState): void {
  if (state.loggingAttached || !worker.events || typeof worker.events.on !== "function") {
    return;
  }
  state.loggingAttached = true;
  worker.events.on("request:match", (event: unknown) => {
    const request = (event as { request?: Request }).request;
    if (request && !isFixtureRequest(request.url, state)) {
      console.debug("request:match", {
        method: request.method,
        url: request.url,
        mocked: true
      });
    }
  });
}

function summarizeMswArgs(args: unknown[]): Record<string, unknown> {
  const { handlers, options } = parseMswArgs(args);
  return {
    handlerCount: handlers.length,
    options: options ? sanitizeOptions(options) : null
  };
}

function sanitizeOptions(options: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(options);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key === "serviceWorker" && value && typeof value === "object") {
      const url = (value as { url?: unknown }).url;
      sanitized[key] = { url: typeof url === "string" ? url : undefined };
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function trackFixtureUrl(state: MswState, fixtureUrl: string): void {
  state.fixtureUrls.add(fixtureUrl);
  try {
    const pathname = new URL(fixtureUrl).pathname;
    state.fixturePathnames.add(pathname);
  } catch (error) {
    return;
  }
}

function isFixtureRequest(url: string, state: MswState): boolean {
  if (state.fixtureUrls.has(url)) {
    return true;
  }
  try {
    const pathname = new URL(url).pathname;
    return state.fixturePathnames.has(pathname);
  } catch (error) {
    return false;
  }
}

function ensureHy(scope: typeof globalThis): HyLogState {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }
  return scope.hy as HyLogState;
}

function logMsw(scope: typeof globalThis, message: string, detail?: Record<string, unknown>): void {
  const hy = ensureHy(scope);
  const callbacks = hy[LOG_CALLBACK_KEY] ?? [];
  if (Array.isArray(callbacks) && callbacks.length > 0) {
    const entry = {
      type: message.startsWith("msw:error") ? "error" : "info",
      message,
      detail,
      timestamp: Date.now()
    } satisfies HyLogEntry;
    for (const callback of callbacks) {
      try {
        callback(entry);
      } catch (error) {
                  console.error("[hytde] log callback error", error);
      }
    }
    return;
  }
  if (!Array.isArray(hy[LOG_BUFFER_KEY])) {
    hy[LOG_BUFFER_KEY] = [];
  }
  (hy[LOG_BUFFER_KEY] as HyLogEntry[]).push({
    type: message.startsWith("msw:error") ? "error" : "info",
    message,
    detail,
    timestamp: Date.now()
  });
}

function pushHyError(scope: typeof globalThis, message: string, detail?: Record<string, unknown>): void {
  const hy = ensureHy(scope);
  const errors = Array.isArray(hy.errors) ? hy.errors : [];
  const nextErrors = [
    ...errors,
    {
      type: "syntax",
      message,
      detail,
      timestamp: Date.now()
    }
  ];
  hy.errors = nextErrors;
}
