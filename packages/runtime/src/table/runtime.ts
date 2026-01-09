import type { ColumnSchema, CoreInit, CoreOptions, ExtableCore, Schema } from "@extable/core";
import { ensureExtableCore } from "./loader";
import { resolvePath } from "../utils/path";
import { parseSelectorTokens } from "../utils/selectors";
import { createHyError, pushError } from "../errors/ui";
import type { HyError, HyGlobals, HytdePlugin, PluginParseContext, PluginRenderContext, PluginState } from "../types";
import type { RuntimeState } from "../state";

type TableRegistry = {
  formulaRegistry: Map<string, Map<string, unknown>>;
  conditionalStyleRegistry: Map<string, Map<string, unknown>>;
};

type TableApi = {
  formula: <T>(tableId: string, columnKey: string, formula: T) => void;
  conditionalStyle: <R>(tableId: string, columnKey: string, styleRule: R) => void;
};

type HyWithTable = HyGlobals & { table?: TableApi } & Record<string, unknown>;

type ColumnDefinition = ColumnSchema<Record<string, unknown>>;
type TableSchema = Schema<Record<string, unknown>>;

type ExtableInstance = ExtableCore<Record<string, unknown>, Record<string, unknown>>;
type ExtableConstructor = new (init: CoreInit<Record<string, unknown>>) => ExtableInstance;

type TableDefinition = {
  tableId: string;
  dataPath: string | null;
  options: CoreOptions;
  columns: ColumnDefinition[];
  bindShortcut: boolean;
};

type TableInstance = {
  tableId: string;
  table: HTMLTableElement;
  host: HTMLElement;
  extable: ExtableInstance;
  removeShortcut: (() => void) | undefined;
};

type TablePluginState = {
  instances: Map<string, TableInstance>;
};

const TABLE_REGISTRY_KEY = "__hytdeTableRegistry";

let tablePlugin: HytdePlugin | null = null;

export function ensureTablePlugin(
  scope: typeof globalThis,
  getRuntimeStateForDoc: (doc: Document) => RuntimeState | undefined
): void {
  const hy = ensureHy(scope);
  const plugins = hy.plugins as HytdePlugin[];
  if (!tablePlugin) {
    tablePlugin = createTablePlugin(getRuntimeStateForDoc);
  }
  for (const plugin of plugins) {
    if (plugin.name === tablePlugin.name) {
      return;
    }
  }
  plugins.push(tablePlugin);
}

export function ensureTableApi(scope: typeof globalThis): TableApi {
  const hy = ensureHy(scope);
  if (hy.table) {
    return hy.table;
  }
  getTableRegistry(scope);
  const api: TableApi = {
    formula: (tableId, columnKey, formula) => {
      registerTableEntry(getTableRegistry(scope).formulaRegistry, tableId, columnKey, formula);
    },
    conditionalStyle: (tableId, columnKey, styleRule) => {
      registerTableEntry(getTableRegistry(scope).conditionalStyleRegistry, tableId, columnKey, styleRule);
    }
  };
  hy.table = api;
  return api;
}

function createTablePlugin(getRuntimeStateForDoc: (doc: Document) => RuntimeState | undefined): HytdePlugin {
  return {
    name: "extable-table",
    onParse: (context: PluginParseContext) => {
      const scope = context.doc.defaultView ?? globalThis;
      ensureTableApi(scope);
      return { state: { instances: new Map() } satisfies TablePluginState };
    },
    onRender: (context: PluginRenderContext, state: PluginState) => {
      if (context.reason !== "init") {
        return;
      }
      if (!context.doc) {
        return;
      }
      const runtimeState = getRuntimeStateForDoc(context.doc);
      if (!runtimeState) {
        return;
      }
      const scope = context.doc.defaultView ?? globalThis;
      void initializeTables(context.doc, scope, runtimeState, state as TablePluginState);
    },
    onDispose: (_context: PluginRenderContext, state: PluginState) => {
      const pluginState = state as TablePluginState | undefined;
      if (!pluginState) {
        return;
      }
      for (const instance of pluginState.instances.values()) {
        if (instance.removeShortcut) {
          instance.removeShortcut();
        }
        instance.extable.destroy();
      }
      pluginState.instances.clear();
    }
  };
}

