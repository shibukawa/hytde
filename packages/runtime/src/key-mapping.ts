import type { IrDocument } from "./ir.js";

export const VERBOSE_TO_COMPACT: Record<string, string> = {
  executionMode: "m",
  mockRules: "mr",
  parseErrors: "pe",
  handlesErrors: "he",
  hasErrorPopover: "hp",
  textBindings: "tb",
  headBindings: "hb",
  attrBindings: "ab",
  forTemplates: "ft",
  ifChains: "ic",
  requestTargets: "rt",
  fillTargets: "ftg",
  fillActions: "fac",
  historyForms: "hf",
  autoSubmitForms: "asf",
  asyncUploadForms: "auf",
  formStateCandidates: "fsc",
  tables: "tbl",
  tableDiagnostics: "td",
  cloakElementIds: "ce",
  dummyElementIds: "de",
  nodeId: "ni",
  elementId: "ei",
  markerId: "mi",
  anchorId: "ai",
  tableId: "tid",
  tableElementId: "tei",
  templateHtml: "th",
  varName: "vn",
  selector: "s",
  selectorParts: "sp",
  transforms: "tr",
  transformScripts: "ts",
  nodes: "ns",
  kind: "k",
  expression: "e",
  expressionParts: "ep",
  attr: "a",
  target: "t",
  sourceAttr: "sa",
  template: "tp",
  templateTokens: "tt",
  urlTemplate: "u",
  store: "st",
  unwrap: "uw",
  method: "md",
  trigger: "trg",
  actionDebounceMs: "ad",
  redirect: "rd",
  formId: "fid",
  fillIntoIds: "fio",
  fillTargetId: "fti",
  fillTargetSelector: "fts",
  fillValue: "fv",
  streamInitial: "si",
  streamTimeoutMs: "stm",
  streamKey: "sk",
  pollIntervalMs: "pi",
  isForm: "if",
  mode: "mo",
  paramsSource: "ps",
  fieldNames: "fn",
  events: "ev",
  debounceMs: "db",
  composeMode: "cm",
  uploaderUrl: "uu",
  chunkSizeBytes: "cs",
  afterSubmitAction: "asa",
  afterSubmitActionPresent: "asap",
  redirectConflict: "rc",
  ownerId: "oid",
  raw: "r",
  dataPath: "dp",
  options: "op",
  columns: "cl",
  bindShortcut: "bs",
  renderMode: "rm",
  editMode: "em",
  lockMode: "lm",
  langs: "lg",
  key: "ky",
  type: "ty",
  header: "hd",
  width: "w",
  format: "fm",
  message: "mg",
  detail: "dt",
  rawPattern: "rp",
  pattern: "pt",
  path: "ph",
  status: "stt",
  delayMs: "dl",
  min: "mn",
  max: "mx",
  value: "v",
  name: "nm",
  args: "ar",
  resources: "rs",
  routePath: "rph",
  html: "ht",
  htmlAttrs: "ha",
  bodyAttrs: "ba",
  preserveIds: "pid",
  title: "tl",
  css: "c",
  js: "j",
  prefetch: "pf",
  href: "h",
  src: "sr",
  critical: "cr",
  async: "as",
  defer: "df",
  integrity: "ig",
  crossOrigin: "co"
};

export const COMPACT_TO_VERBOSE: Record<string, string> = buildReverseMapping(VERBOSE_TO_COMPACT);

export function expandKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => expandKeys(entry));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(value)) {
      const verboseKey = COMPACT_TO_VERBOSE[key] ?? key;
      result[verboseKey] = expandKeys(rawValue);
    }
    return result;
  }
  return value;
}

export function normalizeIrDocument(ir: IrDocument): IrDocument {
  return {
    executionMode: ir.executionMode ?? "production",
    mockRules: Array.isArray(ir.mockRules) ? ir.mockRules : [],
    parseErrors: Array.isArray(ir.parseErrors) ? ir.parseErrors : [],
    handlesErrors: Boolean(ir.handlesErrors),
    hasErrorPopover: Boolean(ir.hasErrorPopover),
    transforms: ir.transforms ?? null,
    transformScripts: ir.transformScripts ?? null,
    resources: ir.resources,
    routePath: ir.routePath,
    html: ir.html,
    textBindings: Array.isArray(ir.textBindings) ? ir.textBindings : [],
    headBindings: Array.isArray(ir.headBindings) ? ir.headBindings : [],
    attrBindings: Array.isArray(ir.attrBindings) ? ir.attrBindings : [],
    forTemplates: Array.isArray(ir.forTemplates) ? ir.forTemplates : [],
    ifChains: Array.isArray(ir.ifChains) ? ir.ifChains : [],
    requestTargets: Array.isArray(ir.requestTargets) ? ir.requestTargets : [],
    fillTargets: Array.isArray(ir.fillTargets) ? ir.fillTargets : [],
    fillActions: Array.isArray(ir.fillActions) ? ir.fillActions : [],
    historyForms: Array.isArray(ir.historyForms) ? ir.historyForms : [],
    autoSubmitForms: Array.isArray(ir.autoSubmitForms) ? ir.autoSubmitForms : [],
    asyncUploadForms: Array.isArray(ir.asyncUploadForms) ? ir.asyncUploadForms : [],
    formStateCandidates: Array.isArray(ir.formStateCandidates) ? ir.formStateCandidates : [],
    tables: Array.isArray(ir.tables) ? ir.tables : [],
    tableDiagnostics: Array.isArray(ir.tableDiagnostics) ? ir.tableDiagnostics : [],
    cloakElementIds: Array.isArray(ir.cloakElementIds) ? ir.cloakElementIds : [],
    dummyElementIds: Array.isArray(ir.dummyElementIds) ? ir.dummyElementIds : []
  };
}

function buildReverseMapping(map: Record<string, string>): Record<string, string> {
  const reverse: Record<string, string> = {};
  for (const [verbose, compact] of Object.entries(map)) {
    if (reverse[compact]) {
      throw new Error(`[hytde] duplicate compact key mapping for "${compact}".`);
    }
    reverse[compact] = verbose;
  }
  return reverse;
}
