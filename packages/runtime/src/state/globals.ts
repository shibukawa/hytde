import { parseHyPathMeta } from "../parse/hy-path.js";
import { parseParams, parseSearchParams, parseHashParams } from "../parse/params.js";
import { normalizePathPattern, stripQueryHash } from "../utils/path-pattern.js";
import { ensureDefaultTransforms, installTransformApi } from "./transforms.js";
import { initSsr } from "../ssr.js";
import type { HyGlobals, HyLogEntry, RuntimeGlobals } from "../types.js";
import type { HyPathDiagnostics, HyPathMeta } from "../state.js";
import { emitLog } from "../utils/logging.js";
import type { RuntimeState } from "../state.js";

export const RENDER_CALLBACK_KEY = "__hytdeRenderCallbacks";
export const LOG_CALLBACK_KEY = "__hytdeLogCallbacks";
const PATH_DIAGNOSTIC_KEY = "__hytdePathDiagnostics";

export function initHyPathParams(doc: Document): void {
  const view = doc.defaultView;
  if (!view) {
    return;
  }
  const meta = parseHyPathMeta(doc);
  const { params, diagnostics } = resolveHyParamsForLocation(view.location, meta);
  const merged = { ...(view.hyParams ?? {}), ...params };
  view.hyParams = merged;
  if (!view.hy) {
    view.hy = { loading: false, errors: [] };
  }
  const hy = view.hy as HyGlobals & Record<string, unknown>;
  hy.pathParams = merged;
  (view as unknown as Record<string, unknown>)[PATH_DIAGNOSTIC_KEY] = diagnostics;
}

export function ensureGlobals(scope: typeof globalThis): RuntimeGlobals {
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
  if (!hy.initSsr) {
    hy.initSsr = () => {
      const doc = scope.document ?? (typeof document !== "undefined" ? document : null);
      if (doc) {
        initSsr(doc);
      }
    };
  }
  if (!Array.isArray(hy.uploading)) {
    hy.uploading = [];
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

export function resolveHyParamsForLocation(
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

export function syncHyPathParams(state: RuntimeState): void {
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

export function emitPathDiagnostics(state: RuntimeState): void {
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

export function ensureCallbackStore(target: Record<string, unknown>, key: string): unknown[] {
  const existing = target[key];
  if (Array.isArray(existing)) {
    return existing;
  }
  const created: unknown[] = [];
  target[key] = created;
  return created;
}

export function refreshHyParams(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  syncHyPathParams(state);
}

function shouldUseHashParams(pathname: string, template: string | null): boolean {
  if (!template) {
    return true;
  }
  return normalizePathPattern(pathname) === normalizePathPattern(template);
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
    if (part === value) {
      continue;
    }
    if (!part.includes("[")) {
      return { params: {}, matched: false };
    }
    const names: string[] = [];
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexSource = escaped.replace(/\\\[([^\]]+)\\\]/g, (_raw, name) => {
      names.push(name);
      return "([^/]+)";
    });
    const regex = new RegExp(`^${regexSource}$`);
    const match = regex.exec(value);
    if (!match) {
      return { params: {}, matched: false };
    }
    names.forEach((name, nameIndex) => {
      params[name] = decodeURIComponent(match[nameIndex + 1] ?? "");
    });
  }
  return { params, matched: true };
}
