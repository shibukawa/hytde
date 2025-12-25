import { createRuntime } from "@hytde/runtime";
import {
  parseDocument,
  parseHtml,
  parseSubtree,
  resolveImports
} from "@hytde/parser";

type HyLogEntry = {
  type: "render" | "request" | "error" | "info";
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
};

type HyError = {
  type: "request" | "transform" | "syntax" | "data";
  message: string;
  detail?: {
    url?: string;
    method?: string;
    status?: number;
  };
  timestamp: number;
};

const LOG_CALLBACK_KEY = "__hytdeLogCallbacks";
const LOG_BUFFER_KEY = "__hytdeLogBuffer";

export async function init(root?: Document | HTMLElement): Promise<void> {
  const doc = resolveDocument(root);
  if (!doc) {
    return;
  }

  const runtime = createRuntime({ parseDocument, parseSubtree });
  const importLogs: HyLogEntry[] = [];
  const errors = await resolveImports(doc, {
    onLog: (entry) => {
      importLogs.push(entry);
    }
  });
  const parsed = parseDocument(doc);
  runtime.init(parsed);
  if (errors.length > 0) {
    const hy = (doc.defaultView ?? globalThis).hy;
    if (hy && Array.isArray(hy.errors)) {
      const nextErrors: HyError[] = errors.map((error) => ({
        type: "request",
        message: error.message,
        detail: {
          url: error.url,
          method: error.method
        },
        timestamp: Date.now()
      }));
      hy.errors = [...hy.errors, ...nextErrors];
    }
    if (typeof console !== "undefined") {
      for (const error of errors) {
        console.error("[hytde] import error", error);
      }
    }
  }
  if (importLogs.length > 0) {
    emitBufferedLogs(doc.defaultView ?? globalThis, importLogs);
  }
}

export const hy = {
  init,
  parseHtml,
  parseDocument
};

export { parseHtml, parseDocument, parseSubtree };

function resolveDocument(root?: Document | HTMLElement): Document | null {
  if (!root) {
    return typeof document === "undefined" ? null : document;
  }

  if (root instanceof Document) {
    return root;
  }

  return root.ownerDocument;
}

function emitBufferedLogs(scope: typeof globalThis, entries: HyLogEntry[]): void {
  const hy = ensureHy(scope);
  const callbacks = hy[LOG_CALLBACK_KEY];
  if (Array.isArray(callbacks)) {
    for (const entry of entries) {
      for (const callback of callbacks) {
        try {
          callback(entry);
        } catch (error) {
          if (typeof console !== "undefined") {
            console.error("[hytde] log callback error", error);
          }
        }
      }
    }
    return;
  }
  if (!Array.isArray(hy[LOG_BUFFER_KEY])) {
    hy[LOG_BUFFER_KEY] = [];
  }
  (hy[LOG_BUFFER_KEY] as HyLogEntry[]).push(...entries);
}

type HyLogState = {
  [LOG_CALLBACK_KEY]?: Array<(entry: HyLogEntry) => void>;
  [LOG_BUFFER_KEY]?: HyLogEntry[];
};

function ensureHy(scope: typeof globalThis): HyLogState & { loading: boolean; errors: unknown[] } {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }
  return scope.hy as unknown as HyLogState & { loading: boolean; errors: unknown[] };
}
