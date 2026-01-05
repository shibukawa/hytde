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

type HyTableState = {
  loading: boolean;
  errors: unknown[];
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
      registerTableEntry(registry.formulaRegistry, tableId, columnKey, formula);
    },
    conditionalStyle: (tableId, columnKey, styleRule) => {
      registerTableEntry(registry.conditionalStyleRegistry, tableId, columnKey, styleRule);
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

export function countTableMarkers(doc: Document): number {
  return doc.querySelectorAll("table[hy-table-data]").length;
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
