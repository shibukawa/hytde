import { createRuntime, initHyPathParams } from "@hytde/runtime";
import {
  parseDocumentToIr,
  parseHtml,
  parseSubtree,
  resolveImports
} from "@hytde/parser";
import {
  ensureExtableStylesheet,
  ensureTableApiStub
} from "./table-support";

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
const INIT_DONE_KEY = "__hytdeInitDone";
export async function init(root?: Document | HTMLElement): Promise<void> {
  const doc = resolveDocument(root);
  if (!doc) {
    return;
  }

  const scope = doc.defaultView ?? globalThis;
  ensureTableApiStub(scope);
  const mode = doc.querySelector('meta[name="hy-mode"]')?.getAttribute("content")?.trim();

  initHyPathParams(doc);
  const runtime = createRuntime({
    parseDocument: () => {
      throw new Error("parseDocument is not available in IR runtime.");
    },
    parseSubtree
  });
  const importLogs: HyLogEntry[] = [];
  const errors = await resolveImports(doc, {
    onLog: (entry) => {
      importLogs.push(entry);
    }
  });
  const ir = parseDocumentToIr(doc);
  if (mode !== "disable" && ir.tables.length > 0) {
    ensureExtableStylesheet(doc);
  }
  runtime.init(doc, ir);
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
    for (const error of errors) {
      console.error("[hytde] import error", error);
    }
  }
  if (importLogs.length > 0) {
    emitBufferedLogs(doc.defaultView ?? globalThis, importLogs);
  }
  const hy = ensureHy(doc.defaultView ?? globalThis);
  hy[INIT_DONE_KEY] = true;
}

export const hy = {
  init,
  parseHtml,
  parseDocumentToIr
};

export { parseHtml, parseDocumentToIr, parseSubtree };

const globalScope = typeof globalThis !== "undefined" ? globalThis : undefined;
if (globalScope) {
  ensureTableApiStub(globalScope);
}

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
          console.error("[hytde] log callback error", error);
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
  [INIT_DONE_KEY]?: boolean;
};

function ensureHy(scope: typeof globalThis): HyLogState & { loading: boolean; errors: unknown[] } {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }
  return scope.hy as unknown as HyLogState & { loading: boolean; errors: unknown[] };
}
