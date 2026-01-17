export const VERBOSE_TO_COMPACT: Record<string, string> = {
  executionMode: "m",
  mockRules: "mr",
  parseErrors: "pe",
  handlesErrors: "he",
  hasErrorPopover: "hp",
  textBindings: "tb",
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
  nodes: "ns",
  kind: "k",
  expression: "e",
  expressionParts: "ep",
  attr: "a",
  target: "t",
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
  args: "ar"
};

export const COMPACT_TO_VERBOSE: Record<string, string> = buildReverseMapping(VERBOSE_TO_COMPACT);

export function compactifyKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => compactifyKeys(entry));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(value)) {
      if (rawValue == null) {
        continue;
      }
      if (rawValue === false) {
        continue;
      }
      if (Array.isArray(rawValue) && rawValue.length === 0) {
        continue;
      }
      const compactKey = VERBOSE_TO_COMPACT[key] ?? key;
      result[compactKey] = compactifyKeys(rawValue);
    }
    return result;
  }
  return value;
}

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
