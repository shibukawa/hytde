import { createRuntime, initHyPathParams } from "@hytde/runtime";
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
const TABLE_REGISTRY_KEY = "__hytdeTableRegistry";
const EXTABLE_STYLE_MARKER = "data-hytde-extable-style";
const EXTABLE_STYLE_RELATIVE_PATH = "./extable.css";

type TableRegistry = {
  formulaRegistry: Map<string, Map<string, unknown>>;
  conditionalStyleRegistry: Map<string, Map<string, unknown>>;
};

type TableApi = {
  formula: <T>(tableId: string, columnKey: string, formula: T) => void;
  conditionalStyle: <R>(tableId: string, columnKey: string, styleRule: R) => void;
};

export async function init(root?: Document | HTMLElement): Promise<void> {
  const doc = resolveDocument(root);
  if (!doc) {
    return;
  }

  const scope = doc.defaultView ?? globalThis;
  ensureTableApiStub(scope);
  const mode = doc.querySelector('meta[name="hy-mode"]')?.getAttribute("content")?.trim();

  initHyPathParams(doc);
  const runtime = createRuntime({ parseDocument, parseSubtree });
  const importLogs: HyLogEntry[] = [];
  const errors = await resolveImports(doc, {
    onLog: (entry) => {
      importLogs.push(entry);
    }
  });
  const parsed = parseDocument(doc);
  if (mode !== "disable" && doc.querySelector("table[hy-table-data]")) {
    ensureExtableStylesheet(doc);
    await ensureExtableBundle(scope);
  }
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

function ensureTableApiStub(scope: typeof globalThis): void {
  const hy = ensureHy(scope) as HyLogState & {
    loading: boolean;
    errors: unknown[];
    table?: TableApi;
  };
  if (hy.table) {
    return;
  }
  const registry = getTableRegistry(scope);
  hy.table = {
    formula: (tableId, columnKey, formula) => {
      registerTableEntry(registry.formulaRegistry, tableId, columnKey, formula);
    },
    conditionalStyle: (tableId, columnKey, styleRule) => {
      registerTableEntry(registry.conditionalStyleRegistry, tableId, columnKey, styleRule);
    }
  };
}

function getTableRegistry(scope: typeof globalThis): TableRegistry {
  const holder = scope as typeof globalThis & { [TABLE_REGISTRY_KEY]?: TableRegistry };
  if (!holder[TABLE_REGISTRY_KEY]) {
    holder[TABLE_REGISTRY_KEY] = {
      formulaRegistry: new Map(),
      conditionalStyleRegistry: new Map()
    };
  }
  return holder[TABLE_REGISTRY_KEY] as TableRegistry;
}

function registerTableEntry(
  registryMap: Map<string, Map<string, unknown>>,
  tableId: string,
  columnKey: string,
  value: unknown
): void {
  if (!tableId || !columnKey) {
    return;
  }
  const tableKey = tableId.trim();
  const columnKeyTrimmed = columnKey.trim();
  if (!tableKey || !columnKeyTrimmed) {
    return;
  }
  let tableMap = registryMap.get(tableKey);
  if (!tableMap) {
    tableMap = new Map();
    registryMap.set(tableKey, tableMap);
  }
  tableMap.set(columnKeyTrimmed, value);
}

function ensureExtableStylesheet(doc: Document): void {
  if (!isStandaloneRuntimeUrl()) {
    return;
  }
  if (doc.querySelector(`link[${EXTABLE_STYLE_MARKER}]`)) {
    return;
  }
  if (doc.querySelector('link[rel="stylesheet"][href*="extable"]')) {
    return;
  }
  const head = doc.head ?? doc.querySelector("head");
  if (!head) {
    return;
  }
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = resolveExtableStylesheetUrl();
  link.setAttribute(EXTABLE_STYLE_MARKER, "true");
  head.append(link);
}

async function ensureExtableBundle(scope: typeof globalThis): Promise<void> {
  const holder = scope as typeof globalThis & { ExtableCore?: unknown };
  if (typeof holder.ExtableCore === "function") {
    return;
  }
  await import("@hytde/extable-bundle");
}

function isStandaloneRuntimeUrl(): boolean {
  try {
    const url = new URL(import.meta.url);
    return url.pathname.includes("/standalone/") || url.pathname.includes("@hytde/standalone");
  } catch {
    return false;
  }
}

function resolveExtableStylesheetUrl(): string {
  const defaultUrl = new URL(EXTABLE_STYLE_RELATIVE_PATH, import.meta.url);
  if (!defaultUrl.pathname.includes("/src/")) {
    return defaultUrl.toString();
  }
  const distUrl = new URL(import.meta.url);
  distUrl.pathname = distUrl.pathname.replace("/src/", "/dist/");
  if (distUrl.pathname.endsWith("/index.ts")) {
    distUrl.pathname = distUrl.pathname.replace("/index.ts", "/extable.css");
    return distUrl.toString();
  }
  if (distUrl.pathname.endsWith("/index.js")) {
    distUrl.pathname = distUrl.pathname.replace("/index.js", "/extable.css");
    return distUrl.toString();
  }
  return defaultUrl.toString();
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
