import type { HyError, RuntimeGlobals } from "./types.js";
import type { RuntimeState } from "./state.js";

const SSR_STATE_ID = "hy-ssr-state";
const SSR_STATE_KEY = "__hytdeSsrState";

export type SsrPrefetchEntry = {
  path: string;
  method: string;
  status: number | null;
  headers: Record<string, string>;
  payload: unknown;
  store: string | null;
  unwrap: string | null;
  ok: boolean;
  error?: string;
};

export type SsrStatePayload = {
  mode: "ssr";
  initialState: Record<string, unknown>;
  prefetched: SsrPrefetchEntry[];
  errors: HyError[];
};

export function initSsr(doc?: Document): SsrStatePayload | null {
  const target = doc ?? (typeof document !== "undefined" ? document : null);
  if (!target) {
    return null;
  }
  const state = readSsrState(target);
  if (!state) {
    return null;
  }
  const scope = target.defaultView ?? globalThis;
  applySsrStateToGlobals(scope, state);
  return state;
}

export function readSsrState(doc: Document): SsrStatePayload | null {
  const scope = doc.defaultView ?? globalThis;
  const existing = (scope as typeof globalThis & Record<string, unknown>)[SSR_STATE_KEY] as
    | SsrStatePayload
    | undefined;
  if (existing) {
    return existing;
  }
  const script = doc.getElementById(SSR_STATE_ID);
  if (!script) {
    return null;
  }
  const raw = script.textContent ?? "";
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SsrStatePayload;
    (scope as typeof globalThis & Record<string, unknown>)[SSR_STATE_KEY] = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function applySsrStateToGlobals(scope: typeof globalThis, state: SsrStatePayload): void {
  const globals = scope as typeof globalThis & RuntimeGlobals & { hy?: { errors?: HyError[] } };
  globals.hyState = state.initialState ?? {};
  if (!globals.hy) {
    globals.hy = { loading: false, errors: [] };
  }
  if (Array.isArray(state.errors)) {
    globals.hy.errors = [...(globals.hy.errors ?? []), ...state.errors];
  }
  (globals as unknown as Record<string, unknown>)[SSR_STATE_KEY] = state;
}

export function seedPrefetchCache(state: RuntimeState, ssrState: SsrStatePayload): void {
  for (const entry of ssrState.prefetched ?? []) {
    if (entry.method !== "GET" || !entry.ok) {
      continue;
    }
    state.requestCache.set(entry.path, {
      promise: Promise.resolve(),
      payload: entry.payload,
      payloadSet: true
    });
  }
}