function ensureHy(scope: typeof globalThis): HyWithTable {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }
  const hy = scope.hy as HyWithTable;
  if (!Array.isArray(hy.errors)) {
    hy.errors = [];
  }
  if (!Array.isArray(hy.plugins)) {
    hy.plugins = [];
  }
  return hy;
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

async function initializeTables(
  _doc: Document,
  scope: typeof globalThis,
  state: RuntimeState,
  pluginState: TablePluginState
): Promise<void> {
  emitTableDiagnostics(state);
  const tables = state.parsed.tables;
  if (tables.length === 0) {
    return;
  }
  await ensureExtableCore(scope);

  const registry = getTableRegistry(scope);
  const columnKeysByTable = new Map<string, Set<string>>();

  for (const entry of tables) {
    const tableId = entry.tableId;
    if (!tableId || pluginState.instances.has(tableId)) {
      continue;
    }
    const table = entry.table;
    const columns: ColumnDefinition[] = entry.columns.map((column) => ({ ...column }));
    if (columns.length === 0) {
      continue;
    }
    const columnKeys = new Set(columns.map((column) => column.key));
    columnKeysByTable.set(tableId, columnKeys);

    const formulaRegistry = registry.formulaRegistry.get(tableId);
    const conditionalRegistry = registry.conditionalStyleRegistry.get(tableId);
    let mergedFormulas = 0;
    let mergedConditionalStyles = 0;

    for (const column of columns) {
      const formula = formulaRegistry ? formulaRegistry.get(column.key) : undefined;
      if (typeof formula === "function") {
        column.formula = formula as ColumnDefinition["formula"];
        mergedFormulas += 1;
      }
      const conditionalStyle = conditionalRegistry ? conditionalRegistry.get(column.key) : undefined;
      if (typeof conditionalStyle === "function") {
        column.conditionalStyle = conditionalStyle as ColumnDefinition["conditionalStyle"];
        mergedConditionalStyles += 1;
      }
    }

    const tableDefinition: TableDefinition = {
      tableId,
      dataPath: entry.dataPath,
      options: entry.options,
      columns,
      bindShortcut: entry.bindShortcut
    };
    const instance = mountTable(tableDefinition, table, scope, state, mergedFormulas, mergedConditionalStyles);
    if (!instance) {
      continue;
    }
    pluginState.instances.set(tableId, instance);
  }

  emitRegistryDiagnostics(state, scope, columnKeysByTable);
}

function mountTable(
  definition: TableDefinition,
  table: HTMLTableElement,
  scope: typeof globalThis,
  state: RuntimeState,
  mergedFormulas: number,
  mergedConditionalStyles: number
): TableInstance | null {
  const ExtableCtor = resolveExtableConstructor(scope);
  if (!ExtableCtor) {
    pushTableDiagnostic(state, "ExtableCore is not available on the global scope.", {
      context: definition.tableId
    });
    return null;
  }

  const schema: TableSchema = {
    columns: definition.columns
  };

  const host = table.ownerDocument.createElement("div");
  host.dataset.hyTableId = definition.tableId;
  if (table.className) {
    host.className = table.className;
  }
  const styleAttr = table.getAttribute("style");
  if (styleAttr) {
    host.setAttribute("style", styleAttr);
  }

  const resolvedData = resolveDataPath(definition.dataPath, scope);
  const defaultData = Array.isArray(resolvedData) ? resolvedData : null;
  const extable = new ExtableCtor({
    root: host,
    schema,
    defaultData,
    defaultView: {},
    options: definition.options
  }) as ExtableInstance;

  table.replaceWith(host);

  if (mergedFormulas > 0 || mergedConditionalStyles > 0) {
    console.debug(
      "[hytde] table schema merged",
      definition.tableId,
      `formulas=${mergedFormulas}`,
      `conditionalStyles=${mergedConditionalStyles}`
    );
  } else {
    console.debug("[hytde] table schema initialized", definition.tableId, `columns=${schema.columns.length}`);
  }

  const instance: TableInstance = {
    tableId: definition.tableId,
    table,
    host,
    extable,
    removeShortcut: undefined
  };

  if (definition.bindShortcut) {
    instance.removeShortcut = bindSearchShortcut(scope, host, extable, definition.tableId);
  }

  return instance;
}

