import type { IrDocument } from "@hytde/runtime";
import { createRuntime, initHyPathParams } from "@hytde/runtime";
import { compactIrDocument, parseDocumentToIr, parseHtml, parseSubtree, resolveImports } from "@hytde/parser";
import { ensureExtableStylesheet, ensureTableApiStub } from "./table-support";

const LOG_CALLBACK_KEY = "__hytdeLogCallbacks";
const LOG_BUFFER_KEY = "__hytdeLogBuffer";
const MSW_STATE_KEY = "__hytdeMswState";
const INIT_DONE_KEY = "__hytdeInitDone";

type HyLogEntry = {
  type: "render" | "request" | "error" | "info";
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
};

type HyError = {
  type: "request" | "transform" | "syntax" | "data";
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
};

type HyLogState = {
  [LOG_CALLBACK_KEY]?: Array<(entry: HyLogEntry) => void>;
  [LOG_BUFFER_KEY]?: HyLogEntry[];
  [MSW_STATE_KEY]?: { start?: (mode: "production" | "mock" | "disable") => Promise<void> | void; started?: boolean };
  __hytdeRegisterMswMetaHandlers?: (rules: unknown[], doc: Document) => Promise<void>;
  __hytdeInitDone?: boolean;
  mockServiceWorker?: (...args: unknown[]) => void | Promise<void>;
};

export async function init(root?: Document | HTMLElement): Promise<void> {
  const doc = resolveDocument(root);
  if (!doc) {
    return;
  }
  const scope = doc.defaultView ?? globalThis;
  ensureTableApiStub(scope);
  console.debug("[hytde] runtime:parse:start", { readyState: doc.readyState });

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
  const runtimeIr = compactIrDocument(ir) as IrDocument;
  const tableCount = ir.executionMode === "disable" ? 0 : ir.tables.length;
  console.info("[hytde] runtime:parse:complete", {
    mode: ir.executionMode,
    mockRules: ir.mockRules.length,
    requestTargets: ir.requestTargets.length,
    tableMarkers: tableCount
  });
  const parseErrors = Array.isArray(ir.parseErrors) ? ir.parseErrors : [];
  if (parseErrors.length > 0) {
    const hy = ensureHy(doc.defaultView ?? globalThis);
    const nextErrors: HyError[] = parseErrors.map((error) => ({
      type: "syntax",
      message: error.message,
      detail: error.detail,
      timestamp: Date.now()
    }));
    hy.errors = [...hy.errors, ...nextErrors];
    for (const error of parseErrors) {
      console.error("[hytde] parse error", error.message, error.detail);
    }
  }
  if (ir.executionMode !== "disable" && tableCount > 0) {
    ensureExtableStylesheet(doc);
  }
  const hasSsrState = Boolean(doc.getElementById("hy-ssr-state"));
  if (!hasSsrState) {
    await registerMetaMockHandlers(doc, ir);
    await startMockServiceWorkerIfNeeded(doc, ir.executionMode);
  } else {
    console.info("[hytde] runtime:msw:skip", { reason: "ssr" });
  }
  console.debug("[hytde] runtime:data:initial", { requests: ir.requestTargets.length });
  runtime.init(doc, runtimeIr);
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

async function startMockServiceWorkerIfNeeded(
  doc: Document,
  executionMode: "production" | "mock" | "disable"
): Promise<void> {
  const scope = doc.defaultView ?? globalThis;
  const hy = ensureHy(scope) as HyLogState;
  const mswState = hy[MSW_STATE_KEY];
  const start = mswState?.start;
  const pendingStart =
    (mswState as { pendingStart?: boolean } | undefined)?.pendingStart ?? false;
  console.info("[hytde] runtime:msw:start", {
    hasState: !!mswState,
    hasStart: typeof start === "function",
    mode: executionMode,
    mswStarted: mswState?.started ?? false,
    pendingStart
  });
  if (typeof start === "function") {
    await start(executionMode);
  } else {
    console.info("[hytde] runtime:msw:start:skip", { reason: "no-start" });
  }
  if (executionMode === "mock" && !mswState?.started) {
    const error = {
      type: "request",
      message: "Mocking requires MSW, but the service worker did not start.",
      detail: { mode: executionMode },
      timestamp: Date.now()
    };
    const errorTarget = hy as HyLogState & { errors?: unknown[] };
    if (Array.isArray(errorTarget.errors)) {
      errorTarget.errors = [...errorTarget.errors, error];
    }
    console.error("[hytde] MSW failed to start; mocks are disabled.");
  }
}

async function registerMetaMockHandlers(doc: Document, ir: { executionMode: string; mockRules: unknown[] }): Promise<void> {
  if (ir.executionMode !== "mock") {
    console.debug("[hytde] runtime:msw:register:skip", { reason: "mode", mode: ir.executionMode });
    return;
  }
  const scope = doc.defaultView ?? globalThis;
  const hy = ensureHy(scope) as HyLogState & {
    __hytdeRegisterMswMetaHandlers?: (rules: unknown[], doc: Document) => Promise<void>;
  };
  const register = hy.__hytdeRegisterMswMetaHandlers;
  console.debug("[hytde] runtime:msw:register:start", {
    hasRegister: typeof register === "function",
    mockCount: ir.mockRules.length
  });
  if (typeof register === "function") {
    await register(ir.mockRules, doc);
    console.debug("[hytde] runtime:msw:register:complete", {
      handlerCount: ir.mockRules.length
    });
  }
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
  const hy = ensureHy(scope) as HyLogState;
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

function ensureHy(scope: typeof globalThis): HyLogState & { loading: boolean; errors: unknown[] } {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }
  return scope.hy as HyLogState & { loading: boolean; errors: unknown[] };
}

const globalScope = typeof globalThis !== "undefined" ? globalThis : undefined;
if (globalScope) {
  ensureTableApiStub(globalScope);
}
