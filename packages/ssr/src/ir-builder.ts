import type { HyError } from "@hytde/runtime";
import type { PrefetchEntry, SsrState } from "./types.js";

export function buildSsrState(params: {
  prefetched: PrefetchEntry[];
  initialState: Record<string, unknown>;
  errors: HyError[];
}): SsrState {
  return {
    mode: "ssr",
    prefetched: params.prefetched,
    initialState: params.initialState,
    errors: params.errors
  };
}

export function createRequestError(message: string, detail?: Record<string, unknown>): HyError {
  return {
    type: "request",
    message,
    detail,
    timestamp: Date.now()
  };
}
