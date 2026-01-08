import type { ColumnSchema, ColumnType, CoreInit, CoreOptions, ExtableCore, Schema } from "@extable/core";
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
  doc: Document,
  scope: typeof globalThis,
  state: RuntimeState,
  pluginState: TablePluginState
): Promise<void> {
  const tables = Array.from(doc.querySelectorAll("table[hy-table-data]")) as HTMLTableElement[];
  if (tables.length === 0) {
    return;
  }
  await ensureExtableCore(scope);

  const tableIdGroups = new Map<string, HTMLTableElement[]>();
  const registry = getTableRegistry(scope);
  for (const table of tables) {
    const rawId = table.getAttribute("hy-table-data") ?? "";
    const tableId = rawId.trim();
    if (!tableId) {
      pushTableDiagnostic(state, "hy-table-data is required for table enhancement.", {
        attribute: "hy-table-data",
        selector: buildTableSelector(rawId)
      });
      continue;
    }
    const list = tableIdGroups.get(tableId);
    if (list) {
      list.push(table);
    } else {
      tableIdGroups.set(tableId, [table]);
    }
  }

  const columnKeysByTable = new Map<string, Set<string>>();

  for (const [tableId, group] of tableIdGroups) {
    if (group.length > 1) {
      for (const table of group) {
        pushTableDiagnostic(state, `Duplicate hy-table-data value "${tableId}" detected.`, {
          attribute: "hy-table-data",
          selector: buildTableSelector(tableId)
        });
      }
      continue;
    }
    const table = group[0];
    if (pluginState.instances.has(tableId)) {
      continue;
    }

    const headerRow = findHeaderRow(table);
    if (!headerRow) {
      pushTableDiagnostic(state, "Table header row (<thead><th>) is required for extable enhancement.", {
        attribute: "hy-table-data",
        selector: buildTableSelector(tableId)
      });
      continue;
    }

    const columns = parseColumns(tableId, headerRow, state);
    if (columns.length === 0) {
      pushTableDiagnostic(state, "No valid columns were found for table enhancement.", {
        attribute: "hy-column",
        selector: buildTableSelector(tableId)
      });
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

    const tableDefinition = buildTableDefinition(tableId, table, columns, state);
    const instance = mountTable(tableDefinition, table, scope, state, mergedFormulas, mergedConditionalStyles);
    if (!instance) {
      continue;
    }
    pluginState.instances.set(tableId, instance);
  }

  emitRegistryDiagnostics(state, scope, columnKeysByTable);
}

function findHeaderRow(table: HTMLTableElement): HTMLTableRowElement | null {
  const thead = table.querySelector("thead");
  if (!thead) {
    return null;
  }
  const rows = Array.from(thead.querySelectorAll("tr"));
  for (const row of rows) {
    const hasTh = Array.from(row.children).some((child) => child.tagName === "TH");
    if (hasTh) {
      return row as HTMLTableRowElement;
    }
  }
  return null;
}

function parseColumns(tableId: string, row: HTMLTableRowElement, state: RuntimeState): ColumnDefinition[] {
  const columns: ColumnDefinition[] = [];
  const cells = Array.from(row.children).filter((child) => child.tagName === "TH") as HTMLTableCellElement[];
  for (const cell of cells) {
    const columnDefinition = parseColumnDefinition(tableId, cell, state);
    if (!columnDefinition) {
      continue;
    }
    columns.push(columnDefinition);
  }
  return columns;
}

function parseColumnDefinition(
  tableId: string,
  cell: HTMLTableCellElement,
  state: RuntimeState
): ColumnDefinition | null {
  const columnAttr = cell.getAttribute("hy-column") ?? "";
  const declarations = parseDeclarationList(columnAttr);
  const key = declarations.find((entry) => entry.key === "key")?.value ?? "";
  if (!key) {
    pushTableDiagnostic(state, "hy-column requires a key entry.", {
      attribute: "hy-column",
      selector: buildTableSelector(tableId),
      context: cell.textContent ? cell.textContent.trim() : ""
    });
    return null;
  }

  const typeValue = declarations.find((entry) => entry.key === "type")?.value;
  const type = parseColumnType(typeValue ? typeValue.trim() : "");
  const format = declarations.find((entry) => entry.key === "format")?.value;
  const header = (cell.textContent ?? "").trim();
  const width = resolveWidth(cell);

  return {
    key,
    type,
    header: header || undefined,
    width,
    format: format ? format.trim() : undefined
  };
}

function parseColumnType(typeValue: string): ColumnType {
  switch (typeValue) {
    case "number":
    case "date":
    case "boolean":
    case "string":
      return typeValue;
    default:
      return "string";
  }
}

function resolveWidth(cell: HTMLTableCellElement): number | undefined {
  const styleAttr = cell.getAttribute("style") ?? "";
  const declarations = parseDeclarationList(styleAttr);
  const styleWidth = declarations.find((entry) => entry.key === "width")?.value;
  const widthAttr = cell.getAttribute("width")?.trim();
  const rawWidth = styleWidth || widthAttr;
  if (!rawWidth) {
    return undefined;
  }
  const parsed = Number.parseFloat(rawWidth);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildTableDefinition(
  tableId: string,
  table: HTMLTableElement,
  columns: ColumnDefinition[],
  state: RuntimeState
): TableDefinition {
  const dataPath = tableId.trim() || null;
  const parsedOptions = parseOptions(tableId, table, state);

  return {
    tableId,
    dataPath,
    options: parsedOptions.options,
    columns,
    bindShortcut: parsedOptions.bindShortcut
  };
}

function parseOptions(
  tableId: string,
  table: HTMLTableElement,
  state: RuntimeState
): { options: CoreOptions; bindShortcut: boolean } {
  const options: CoreOptions = {};
  let bindShortcut = false;
  const raw = table.getAttribute("hy-table-option") ?? "";
  const declarations = parseDeclarationList(raw);
  for (const entry of declarations) {
    const key = entry.key.toLowerCase();
    if (key === "render-mode") {
      const renderMode = parseRenderMode(entry.value);
      if (renderMode) {
        options.renderMode = renderMode;
      } else {
        pushTableDiagnostic(state, `Invalid hy-table-option value "${entry.value}" for "${entry.key}".`, {
          attribute: "hy-table-option",
          selector: buildTableSelector(tableId),
          context: entry.key
        });
      }
      continue;
    }
    if (key === "edit-mode") {
      const editMode = parseEditMode(entry.value);
      if (editMode) {
        options.editMode = editMode;
      } else {
        pushTableDiagnostic(state, `Invalid hy-table-option value "${entry.value}" for "${entry.key}".`, {
          attribute: "hy-table-option",
          selector: buildTableSelector(tableId),
          context: entry.key
        });
      }
      continue;
    }
    if (key === "lock-mode") {
      const lockMode = parseLockMode(entry.value);
      if (lockMode) {
        options.lockMode = lockMode;
      } else {
        pushTableDiagnostic(state, `Invalid hy-table-option value "${entry.value}" for "${entry.key}".`, {
          attribute: "hy-table-option",
          selector: buildTableSelector(tableId),
          context: entry.key
        });
      }
      continue;
    }
    if (key === "lang") {
      const langs = entry.value.split(/\s+/).filter(Boolean);
      if (langs.length > 0) {
        options.langs = langs;
      }
      continue;
    }
    if (key === "bind-shortcut") {
      const parsed = parseBool(entry.value);
      if (parsed == null) {
        pushTableDiagnostic(state, `Invalid hy-table-option value "${entry.value}" for "${entry.key}".`, {
          attribute: "hy-table-option",
          selector: buildTableSelector(tableId),
          context: entry.key
        });
      } else {
        bindShortcut = parsed;
      }
      continue;
    }
    if (key === "default-class" || key === "default-style") {
      continue;
    }

    pushTableDiagnostic(state, `Unknown hy-table-option key "${entry.key}".`, {
      attribute: "hy-table-option",
      selector: buildTableSelector(tableId),
      context: entry.key
    });
  }
  return { options, bindShortcut };
}

function parseRenderMode(value: string): CoreOptions["renderMode"] {
  switch (value.trim().toLowerCase()) {
    case "html":
    case "canvas":
    case "auto":
      return value.trim().toLowerCase() as CoreOptions["renderMode"];
    default:
      return undefined;
  }
}

function parseEditMode(value: string): CoreOptions["editMode"] {
  switch (value.trim().toLowerCase()) {
    case "direct":
    case "commit":
    case "readonly":
      return value.trim().toLowerCase() as CoreOptions["editMode"];
    default:
      return undefined;
  }
}

function parseLockMode(value: string): CoreOptions["lockMode"] {
  switch (value.trim().toLowerCase()) {
    case "none":
    case "row":
      return value.trim().toLowerCase() as CoreOptions["lockMode"];
    default:
      return undefined;
  }
}

function parseBool(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
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

function buildTableSelector(tableId: string): string {
  const escaped = tableId.replace(/"/g, "\\\"");
  return `table[hy-table-data="${escaped}"]`;
}

function pushTableDiagnostic(state: RuntimeState, message: string, detail?: HyError["detail"]): void {
  pushError(state, createHyError("data", message, detail));
}

function parseDeclarationList(input: string): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  let key = "";
  let value = "";
  let mode: "key" | "value" = "key";
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  const flush = () => {
    const trimmedKey = key.trim();
    if (trimmedKey) {
      entries.push({ key: trimmedKey, value: value.trim() });
    }
    key = "";
    value = "";
    mode = "key";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      if (mode === "key") {
        key += char;
      } else {
        value += char;
      }
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (mode === "key") {
        key += char;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === ":" && mode === "key") {
      mode = "value";
      continue;
    }

    if (char === ";") {
      flush();
      continue;
    }

    if (mode === "key") {
      key += char;
    } else {
      value += char;
    }
  }

  flush();
  return entries;
}