function resolveExtableConstructor(scope: typeof globalThis): ExtableConstructor | null {
  const maybe = (scope as typeof globalThis & { ExtableCore?: ExtableConstructor }).ExtableCore;
  return typeof maybe === "function" ? maybe : null;
}

function bindSearchShortcut(
  _scope: typeof globalThis,
  host: HTMLElement,
  instance: ExtableInstance | null,
  tableId: string
): (() => void) | undefined {
  if (!instance) {
    return undefined;
  }

  const doc = host.ownerDocument;
  const keydownHandler = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    if (event.key.toLowerCase() !== "f") {
      return;
    }
    event.preventDefault();
    console.debug("[hytde] table shortcut triggered", tableId);
    let columnKey = instance.getSelectionSnapshot().activeColumnKey;
    if (!columnKey) {
      const columns = instance.getSchema().columns;
      if (columns.length > 0) {
        columnKey = columns[0].key;
      }
    }
    if (!columnKey) {
      return;
    }
    instance.toggleFilterSortPanel(columnKey);
  };

  doc.addEventListener("keydown", keydownHandler);
  console.debug("[hytde] table shortcut bound", tableId);

  return () => {
    doc.removeEventListener("keydown", keydownHandler);
    console.debug("[hytde] table shortcut unbound", tableId);
  };
}

function resolveDataPath(path: string | null, scope: typeof globalThis): unknown {
  if (!path) {
    return null;
  }
  const tokens = parseSelectorTokens(path);
  if (tokens.length === 0) {
    return null;
  }
  const first = tokens[0];
  if (first === "hyState") {
    return resolvePath(scope.hyState, tokens.slice(1));
  }
  if (first === "hyParams") {
    return resolvePath(scope.hyParams, tokens.slice(1));
  }
  if (first === "hy") {
    return resolvePath(scope.hy, tokens.slice(1));
  }
  return resolvePath(scope.hyState, tokens);
}

function emitRegistryDiagnostics(
  state: RuntimeState,
  scope: typeof globalThis,
  columnsByTable: Map<string, Set<string>>
): void {
  const registry = getTableRegistry(scope);
  for (const [tableId, columnMap] of registry.formulaRegistry) {
    if (!columnsByTable.has(tableId)) {
      pushTableDiagnostic(state, `Formula registration targets unknown table "${tableId}".`, {
        context: tableId,
        attribute: "hy.table.formula"
      });
      continue;
    }
    const columns = columnsByTable.get(tableId) as Set<string>;
    for (const columnKey of columnMap.keys()) {
      if (!columns.has(columnKey)) {
        pushTableDiagnostic(state, `Formula registration targets unknown column "${columnKey}".`, {
          context: tableId,
          attribute: "hy.table.formula"
        });
      }
    }
  }

  for (const [tableId, columnMap] of registry.conditionalStyleRegistry) {
    if (!columnsByTable.has(tableId)) {
      pushTableDiagnostic(state, `Conditional style registration targets unknown table "${tableId}".`, {
        context: tableId,
        attribute: "hy.table.conditionalStyle"
      });
      continue;
    }
    const columns = columnsByTable.get(tableId) as Set<string>;
    for (const columnKey of columnMap.keys()) {
      if (!columns.has(columnKey)) {
        pushTableDiagnostic(state, `Conditional style registration targets unknown column "${columnKey}".`, {
          context: tableId,
          attribute: "hy.table.conditionalStyle"
        });
      }
    }
  }
}

function emitTableDiagnostics(state: RuntimeState): void {
  for (const diagnostic of state.parsed.tableDiagnostics) {
    pushTableDiagnostic(state, diagnostic.message, diagnostic.detail);
  }
}

function pushTableDiagnostic(state: RuntimeState, message: string, detail?: HyError["detail"]): void {
  pushError(state, createHyError("data", message, detail));
}
