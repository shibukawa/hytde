const TABLE_REGISTRY_KEY = "__hytdeTableRegistry";
const INIT_DONE_KEY = "__hytdeInitDone";
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

type HyTableState = {
  loading: boolean;
  errors: unknown[];
  [INIT_DONE_KEY]?: boolean;
  table?: TableApi;
};

export function ensureTableApiStub(scope: typeof globalThis): void {
  const hy = ensureHy(scope);
  if (hy.table) {
    return;
  }
  const registry = getTableRegistry(scope);
  hy.table = {
    formula: (tableId, columnKey, formula) => {
      registerTableEntry(scope, registry.formulaRegistry, tableId, columnKey, formula);
    },
    conditionalStyle: (tableId, columnKey, styleRule) => {
      registerTableEntry(scope, registry.conditionalStyleRegistry, tableId, columnKey, styleRule);
    }
  };
}

export function ensureExtableStylesheet(doc: Document): void {
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

function ensureHy(scope: typeof globalThis): HyTableState {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }
  return scope.hy as HyTableState;
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
  scope: typeof globalThis,
  registryMap: Map<string, Map<string, unknown>>,
  tableId: string,
  columnKey: string,
  value: unknown
): void {
  if (isInitDone(scope)) {
    console.error("[hytde] hy.table registration must run before DOMContentLoaded. Do not use defer/async.");
    return;
  }
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

function isInitDone(scope: typeof globalThis): boolean {
  const hy = scope.hy as HyTableState | undefined;
  return Boolean(hy?.[INIT_DONE_KEY]);
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
  const distUrl = new URL(defaultUrl.toString());
  distUrl.pathname = distUrl.pathname.replace("/src/", "/dist/");
  return distUrl.toString();
}
