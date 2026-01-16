import { createHyError, pushError } from "../errors/ui.js";
import type { HyLogEntry } from "../types.js";
import type { RuntimeState } from "../state.js";

export function emitLog(state: RuntimeState, entry: HyLogEntry): void {
  for (const callback of state.logCallbacks) {
    try {
      callback(entry);
    } catch (error) {
      console.error("[hytde] log callback error", error);
    }
  }
}

export function emitTransformError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("transform", message, detail));
  console.error("[hytde] transform error", message, detail);
}

export function emitExpressionError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("syntax", message, detail));
  console.error("[hytde] expression error", message, detail);
}

export function emitRenderComplete(state: RuntimeState): void {
  for (const callback of state.renderCallbacks) {
    try {
      callback();
    } catch (error) {
      console.error("[hytde] render callback error", error);
    }
  }
}
