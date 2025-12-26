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
};

const LOG_CALLBACK_KEY = "__hytdeLogCallbacks";

export function registerDebugLogger(): void {
  const scope = globalThis as typeof globalThis & { hy?: HyLogState };
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }

  const hy = scope.hy;
  const callbacks = Array.isArray(hy[LOG_CALLBACK_KEY]) ? hy[LOG_CALLBACK_KEY] : [];
  if (!Array.isArray(hy[LOG_CALLBACK_KEY])) {
    hy[LOG_CALLBACK_KEY] = callbacks;
  }

  callbacks.push((entry) => {
    if (typeof console === "undefined") {
      return;
    }
    if (entry.type === "error") {
      console.error("[hytde]", entry.message, entry.detail ?? {});
      return;
    }
    console.log("[hytde]", entry.type, entry.message, entry.detail ?? {});
  });
}
