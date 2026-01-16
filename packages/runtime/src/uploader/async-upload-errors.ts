import { createHyError, pushError } from "../errors/ui.js";
import { emitLog } from "../utils/logging.js";
import type { RuntimeState } from "../state.js";

export function emitAsyncUploadError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("syntax", message, detail));
  console.error("[hytde] async-upload error", message, detail);
}
