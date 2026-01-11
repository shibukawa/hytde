export type ExecutionMode = "production" | "mock" | "disable";
export type NodeId = string;

export interface IrBase {
  executionMode: ExecutionMode;
}

export interface IrTextBinding {
  nodeId: NodeId;
  expression: string;
}

export interface IrAttrBinding {
  nodeId: NodeId;
  attr: string;
  target: string;
  template: string;
}

export interface IrForTemplate {
  markerId: NodeId;
  templateHtml: string;
  varName: string;
  selector: string;
}

export interface IrIfChainNode {
  nodeId: NodeId;
  kind: "if" | "else-if" | "else";
  expression: string | null;
}

export interface IrIfChain {
  anchorId: NodeId;
  nodes: IrIfChainNode[];
}

export interface IrRequestTarget {
  elementId: NodeId;
  urlTemplate: string;
  store: string | null;
  unwrap: string | null;
  method: string;
  kind: "fetch" | "stream" | "sse" | "polling";
  trigger: "startup" | "submit" | "action";
  actionDebounceMs: number | null;
  redirect: string | null;
  formId: NodeId | null;
  fillIntoIds: NodeId[];
  fillTargetId: NodeId | null;
  fillTargetSelector: string | null;
  fillValue: string | null;
  streamInitial: number;
  streamTimeoutMs: number | null;
  streamKey: string | null;
  pollIntervalMs: number | null;
  isForm: boolean;
}

export interface IrFillTarget {
  formId: NodeId;
  selector: string;
}

export interface IrFillAction {
  elementId: NodeId;
  targetId: NodeId | null;
  selector: string;
  value: string | null;
  formId: NodeId | null;
  command: string | null;
  commandFor: string | null;
}

export interface IrHistoryForm {
  formId: NodeId;
  mode: "sync" | "sync-push" | "sync-replace";
  paramsSource: "search" | "hash";
  fieldNames: string[] | null;
}

export interface IrAutoSubmitForm {
  formId: NodeId;
  events: string[];
  debounceMs: number;
  composeMode: "end" | "blur";
}

export interface IrAsyncUploadForm {
  formId: NodeId;
  mode: "s3" | "simple";
  uploaderUrl: string | null;
  chunkSizeBytes: number;
  afterSubmitAction: "clear" | "keep";
  afterSubmitActionPresent: boolean;
  redirectConflict: boolean;
}

export interface IrFormStateCandidate {
  formId: NodeId;
  ownerId: NodeId;
  raw: string;
}

export interface IrTableColumn {
  key: string;
  type: "number" | "date" | "boolean" | "string";
  header?: string;
  width?: number;
  format?: string;
}

export interface IrTableOptions {
  renderMode?: "html" | "canvas" | "auto";
  editMode?: "direct" | "commit" | "readonly";
  lockMode?: "none" | "row";
  langs?: string[];
}

export interface IrTableConfig {
  tableId: string;
  tableElementId: NodeId;
  dataPath: string | null;
  options: IrTableOptions;
  columns: IrTableColumn[];
  bindShortcut: boolean;
}

export interface IrTableDiagnostic {
  message: string;
  detail?: Record<string, unknown>;
}

export interface IrDocument extends IrBase {
  mockRules: MockRule[];
  parseErrors: ParseError[];
  handlesErrors: boolean;
  hasErrorPopover: boolean;
  textBindings: IrTextBinding[];
  attrBindings: IrAttrBinding[];
  forTemplates: IrForTemplate[];
  ifChains: IrIfChain[];
  requestTargets: IrRequestTarget[];
  fillTargets: IrFillTarget[];
  fillActions: IrFillAction[];
  historyForms: IrHistoryForm[];
  autoSubmitForms: IrAutoSubmitForm[];
  asyncUploadForms: IrAsyncUploadForm[];
  formStateCandidates: IrFormStateCandidate[];
  tables: IrTableConfig[];
  tableDiagnostics: IrTableDiagnostic[];
  cloakElementIds: NodeId[];
  dummyElementIds: NodeId[];
}

export interface MockRule {
  rawPattern: string;
  pattern: RegExp;
  path: string;
  method: string;
  status?: number;
  delayMs?: { min: number; max: number };
}

export interface ForTemplate {
  marker: Element;
  template: Element;
  varName: string;
  selector: string;
  rendered: Node[];
}

export interface ImportTarget {
  element: Element;
  src: string;
  exportName: string | null;
  withExpression: string | null;
}

export interface ImportExportSelection {
  contentNodes: Element[];
  assetNodes: Element[];
  hasExports: boolean;
}

export interface ImportError {
  message: string;
  url: string;
  method: "IMPORT";
}

export interface ImportLogEntry {
  type: "render" | "request" | "error" | "info";
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
}

export interface RequestTarget {
  element: Element;
  urlTemplate: string;
  store: string | null;
  unwrap: string | null;
  method: string;
  kind: "fetch" | "stream" | "sse" | "polling";
  streamInitial: number;
  streamTimeoutMs: number | null;
  streamKey: string | null;
  pollIntervalMs: number | null;
  isForm: boolean;
  trigger: "startup" | "submit" | "action";
  actionDebounceMs: number | null;
  redirect: string | null;
  form: HTMLFormElement | null;
  fillIntoForms: HTMLFormElement[];
  fillIntoSelector: string | null;
  fillTargetElement: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  fillTargetSelector: string | null;
  fillValue: string | null;
}

export interface HistoryFormConfig {
  form: HTMLFormElement;
  mode: "sync" | "sync-push" | "sync-replace";
  paramsSource: "search" | "hash";
  fieldNames: string[] | null;
}

export interface AutoSubmitFormConfig {
  form: HTMLFormElement;
  events: string[];
  debounceMs: number;
  composeMode: "end" | "blur";
}

export interface AsyncUploadFormConfig {
  form: HTMLFormElement;
  mode: "s3" | "simple";
  uploaderUrl: string | null;
  chunkSizeBytes: number;
  afterSubmitAction: "clear" | "keep";
  afterSubmitActionPresent: boolean;
  redirectConflict: boolean;
}

export interface FormStateCandidate {
  form: HTMLFormElement;
  owner: HTMLElement;
  raw: string;
}

export interface TableColumnConfig {
  key: string;
  type: "number" | "date" | "boolean" | "string";
  header?: string;
  width?: number;
  format?: string;
}

export interface TableOptions {
  renderMode?: "html" | "canvas" | "auto";
  editMode?: "direct" | "commit" | "readonly";
  lockMode?: "none" | "row";
  langs?: string[];
}

export interface TableConfig {
  table: HTMLTableElement;
  tableId: string;
  dataPath: string | null;
  options: TableOptions;
  columns: TableColumnConfig[];
  bindShortcut: boolean;
}

export interface TableDiagnostic {
  message: string;
  detail?: Record<string, unknown>;
}

export interface TextBinding {
  element: Element;
  expression: string;
}

export interface AttrBinding {
  element: Element;
  attr: string;
  target: string;
  template: string;
}

export interface IfChainNode {
  node: Element;
  kind: "if" | "else-if" | "else";
  expression: string | null;
}

export interface IfChain {
  anchor: Element;
  nodes: IfChainNode[];
}

export interface ParsedSubtree {
  dummyElements: Element[];
  cloakElements: Element[];
  forTemplates: ForTemplate[];
  ifChains: IfChain[];
  textBindings: TextBinding[];
  attrBindings: AttrBinding[];
  fillTargets: FillTarget[];
  fillActions: FillAction[];
}

export interface ParsedDocument extends ParsedSubtree {
  doc: Document;
  executionMode: ExecutionMode;
  mockRules: MockRule[];
  parseErrors: ParseError[];
  requestTargets: RequestTarget[];
  importTargets: ImportTarget[];
  historyForms: HistoryFormConfig[];
  autoSubmitForms: AutoSubmitFormConfig[];
  asyncUploadForms: AsyncUploadFormConfig[];
  formStateCandidates: FormStateCandidate[];
  tables: TableConfig[];
  tableDiagnostics: TableDiagnostic[];
  handlesErrors: boolean;
  hasErrorPopover: boolean;
}

export interface ParseError {
  message: string;
  detail?: Record<string, unknown>;
}

export function parseDocument(doc: Document): ParsedDocument {
  const parseErrors: ParseError[] = [];
  const { handlesErrors, hasErrorPopover } = detectErrorHandling(doc);
  const requestTargets = parseRequestTargets(doc, parseErrors);
  const importTargets = parseImportTargets(doc);
  const historyForms = parseHistoryForms(doc, parseErrors);
  const autoSubmitForms = parseAutoSubmitForms(doc, parseErrors);
  const asyncUploadForms = parseAsyncUploadForms(doc, parseErrors);
  const formStateCandidates = parseFormStateCandidates(doc);
  const tableParseResult = parseTables(doc);
  stripRedirectAttributes(doc);
  return {
    doc,
    executionMode: getExecutionMode(doc),
    mockRules: parseMockRules(doc),
    parseErrors,
    requestTargets,
    importTargets,
    historyForms,
    autoSubmitForms,
    asyncUploadForms,
    formStateCandidates,
    tables: tableParseResult.tables,
    tableDiagnostics: tableParseResult.diagnostics,
    handlesErrors,
    hasErrorPopover,
    ...parseSubtree(doc, parseErrors)
  };
}

export function parseDocumentToIr(doc: Document): IrDocument {
  const parsed = parseDocument(doc);
  const resolveId = createIdResolver(doc);

  return {
    executionMode: parsed.executionMode,
    mockRules: parsed.mockRules,
    parseErrors: parsed.parseErrors,
    handlesErrors: parsed.handlesErrors,
    hasErrorPopover: parsed.hasErrorPopover,
    textBindings: parsed.textBindings.map((binding) => ({
      nodeId: resolveId(binding.element),
      expression: binding.expression
    })),
    attrBindings: parsed.attrBindings.map((binding) => ({
      nodeId: resolveId(binding.element),
      attr: binding.attr,
      target: binding.target,
      template: binding.template
    })),
    forTemplates: parsed.forTemplates.map((template) => ({
      markerId: resolveId(template.marker),
      templateHtml: template.template.outerHTML,
      varName: template.varName,
      selector: template.selector
    })),
    ifChains: parsed.ifChains.map((chain) => ({
      anchorId: resolveId(chain.anchor),
      nodes: chain.nodes.map((node) => ({
        nodeId: resolveId(node.node),
        kind: node.kind,
        expression: node.expression ?? null
      }))
    })),
    requestTargets: parsed.requestTargets.map((target) => ({
      elementId: resolveId(target.element),
      urlTemplate: target.urlTemplate,
      store: target.store,
      unwrap: target.unwrap,
      method: target.method,
      kind: target.kind,
      trigger: target.trigger,
      actionDebounceMs: target.actionDebounceMs,
      redirect: target.redirect,
      formId: target.form ? resolveId(target.form) : null,
      fillIntoIds: target.fillIntoForms.map((form) => resolveId(form)),
      fillTargetId: target.fillTargetElement ? resolveId(target.fillTargetElement) : null,
      fillTargetSelector: target.fillTargetSelector,
      fillValue: target.fillValue,
      streamInitial: target.streamInitial,
      streamTimeoutMs: target.streamTimeoutMs,
      streamKey: target.streamKey,
      pollIntervalMs: target.pollIntervalMs,
      isForm: target.isForm
    })),
    fillTargets: parsed.fillTargets.map((target) => ({
      formId: resolveId(target.form),
      selector: target.selector
    })),
    fillActions: parsed.fillActions.map((action) => ({
      elementId: resolveId(action.element),
      targetId: action.target ? resolveId(action.target) : null,
      selector: action.selector,
      value: action.value,
      formId: action.form ? resolveId(action.form) : null,
      command: action.command,
      commandFor: action.commandFor
    })),
    historyForms: parsed.historyForms.map((entry) => ({
      formId: resolveId(entry.form),
      mode: entry.mode,
      paramsSource: entry.paramsSource,
      fieldNames: entry.fieldNames
    })),
    autoSubmitForms: parsed.autoSubmitForms.map((entry) => ({
      formId: resolveId(entry.form),
      events: entry.events,
      debounceMs: entry.debounceMs,
      composeMode: entry.composeMode
    })),
    asyncUploadForms: parsed.asyncUploadForms.map((entry) => ({
      formId: resolveId(entry.form),
      mode: entry.mode,
      uploaderUrl: entry.uploaderUrl,
      chunkSizeBytes: entry.chunkSizeBytes,
      afterSubmitAction: entry.afterSubmitAction,
      afterSubmitActionPresent: entry.afterSubmitActionPresent,
      redirectConflict: entry.redirectConflict
    })),
    formStateCandidates: parsed.formStateCandidates.map((candidate) => ({
      formId: resolveId(candidate.form),
      ownerId: resolveId(candidate.owner),
      raw: candidate.raw
    })),
    tables: parsed.tables.map((table) => ({
      tableId: table.tableId,
      tableElementId: resolveId(table.table),
      dataPath: table.dataPath,
      options: table.options,
      columns: table.columns,
      bindShortcut: table.bindShortcut
    })),
    tableDiagnostics: parsed.tableDiagnostics,
    cloakElementIds: parsed.cloakElements.map((element) => resolveId(element)),
    dummyElementIds: []
  };
}

export function parseSubtree(root: ParentNode, parseErrors: ParseError[] = []): ParsedSubtree {
  removeDummyElements(root);
  const dummyElements: Element[] = [];
  const cloakElements = selectWithRoot(root, "[hy-cloak]");
  const forTemplates = parseForTemplates(root, parseErrors);
  const ifChains = parseIfChains(root);
  const textBindings = parseTextBindings(root);
  const attrBindings = parseAttrBindings(root);
  const hrefBindings = parseHrefBindings(root);
  const fillTargets = parseFillTargets(root);
  const fillActions = parseFillActions(root, parseErrors);

  return {
    dummyElements,
    cloakElements,
    forTemplates,
    ifChains,
    textBindings,
    attrBindings: [...attrBindings, ...hrefBindings],
    fillTargets,
    fillActions
  };
}

export interface FillTarget {
  form: HTMLFormElement;
  selector: string;
}

export interface FillAction {
  element: Element;
  selector: string;
  value: string | null;
  form: HTMLFormElement | null;
  command: string | null;
  commandFor: string | null;
  target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
}

export interface ParsedHtml {
  nodeCount: number;
}

export function parseHtml(html: string): ParsedHtml {
  const matches = html.match(/<[^>]+>/g);
  return {
    nodeCount: matches ? matches.length : 0
  };
}

export function parseImportDocument(html: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is not available for import parsing.");
  }
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

export function selectImportExports(doc: Document, exportName?: string | null): ImportExportSelection {
  const allExports = Array.from(doc.querySelectorAll("[hy-export]"));
  const hasExports = allExports.length > 0;
  let exported = allExports;
  if (exportName) {
    exported = allExports.filter((node) => node.getAttribute("hy-export") === exportName);
  }

  if (!hasExports) {
    const body = doc.body;
    return {
      contentNodes: body ? Array.from(body.children) : [],
      assetNodes: [],
      hasExports
    };
  }

  const assetNodes = exported.filter((node) => isAssetNode(node));
  const contentCandidates = exported.filter((node) => !isAssetNode(node));
  const contentNodes = contentCandidates.length > 0 ? [contentCandidates[0]] : [];

  return {
    contentNodes,
    assetNodes,
    hasExports
  };
}

function getExecutionMode(doc: Document): ExecutionMode {
  const meta = doc.querySelector('meta[name="hy-mode"]');
  const content = meta?.getAttribute("content")?.trim().toLowerCase();
  if (content === "mock" || content === "disable") {
    return content;
  }

  return "production";
}

function parseMockRules(doc: Document): MockRule[] {
  const metas = Array.from(doc.querySelectorAll('meta[name="hy-mock"]'));
  const rules: MockRule[] = [];

  for (const meta of metas) {
    const content = meta.getAttribute("content");
    if (!content) {
      continue;
    }

    const parsed = parseMockContent(content);
    if (!parsed) {
      continue;
    }

    rules.push(parsed);
  }

  return rules;
}

function parseMockContent(content: string): MockRule | null {
  const tokens = content.split(/\s+/).filter(Boolean);
  let pattern = "";
  let path = "";
  let method = "GET";
  let status: number | undefined;
  let delayMs: { min: number; max: number } | undefined;

  for (const token of tokens) {
    const [key, rawValue] = token.includes("=") ? token.split("=") : token.split(":");
    if (!key || rawValue == null) {
      continue;
    }

    const value = rawValue.trim();
    if (key === "pattern") {
      pattern = value;
    } else if (key === "path") {
      path = value;
    } else if (key === "method") {
      method = value.toUpperCase();
    } else if (key === "status") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        status = parsed;
      }
    } else if (key === "delay") {
      const parsedDelay = parseDelayRange(value);
      if (parsedDelay) {
        delayMs = parsedDelay;
      }
    }
  }

  if (!pattern || !path) {
    return null;
  }

  return {
    rawPattern: pattern,
    pattern: patternToRegex(pattern),
    path,
    method,
    status,
    delayMs
  };
}

function parseDelayRange(value: string): { min: number; max: number } | null {
  const parts = value.split("-").map((part) => Number(part.trim()));
  if (parts.length === 1 && !Number.isNaN(parts[0])) {
    return { min: parts[0], max: parts[0] };
  }
  if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    const min = Math.min(parts[0], parts[1]);
    const max = Math.max(parts[0], parts[1]);
    return { min, max };
  }
  return null;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wildcard = escaped.replace(/\\\[[^\]]+\\\]/g, "[^/]+");
  return new RegExp(`^${wildcard}$`);
}

function parseRequestTargets(doc: Document, parseErrors: ParseError[]): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("[hy-get],[hy-post],[hy-put],[hy-patch],[hy-delete]"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const methodAttr = resolveMethodAttribute(element);
    if (!methodAttr) {
      continue;
    }
    const urlTemplate = element.getAttribute(methodAttr.attr);
    const storeRaw = element.getAttribute("hy-store");
    let store = storeRaw?.trim() ?? null;
    const unwrap = element.getAttribute("hy-unwrap");
    const fillTargetAttr = element.getAttribute("hy-fill");
    const fillValue = element.getAttribute("hy-value");
    element.removeAttribute(methodAttr.attr);
    element.removeAttribute("hy-store");
    element.removeAttribute("hy-unwrap");
    element.removeAttribute("hy-fill");
    element.removeAttribute("hy-value");
    element.removeAttribute("hy-get");
    element.removeAttribute("hy-post");
    element.removeAttribute("hy-put");
    element.removeAttribute("hy-patch");
    element.removeAttribute("hy-delete");
    if (!urlTemplate) {
      continue;
    }
    if (store) {
      if (!isValidIdentifier(store)) {
        parseErrors.push({
          message: "hy-store must be a valid identifier.",
          detail: { store: storeRaw }
        });
        store = null;
      }
    } else if (storeRaw && !store) {
      parseErrors.push({
        message: "hy-store must be a valid identifier.",
        detail: { store: storeRaw }
      });
    }
    const isForm = isFormElement(element);
    const isSubmitter = isSubmitControl(element);
    const isAction = isActionElement(element);
    if (!isForm && !isSubmitter && !isAction) {
      continue;
    }
    const trigger = isForm || isSubmitter ? "submit" : "action";
    const form = isForm
      ? (element as HTMLFormElement)
      : isSubmitter || isAction
        ? getSubmitterForm(element as HTMLButtonElement | HTMLInputElement)
        : null;
    const actionDebounceMs = trigger === "action" ? parseActionDebounce(element.getAttribute("hy-debounce")) : null;
    if (trigger === "action") {
      element.removeAttribute("hy-debounce");
    }
    const redirect = resolveRedirectTarget(element, form);
    const resolvedFillTarget = resolveFillTargetElement(element, form, fillTargetAttr, parseErrors);
    targets.push({
      element,
      urlTemplate,
      store,
      unwrap,
      method: methodAttr.method,
      kind: "fetch",
      streamInitial: 0,
      streamTimeoutMs: null,
      streamKey: null,
      pollIntervalMs: null,
      isForm,
      trigger,
      actionDebounceMs,
      redirect,
      form,
      fillIntoForms: [],
      fillIntoSelector: null,
      fillTargetElement: resolvedFillTarget.target,
      fillTargetSelector: resolvedFillTarget.selector,
      fillValue
    });
  }

  const tagTargets = parseGetTagTargets(doc, parseErrors);
  targets.push(...tagTargets);
  targets.push(...parseStreamTargets(doc, parseErrors));
  targets.push(...parseSseTargets(doc, parseErrors));
  targets.push(...parsePollingTargets(doc, parseErrors));

  return targets;
}

function resolveMethodAttribute(element: Element): { attr: string; method: string } | null {
  const attributes: Array<{ attr: string; method: string }> = [
    { attr: "hy-get", method: "GET" },
    { attr: "hy-post", method: "POST" },
    { attr: "hy-put", method: "PUT" },
    { attr: "hy-patch", method: "PATCH" },
    { attr: "hy-delete", method: "DELETE" }
  ];

  for (const entry of attributes) {
    if (element.hasAttribute(entry.attr)) {
      return entry;
    }
  }

  return null;
}

function isTagName(element: Element, tagName: string): boolean {
  const name = element.tagName ? element.tagName.toLowerCase() : "";
  return name === tagName;
}

function isFormElement(element: Element): element is HTMLFormElement {
  return element instanceof HTMLFormElement || isTagName(element, "form");
}

function isSubmitControl(element: Element): element is HTMLButtonElement | HTMLInputElement {
  if (element instanceof HTMLButtonElement || isTagName(element, "button")) {
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    return type === "" || type === "submit";
  }
  if (element instanceof HTMLInputElement || isTagName(element, "input")) {
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    return type === "submit";
  }
  return false;
}

function getSubmitterForm(element: HTMLButtonElement | HTMLInputElement): HTMLFormElement | null {
  return element.form ?? (element.closest("form") as HTMLFormElement | null);
}

function isActionElement(
  element: Element
): element is HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    isTagName(element, "button") ||
    isTagName(element, "input") ||
    isTagName(element, "select") ||
    isTagName(element, "textarea")
  );
}

function parseActionDebounce(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  if (raw.trim() === "") {
    return 200;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 200;
  }
  return parsed;
}

function resolveRedirectTarget(element: Element, form: HTMLFormElement | null): string | null {
  const direct = element.getAttribute("hy-redirect");
  if (direct && direct !== "") {
    return direct;
  }
  if (form) {
    const formRedirect = form.getAttribute("hy-redirect");
    if (formRedirect && formRedirect !== "") {
      return formRedirect;
    }
  }
  return null;
}

function parseGetTagTargets(doc: Document, parseErrors: ParseError[]): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("hy-get"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const src = element.getAttribute("src");
    const storeRaw = element.getAttribute("store");
    let store = storeRaw?.trim() ?? null;
    const unwrap = element.getAttribute("unwrap");
    const fillIntoAttr = element.getAttribute("fill-into");
    const parent = element.parentElement;
    element.remove();
    if (!src || !parent) {
      continue;
    }
    if (store) {
      if (!isValidIdentifier(store)) {
        parseErrors.push({
          message: "store must be a valid identifier.",
          detail: { store: storeRaw }
        });
        store = null;
      }
    } else if (storeRaw && !store) {
      parseErrors.push({
        message: "store must be a valid identifier.",
        detail: { store: storeRaw }
      });
    }

    const resolvedFillInto = resolveFillIntoForms(doc, fillIntoAttr, parseErrors);
    targets.push({
      element: parent,
      urlTemplate: src,
      store,
      unwrap,
      method: "GET",
      kind: "fetch",
      streamInitial: 0,
      streamTimeoutMs: null,
      streamKey: null,
      pollIntervalMs: null,
      isForm: false,
      trigger: "startup",
      actionDebounceMs: null,
      redirect: null,
      form: null,
      fillIntoForms: resolvedFillInto.forms,
      fillIntoSelector: resolvedFillInto.selector,
      fillTargetElement: null,
      fillTargetSelector: null,
      fillValue: null
    });
  }

  return targets;
}

function parseStreamTargets(doc: Document, parseErrors: ParseError[]): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("hy-get-stream"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const urlTemplate = element.getAttribute("src");
    const storeRaw = element.getAttribute("store");
    let store = storeRaw?.trim() ?? null;
    const unwrap = element.getAttribute("unwrap");
    const streamInitial = parseStreamInitial(element);
    const streamTimeoutMs = parseStreamTimeout(element);
    const streamKey = parseStreamKey(element);
    const parent = element.parentElement;
    element.remove();
    if (!urlTemplate || !parent) {
      continue;
    }
    if (store) {
      if (!isValidIdentifier(store)) {
        parseErrors.push({
          message: "store must be a valid identifier.",
          detail: { store: storeRaw }
        });
        store = null;
      }
    } else if (storeRaw && !store) {
      parseErrors.push({
        message: "store must be a valid identifier.",
        detail: { store: storeRaw }
      });
    }

    targets.push({
      element: parent,
      urlTemplate,
      store,
      unwrap,
      method: "GET",
      kind: "stream",
      streamInitial,
      streamTimeoutMs,
      streamKey,
      pollIntervalMs: null,
      isForm: false,
      trigger: "startup",
      actionDebounceMs: null,
      redirect: null,
      form: null,
      fillIntoForms: [],
      fillIntoSelector: null,
      fillTargetElement: null,
      fillTargetSelector: null,
      fillValue: null
    });
  }

  return targets;
}

function parseSseTargets(doc: Document, parseErrors: ParseError[]): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("hy-sse"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const urlTemplate = element.getAttribute("src");
    const storeRaw = element.getAttribute("store");
    let store = storeRaw?.trim() ?? null;
    const unwrap = element.getAttribute("unwrap");
    const streamInitial = parseStreamInitial(element);
    const streamTimeoutMs = parseStreamTimeout(element);
    const streamKey = parseStreamKey(element);
    const parent = element.parentElement;
    element.remove();
    if (!urlTemplate || !parent) {
      continue;
    }
    if (store) {
      if (!isValidIdentifier(store)) {
        parseErrors.push({
          message: "store must be a valid identifier.",
          detail: { store: storeRaw }
        });
        store = null;
      }
    } else if (storeRaw && !store) {
      parseErrors.push({
        message: "store must be a valid identifier.",
        detail: { store: storeRaw }
      });
    }

    targets.push({
      element: parent,
      urlTemplate,
      store,
      unwrap,
      method: "GET",
      kind: "sse",
      streamInitial,
      streamTimeoutMs,
      streamKey,
      pollIntervalMs: null,
      isForm: false,
      trigger: "startup",
      actionDebounceMs: null,
      redirect: null,
      form: null,
      fillIntoForms: [],
      fillIntoSelector: null,
      fillTargetElement: null,
      fillTargetSelector: null,
      fillValue: null
    });
  }

  return targets;
}

function parseStreamInitial(element: Element): number {
  const raw = element.getAttribute("stream-initial");
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed;
  }
  return 0;
}

function parseStreamTimeout(element: Element): number | null {
  const raw = element.getAttribute("stream-timeout");
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed;
  }
  return null;
}

function parseStreamKey(element: Element): string | null {
  const raw = element.getAttribute("stream-key");
  if (!raw) {
    return null;
  }
  return raw.trim() || null;
}

function parsePollingTargets(doc: Document, parseErrors: ParseError[]): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("hy-get-polling"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const urlTemplate = element.getAttribute("src");
    const storeRaw = element.getAttribute("store");
    let store = storeRaw?.trim() ?? null;
    const unwrap = element.getAttribute("unwrap");
    const pollIntervalMs = parsePollingInterval(element);
    const parent = element.parentElement;
    element.remove();
    if (!urlTemplate || !parent) {
      continue;
    }
    if (store) {
      if (!isValidIdentifier(store)) {
        parseErrors.push({
          message: "store must be a valid identifier.",
          detail: { store: storeRaw }
        });
        store = null;
      }
    } else if (storeRaw && !store) {
      parseErrors.push({
        message: "store must be a valid identifier.",
        detail: { store: storeRaw }
      });
    }

    targets.push({
      element: parent,
      urlTemplate,
      store,
      unwrap,
      method: "GET",
      kind: "polling",
      streamInitial: 0,
      streamTimeoutMs: null,
      streamKey: null,
      pollIntervalMs,
      isForm: false,
      trigger: "startup",
      actionDebounceMs: null,
      redirect: null,
      form: null,
      fillIntoForms: [],
      fillIntoSelector: null,
      fillTargetElement: null,
      fillTargetSelector: null,
      fillValue: null
    });
  }

  return targets;
}

function parsePollingInterval(element: Element): number | null {
  const raw = element.getAttribute("interval");
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed;
  }
  return null;
}

function parseHistoryForms(doc: Document, _parseErrors: ParseError[]): HistoryFormConfig[] {
  const forms = Array.from(doc.getElementsByTagName("form")).filter((form) => form.hasAttribute("hy-history"));
  const configs: HistoryFormConfig[] = [];

  for (const form of forms) {
    const rawMode = form.getAttribute("hy-history")?.trim() ?? "";
    const mode = parseHistoryMode(rawMode);
    if (!mode) {
      continue;
    }
    const paramsSource = form.getAttribute("hy-history-params") === "hash" ? "hash" : "search";
    const fieldNames = parseHistoryFieldNames(form.getAttribute("hy-history-fields"));
    form.removeAttribute("hy-history");
    form.removeAttribute("hy-history-params");
    form.removeAttribute("hy-history-fields");
    configs.push({ form, mode, paramsSource, fieldNames });
  }

  return configs;
}

function parseHistoryMode(raw: string): "sync" | "sync-push" | "sync-replace" | null {
  if (!raw) {
    return null;
  }
  if (raw === "sync" || raw === "sync-push" || raw === "sync-replace") {
    return raw;
  }
  if (raw === "push") {
    return "sync-push";
  }
  if (raw === "replace") {
    return "sync-replace";
  }
  return null;
}

function parseHistoryFieldNames(raw: string | null): string[] | null {
  if (!raw) {
    return null;
  }
  const names = raw.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return names.length > 0 ? names : null;
}

function parseAutoSubmitForms(doc: Document, _parseErrors: ParseError[]): AutoSubmitFormConfig[] {
  const forms = Array.from(doc.getElementsByTagName("form")).filter((form) => form.hasAttribute("hy-submit-on"));
  const configs: AutoSubmitFormConfig[] = [];

  for (const form of forms) {
    const rawEvents = form.getAttribute("hy-submit-on");
    if (rawEvents == null) {
      continue;
    }
    const events = parseAutoSubmitEvents(rawEvents);
    if (events.length === 0) {
      continue;
    }
    const debounceMs = parseAutoSubmitDebounce(form.getAttribute("hy-debounce"));
    const composeMode = form.getAttribute("hy-submit-compose") === "blur" ? "blur" : "end";
    form.removeAttribute("hy-submit-on");
    form.removeAttribute("hy-debounce");
    form.removeAttribute("hy-submit-compose");
    configs.push({ form, events, debounceMs, composeMode });
  }

  return configs;
}

function parseAutoSubmitEvents(raw: string): string[] {
  const tokens = raw.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : ["change"];
}

function parseAutoSubmitDebounce(raw: string | null): number {
  if (!raw) {
    return 200;
  }
  if (raw.trim() === "") {
    return 200;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 200;
  }
  return parsed;
}

function parseAsyncUploadForms(doc: Document, parseErrors: ParseError[]): AsyncUploadFormConfig[] {
  const forms = Array.from(doc.getElementsByTagName("form")).filter((form) => form.hasAttribute("hy-async-upload"));
  const configs: AsyncUploadFormConfig[] = [];

  for (const form of forms) {
    const rawModeAttr = form.getAttribute("hy-async-upload");
    const rawMode = rawModeAttr ? rawModeAttr.trim() : "";
    const mode = rawMode === "" ? "simple" : rawMode;
    if (mode !== "s3" && mode !== "simple") {
      parseErrors.push({
        message: "hy-async-upload must be \"s3\" or \"simple\".",
        detail: { formId: form.id || undefined, value: rawModeAttr ?? "" }
      });
      continue;
    }
    const uploaderRaw = form.getAttribute("hy-uploader-url")?.trim() ?? "";
    let uploaderUrl = uploaderRaw || null;
    if (!uploaderUrl && mode === "simple") {
      const action = form.getAttribute("action")?.trim() ?? form.action?.trim() ?? "";
      uploaderUrl = action || null;
    }
    if (!uploaderUrl) {
      parseErrors.push({
        message: mode === "s3" ? "hy-uploader-url is required for async upload." : "Async upload requires uploader URL or form action.",
        detail: { formId: form.id || undefined, mode }
      });
      continue;
    }
    const chunkSizeBytes = parseAsyncUploadChunkSize(form, parseErrors);
    const afterSubmitAttrRaw = form.getAttribute("hy-after-submit-action");
    const afterSubmitAttrPresent = afterSubmitAttrRaw !== null;
    const afterSubmitAttr = afterSubmitAttrRaw?.trim().toLowerCase() ?? "";
    let afterSubmitAction: "keep" | "clear" = "keep";
    if (afterSubmitAttrPresent) {
      if (afterSubmitAttr === "clear") {
        afterSubmitAction = "clear";
      } else if (afterSubmitAttr === "keep" || afterSubmitAttr === "") {
        afterSubmitAction = "keep";
      } else {
        parseErrors.push({
          message: "hy-after-submit-action must be \"clear\" or \"keep\".",
          detail: { formId: form.id || undefined, value: afterSubmitAttrRaw ?? "" }
        });
      }
    }
    const hasRedirectAttr = Boolean(form.getAttribute("hy-redirect")?.trim());
    const redirectConflict = hasRedirectAttr && afterSubmitAttrPresent;
    if (redirectConflict) {
      parseErrors.push({
        message: "hy-redirect and hy-after-submit-action cannot be used together.",
        detail: { formId: form.id || undefined }
      });
    }

    form.removeAttribute("hy-async-upload");
    form.removeAttribute("hy-uploader-url");
    form.removeAttribute("hy-file-chunksize");
    form.removeAttribute("hy-after-submit-action");

    configs.push({
      form,
      mode,
      uploaderUrl,
      chunkSizeBytes,
      afterSubmitAction,
      afterSubmitActionPresent: afterSubmitAttrPresent,
      redirectConflict
    });
  }

  return configs;
}

function parseFormStateCandidates(doc: Document): FormStateCandidate[] {
  const formElements = Array.from(doc.querySelectorAll("form[hy-form-state]")) as HTMLFormElement[];
  const elements = Array.from(doc.querySelectorAll("[hy-form-state]"));
  const candidates: FormStateCandidate[] = [];
  const formOwners = new Set<HTMLFormElement>();
  for (const form of formElements) {
    const raw = form.getAttribute("hy-form-state");
    form.removeAttribute("hy-form-state");
    if (raw === null) {
      continue;
    }
    formOwners.add(form);
    candidates.push({ form, owner: form, raw });
  }
  for (const element of elements) {
    if (element instanceof HTMLFormElement) {
      continue;
    }
    const raw = element.getAttribute("hy-form-state");
    element.removeAttribute("hy-form-state");
    if (raw === null) {
      continue;
    }
    if (!isFormStateSubmitter(element)) {
      continue;
    }
    const form = getSubmitterForm(element);
    if (!form) {
      continue;
    }
    if (formOwners.has(form)) {
      continue;
    }
    candidates.push({ form, owner: element, raw });
  }
  return candidates;
}

function isFormStateSubmitter(element: Element): element is HTMLButtonElement | HTMLInputElement {
  if (element instanceof HTMLButtonElement || isTagName(element, "button")) {
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    return type === "" || type === "submit";
  }
  if (element instanceof HTMLInputElement || isTagName(element, "input")) {
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    return type === "submit" || type === "image";
  }
  return false;
}

function parseTables(doc: Document): { tables: TableConfig[]; diagnostics: TableDiagnostic[] } {
  const diagnostics: TableDiagnostic[] = [];
  const tables = Array.from(doc.getElementsByTagName("table")).filter(
    (table): table is HTMLTableElement => (table instanceof HTMLTableElement || isTagName(table, "table")) && table.hasAttribute("hy-table-data")
  );
  const tableIdGroups = new Map<string, HTMLTableElement[]>();

  for (const table of tables) {
    const rawId = table.getAttribute("hy-table-data") ?? "";
    const tableId = rawId.trim();
    table.removeAttribute("hy-table-data");
    if (!tableId) {
      pushTableDiagnostic(diagnostics, "hy-table-data is required for table enhancement.", {
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

  const configs: TableConfig[] = [];
  for (const [tableId, group] of tableIdGroups) {
    if (group.length > 1) {
      for (const table of group) {
        pushTableDiagnostic(diagnostics, `Duplicate hy-table-data value "${tableId}" detected.`, {
          attribute: "hy-table-data",
          selector: buildTableSelector(tableId)
        });
      }
      continue;
    }
    const table = group[0];
    const headerRow = findHeaderRow(table);
    if (!headerRow) {
      pushTableDiagnostic(diagnostics, "Table header row (<thead><th>) is required for extable enhancement.", {
        attribute: "hy-table-data",
        selector: buildTableSelector(tableId)
      });
      continue;
    }
    const columns = parseColumns(tableId, headerRow, diagnostics);
    if (columns.length === 0) {
      pushTableDiagnostic(diagnostics, "No valid columns were found for table enhancement.", {
        attribute: "hy-column",
        selector: buildTableSelector(tableId)
      });
      continue;
    }
    const optionsResult = parseTableOptions(tableId, table, diagnostics);
    configs.push({
      table,
      tableId,
      dataPath: tableId.trim() || null,
      options: optionsResult.options,
      columns,
      bindShortcut: optionsResult.bindShortcut
    });
  }

  return { tables: configs, diagnostics };
}

function findHeaderRow(table: HTMLTableElement): HTMLTableRowElement | null {
  const thead = table.tHead ?? (table.querySelector("thead") as HTMLTableSectionElement | null);
  if (!thead) {
    return null;
  }
  const rows = Array.from(thead.querySelectorAll("tr"));
  for (const row of rows) {
    const hasTh = Array.from(row.children).some((child) => child.tagName.toLowerCase() === "th");
    if (hasTh) {
      return row as HTMLTableRowElement;
    }
  }
  return null;
}

function parseColumns(tableId: string, row: HTMLTableRowElement, diagnostics: TableDiagnostic[]): TableColumnConfig[] {
  const columns: TableColumnConfig[] = [];
  const cells = Array.from(row.children).filter((child) => child.tagName.toLowerCase() === "th") as HTMLTableCellElement[];
  for (const cell of cells) {
    const columnDefinition = parseColumnDefinition(tableId, cell, diagnostics);
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
  diagnostics: TableDiagnostic[]
): TableColumnConfig | null {
  const columnAttr = cell.getAttribute("hy-column") ?? "";
  cell.removeAttribute("hy-column");
  const declarations = parseDeclarationList(columnAttr);
  const key = declarations.find((entry) => entry.key === "key")?.value ?? "";
  if (!key) {
    pushTableDiagnostic(diagnostics, "hy-column requires a key entry.", {
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

function parseColumnType(typeValue: string): TableColumnConfig["type"] {
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

function parseTableOptions(
  tableId: string,
  table: HTMLTableElement,
  diagnostics: TableDiagnostic[]
): { options: TableOptions; bindShortcut: boolean } {
  const options: TableOptions = {};
  let bindShortcut = false;
  const raw = table.getAttribute("hy-table-option") ?? "";
  table.removeAttribute("hy-table-option");
  const declarations = parseDeclarationList(raw);
  for (const entry of declarations) {
    const key = entry.key.toLowerCase();
    if (key === "render-mode") {
      const renderMode = parseRenderMode(entry.value);
      if (renderMode) {
        options.renderMode = renderMode;
      } else {
        pushTableDiagnostic(diagnostics, `Invalid hy-table-option value "${entry.value}" for "${entry.key}".`, {
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
        pushTableDiagnostic(diagnostics, `Invalid hy-table-option value "${entry.value}" for "${entry.key}".`, {
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
        pushTableDiagnostic(diagnostics, `Invalid hy-table-option value "${entry.value}" for "${entry.key}".`, {
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
        pushTableDiagnostic(diagnostics, `Invalid hy-table-option value "${entry.value}" for "${entry.key}".`, {
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

    pushTableDiagnostic(diagnostics, `Unknown hy-table-option key "${entry.key}".`, {
      attribute: "hy-table-option",
      selector: buildTableSelector(tableId),
      context: entry.key
    });
  }
  return { options, bindShortcut };
}

function parseRenderMode(value: string): TableOptions["renderMode"] {
  switch (value.trim().toLowerCase()) {
    case "html":
    case "canvas":
    case "auto":
      return value.trim().toLowerCase() as TableOptions["renderMode"];
    default:
      return undefined;
  }
}

function parseEditMode(value: string): TableOptions["editMode"] {
  switch (value.trim().toLowerCase()) {
    case "direct":
    case "commit":
    case "readonly":
      return value.trim().toLowerCase() as TableOptions["editMode"];
    default:
      return undefined;
  }
}

function parseLockMode(value: string): TableOptions["lockMode"] {
  switch (value.trim().toLowerCase()) {
    case "none":
    case "row":
      return value.trim().toLowerCase() as TableOptions["lockMode"];
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

function buildTableSelector(tableId: string): string {
  const escaped = tableId.replace(/"/g, "\\\"");
  return `table[hy-table-data="${escaped}"]`;
}

function pushTableDiagnostic(
  diagnostics: TableDiagnostic[],
  message: string,
  detail?: TableDiagnostic["detail"]
): void {
  diagnostics.push({ message, detail });
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

function stripRedirectAttributes(doc: Document): void {
  const elements = Array.from(doc.querySelectorAll("[hy-redirect]"));
  for (const element of elements) {
    element.removeAttribute("hy-redirect");
  }
}

const ASYNC_UPLOAD_DEFAULT_CHUNK_SIZE_MIB = 10;
const ASYNC_UPLOAD_MIN_CHUNK_SIZE_MIB = 5;

function parseAsyncUploadChunkSize(form: HTMLFormElement, parseErrors: ParseError[]): number {
  const raw = form.getAttribute("hy-file-chunksize");
  if (raw == null || raw.trim() === "") {
    return ASYNC_UPLOAD_DEFAULT_CHUNK_SIZE_MIB * 1024 * 1024;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    parseErrors.push({
      message: "hy-file-chunksize must be a positive number.",
      detail: { formId: form.id || undefined, value: raw }
    });
    return ASYNC_UPLOAD_DEFAULT_CHUNK_SIZE_MIB * 1024 * 1024;
  }
  const normalized = Math.max(parsed, ASYNC_UPLOAD_MIN_CHUNK_SIZE_MIB);
  return normalized * 1024 * 1024;
}

export function parseImportTargets(root: ParentNode): ImportTarget[] {
  const elements = selectWithRoot(root, "hy-import");
  const targets: ImportTarget[] = [];

  for (const element of elements) {
    const src = element.getAttribute("src");
    if (!src) {
      continue;
    }
    targets.push({
      element,
      src,
      exportName: element.getAttribute("hy-export"),
      withExpression: element.getAttribute("hy-with")
    });
  }

  return targets;
}

interface ImportSource {
  doc: Document;
  baseUrl: string;
}

export async function resolveImports(
  doc: Document,
  options: { onLog?: (entry: ImportLogEntry) => void } = {}
): Promise<ImportError[]> {
  const baseUrl = doc.baseURI ?? doc.defaultView?.location?.href ?? "";
  const cache = new Map<string, Promise<ImportSource>>();
  const errors: ImportError[] = [];
  await resolveImportsInRoot(doc, doc, baseUrl, new Set(), cache, errors, options.onLog);
  return errors;
}

async function resolveImportsInRoot(
  doc: Document,
  root: ParentNode,
  baseUrl: string,
  stack: Set<string>,
  cache: Map<string, Promise<ImportSource>>,
  errors: ImportError[],
  onLog?: (entry: ImportLogEntry) => void
): Promise<void> {
  const targets = parseImportTargets(root);
  for (const target of targets) {
    const resolvedUrl = resolveImportUrl(target.src, baseUrl);
    if (!resolvedUrl) {
      errors.push({ message: "Import src is invalid.", url: target.src, method: "IMPORT" });
      onLog?.({
        type: "error",
        message: "import:invalid",
        detail: { src: target.src },
        timestamp: Date.now()
      });
      target.element.remove();
      continue;
    }
    if (stack.has(resolvedUrl)) {
      errors.push({ message: "Import recursion detected.", url: resolvedUrl, method: "IMPORT" });
      onLog?.({
        type: "error",
        message: "import:recursion",
        detail: { url: resolvedUrl },
        timestamp: Date.now()
      });
      target.element.remove();
      continue;
    }

    let source: ImportSource;
    try {
      onLog?.({
        type: "info",
        message: "import:fetch",
        detail: { url: resolvedUrl },
        timestamp: Date.now()
      });
      source = await fetchImportSource(resolvedUrl, cache);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ message, url: resolvedUrl, method: "IMPORT" });
      onLog?.({
        type: "error",
        message: "import:error",
        detail: { url: resolvedUrl, message },
        timestamp: Date.now()
      });
      target.element.remove();
      continue;
    }

    const nextStack = new Set(stack);
    nextStack.add(resolvedUrl);
    await resolveImportsInRoot(doc, source.doc, source.baseUrl, nextStack, cache, errors, onLog);

    const selection = selectImportExports(source.doc, target.exportName);
    const contentNodes = selection.contentNodes.map((node) => doc.importNode(node, true));
    const assetNodes = selection.assetNodes.map((node) => doc.importNode(node, true));

    for (const node of [...contentNodes, ...assetNodes]) {
      if (node instanceof Element) {
        node.removeAttribute("hy-export");
      }
    }

    ensureUniqueIds(contentNodes, doc);
    mergeAssets(assetNodes, doc, source.baseUrl);
    replaceImportTarget(target.element, contentNodes);
    onLog?.({
      type: "render",
      message: "import:replace",
      detail: {
        url: resolvedUrl,
        contentCount: contentNodes.length,
        assetCount: assetNodes.length
      },
      timestamp: Date.now()
    });
  }
}

function resolveImportUrl(src: string, baseUrl: string): string | null {
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fetchImportSource(
  url: string,
  cache: Map<string, Promise<ImportSource>>
): Promise<ImportSource> {
  const cached = cache.get(url);
  if (cached) {
    return cached;
  }

  const promise = fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Import failed: ${response.status}`);
    }
    const html = await response.text();
    return { doc: parseImportDocument(html), baseUrl: url };
  });

  cache.set(url, promise);
  return promise;
}

function replaceImportTarget(target: Element, nodes: Element[]): void {
  const doc = target.ownerDocument;
  if (!doc) {
    target.remove();
    return;
  }
  const fragment = doc.createDocumentFragment();
  for (const node of nodes) {
    fragment.append(node);
  }
  target.replaceWith(fragment);
}

function mergeAssets(nodes: Element[], doc: Document, baseUrl: string): void {
  if (!doc.head) {
    return;
  }
  for (const node of nodes) {
    resolveAssetUrl(node, baseUrl);
    doc.head.appendChild(node);
  }
}

function resolveAssetUrl(node: Element, baseUrl: string): void {
  if (node instanceof HTMLLinkElement && node.getAttribute("href")) {
    node.href = new URL(node.getAttribute("href") ?? "", baseUrl).toString();
  }
  if (node instanceof HTMLScriptElement && node.getAttribute("src")) {
    node.src = new URL(node.getAttribute("src") ?? "", baseUrl).toString();
  }
}

function ensureUniqueIds(nodes: Element[], doc: Document): void {
  const seen = new Set<string>();
  const existing = (id: string) => doc.getElementById(id) !== null || seen.has(id);

  for (const root of nodes) {
    const elements = [root, ...Array.from(root.querySelectorAll("[id]"))];
    for (const element of elements) {
      const id = element.getAttribute("id");
      if (!id) {
        continue;
      }
      if (existing(id)) {
        element.removeAttribute("id");
        continue;
      }
      seen.add(id);
    }
  }
}

function parseForTemplates(root: ParentNode, parseErrors: ParseError[]): ForTemplate[] {
  const elements = selectWithRoot(root, "[hy-for]");
  const templates: ForTemplate[] = [];

  for (const element of elements) {
    const expression = element.getAttribute("hy-for") ?? "";
    const config = parseForExpression(expression);
    if (!config) {
      parseErrors.push({
        message: "hy-for must be in `item of items` form with valid identifiers.",
        detail: { expression }
      });
      continue;
    }
    if (!isValidSelectorSyntax(config.selector)) {
      parseErrors.push({
        message: "hy-for selector is invalid.",
        detail: { selector: config.selector, expression }
      });
      continue;
    }

    const doc = element.ownerDocument ?? (root instanceof Document ? root : null);
    if (!doc) {
      continue;
    }

    const marker = createAnchorElement(doc, "for");
    const template = element.cloneNode(true) as Element;
    template.removeAttribute("hy-for");

    element.parentNode?.insertBefore(marker, element);
    element.remove();

    templates.push({
      marker,
      template,
      varName: config.varName,
      selector: config.selector,
      rendered: []
    });
  }

  return templates;
}

function parseForExpression(expression: string): { varName: string; selector: string } | null {
  const match = expression.match(/^\s*([A-Za-z_$][\w$]*)\s+of\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    varName: match[1],
    selector: match[2].trim()
  };
}

function isValidSelectorSyntax(selector: string): boolean {
  if (!selector) {
    return false;
  }
  let cursor = 0;
  const length = selector.length;

  const readIdentifier = (): boolean => {
    const match = selector.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
    if (!match) {
      return false;
    }
    cursor += match[1].length;
    return true;
  };

  if (!readIdentifier()) {
    return false;
  }

  while (cursor < length) {
    const char = selector[cursor];
    if (char === ".") {
      cursor += 1;
      if (!readIdentifier()) {
        return false;
      }
      continue;
    }

    if (char === "[") {
      cursor += 1;
      while (selector[cursor] === " ") {
        cursor += 1;
      }
      const quote = selector[cursor];
      if (quote === "'" || quote === "\"") {
        cursor += 1;
        while (cursor < length) {
          if (selector[cursor] === "\\" && cursor + 1 < length) {
            cursor += 2;
            continue;
          }
          if (selector[cursor] === quote) {
            break;
          }
          cursor += 1;
        }
        if (cursor >= length) {
          return false;
        }
        cursor += 1;
      } else {
        const end = selector.indexOf("]", cursor);
        if (end === -1) {
          return false;
        }
        const raw = selector.slice(cursor, end).trim();
        if (!raw) {
          return false;
        }
        cursor = end;
      }

      while (cursor < length && selector[cursor] !== "]") {
        cursor += 1;
      }
      if (selector[cursor] !== "]") {
        return false;
      }
      cursor += 1;
      continue;
    }

    return false;
  }

  return true;
}

function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function parseIfChains(root: ParentNode): IfChain[] {
  const ifElements = selectWithRoot(root, "[hy-if]");
  const processed = new WeakSet<Element>();
  const chains: IfChain[] = [];
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (!doc) {
    return chains;
  }

  for (const element of ifElements) {
    if (processed.has(element)) {
      continue;
    }

    const chain: Element[] = [element];
    let cursor: ChildNode | null = element.nextSibling;

    while (cursor) {
      if (cursor.nodeType === Node.COMMENT_NODE) {
        cursor = cursor.nextSibling;
        continue;
      }
      if (cursor.nodeType === Node.TEXT_NODE) {
        if (cursor.textContent?.trim() === "") {
          cursor = cursor.nextSibling;
          continue;
        }
        break;
      }
      if (cursor instanceof Element) {
        if (cursor.hasAttribute("hy-dummy")) {
          cursor = cursor.nextSibling;
          continue;
        }
        if (cursor.hasAttribute("hy-else-if") || cursor.hasAttribute("hy-else")) {
          chain.push(cursor);
          cursor = cursor.nextSibling;
          continue;
        }
      }
      break;
    }

    for (const node of chain) {
      processed.add(node);
    }

    const parent = element.parentNode;
    if (!parent) {
      continue;
    }
    const anchor = createAnchorElement(doc, "if");
    parent.insertBefore(anchor, element);
    const nodes = chain.map((node) => {
      let kind: "if" | "else-if" | "else" = "else";
      let expression: string | null = null;
      if (node.hasAttribute("hy-if")) {
        kind = "if";
        expression = node.getAttribute("hy-if") ?? "";
      } else if (node.hasAttribute("hy-else-if")) {
        kind = "else-if";
        expression = node.getAttribute("hy-else-if") ?? "";
      }
      node.removeAttribute("hy-if");
      node.removeAttribute("hy-else-if");
      node.removeAttribute("hy-else");
      return { node, kind, expression };
    });

    chains.push({ anchor, nodes });
  }

  return chains;
}

function parseTextBindings(root: ParentNode): TextBinding[] {
  return selectWithRoot(root, "[hy]").map((element) => ({
    element,
    expression: element.getAttribute("hy") ?? ""
  }));
}

function parseAttrBindings(root: ParentNode): AttrBinding[] {
  const bindings: AttrBinding[] = [];
  const allElements = selectAllWithRoot(root);

  for (const element of allElements) {
    const attrs = element.getAttributeNames().filter((name) => name.startsWith("hy-attr-"));
    for (const attr of attrs) {
      const target = attr.slice("hy-attr-".length);
      bindings.push({
        element,
        attr,
        target,
        template: element.getAttribute(attr) ?? ""
      });
    }
    if (element.hasAttribute("hy-href")) {
      bindings.push({
        element,
        attr: "hy-href",
        target: "href",
        template: element.getAttribute("hy-href") ?? ""
      });
    }
  }

  return bindings;
}

function parseHrefBindings(root: ParentNode): AttrBinding[] {
  const bindings: AttrBinding[] = [];
  const anchors = selectWithRoot(root, "a[href]");
  for (const element of anchors) {
    if (element.hasAttribute("hy-attr-href")) {
      continue;
    }
    const template = element.getAttribute("href");
    if (!template || !template.includes("[")) {
      continue;
    }
    bindings.push({
      element,
      attr: "href",
      target: "href",
      template
    });
  }
  return bindings;
}

function parseFillTargets(root: ParentNode): FillTarget[] {
  const elements = selectWithRoot(root, "form[hy-fill]");
  const targets: FillTarget[] = [];

  for (const element of elements) {
    const selector = element.getAttribute("hy-fill");
    element.removeAttribute("hy-fill");
    if (!selector || !isFormElement(element)) {
      continue;
    }
    targets.push({ form: element as HTMLFormElement, selector });
  }

  return targets;
}

function parseFillActions(root: ParentNode, parseErrors: ParseError[]): FillAction[] {
  const elements = selectWithRoot(root, "[hy-fill]");
  const actions: FillAction[] = [];

  for (const element of elements) {
    const selector = element.getAttribute("hy-fill");
    const value = element.getAttribute("hy-value");
    const command = element.getAttribute("command");
    const commandFor = element.getAttribute("commandfor");
    element.removeAttribute("hy-fill");
    element.removeAttribute("hy-value");
    element.removeAttribute("command");
    element.removeAttribute("commandfor");
    if (!selector) {
      continue;
    }
    if (element instanceof HTMLFormElement) {
      continue;
    }
    const form = element.closest("form");
    const resolved = resolveFillTargetElement(
      element,
      form instanceof HTMLFormElement ? form : null,
      selector,
      parseErrors
    );
    if (!resolved.target) {
      continue;
    }
    actions.push({
      element,
      selector: resolved.selector ?? selector,
      value,
      form: form instanceof HTMLFormElement ? form : null,
      command,
      commandFor,
      target: resolved.target
    });
  }

  return actions;
}

function resolveFillTargetElement(
  element: Element,
  form: HTMLFormElement | null,
  selectorRaw: string | null,
  parseErrors: ParseError[]
): { target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null; selector: string | null } {
  if (selectorRaw == null) {
    return { target: null, selector: null };
  }
  const selector = selectorRaw.trim();
  if (!selector) {
    parseErrors.push({
      message: "hy-fill requires a non-empty selector.",
      detail: { selector: selectorRaw }
    });
    return { target: null, selector };
  }
  const root: ParentNode | null = form ?? element.ownerDocument ?? (element instanceof Document ? element : null);
  if (!root) {
    return { target: null, selector };
  }
  let matches: Element[];
  try {
    matches = Array.from(root.querySelectorAll(selector));
  } catch (error) {
    parseErrors.push({
      message: "hy-fill selector is invalid.",
      detail: { selector, error: error instanceof Error ? error.message : String(error) }
    });
    return { target: null, selector };
  }
  const controls = matches.filter(isFillControlElement);
  if (controls.length === 0) {
    parseErrors.push({
      message: "hy-fill selector did not match any control.",
      detail: { selector }
    });
    return { target: null, selector };
  }
  if (controls.length > 1) {
    parseErrors.push({
      message: "hy-fill selector matched multiple controls.",
      detail: { selector }
    });
    return { target: null, selector };
  }
  return { target: controls[0], selector };
}

function resolveFillIntoForms(
  doc: Document,
  selectorRaw: string | null,
  parseErrors: ParseError[]
): { forms: HTMLFormElement[]; selector: string | null } {
  if (selectorRaw == null) {
    return { forms: [], selector: null };
  }
  const selector = selectorRaw.trim();
  if (!selector) {
    parseErrors.push({
      message: "fill-into requires a non-empty selector.",
      detail: { selector: selectorRaw }
    });
    return { forms: [], selector };
  }
  let matches: Element[];
  try {
    matches = Array.from(doc.querySelectorAll(selector));
  } catch (error) {
    parseErrors.push({
      message: "fill-into selector is invalid.",
      detail: { selector, error: error instanceof Error ? error.message : String(error) }
    });
    return { forms: [], selector };
  }
  const forms = matches.filter((element): element is HTMLFormElement => element instanceof HTMLFormElement);
  if (forms.length === 0) {
    parseErrors.push({
      message: "fill-into selector did not match any form.",
      detail: { selector }
    });
  }
  return { forms, selector };
}

function isFillControlElement(
  element: Element
): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

function removeDummyElements(root: ParentNode): void {
  const dummyElements = selectWithRoot(root, "[hy-dummy]");
  for (const element of dummyElements) {
    element.remove();
  }
}

function createAnchorElement(doc: Document, kind: "for" | "if"): Element {
  const anchor = doc.createElement("hy-anchor");
  anchor.setAttribute("hidden", "hy-ignore");
  anchor.setAttribute("data-hy-anchor", kind);
  return anchor;
}

function createIdResolver(doc: Document): (element: Element) => NodeId {
  let counter = 0;
  const prefix = "hy-id-";
  const used = new Set<string>();

  const nextId = (): string => {
    let candidate = "";
    do {
      candidate = `${prefix}${counter.toString(36)}`;
      counter += 1;
    } while (doc.getElementById(candidate) || used.has(candidate));
    used.add(candidate);
    return candidate;
  };

  return (element: Element): NodeId => {
    const existing = element.getAttribute("id");
    if (existing && existing.trim() !== "") {
      used.add(existing);
      return existing;
    }
    const id = nextId();
    element.setAttribute("id", id);
    return id;
  };
}

function detectErrorHandling(doc: Document): { handlesErrors: boolean; hasErrorPopover: boolean } {
  const popover = doc.getElementById("hy-error");
  const hasErrorPopover = Boolean(popover && popover.hasAttribute("popover"));
  if (hasErrorPopover) {
    return { handlesErrors: true, hasErrorPopover };
  }

  const candidates = Array.from(doc.querySelectorAll("[hy],[hy-if],[hy-else-if]"));
  for (const element of candidates) {
    for (const attr of ["hy", "hy-if", "hy-else-if"]) {
      const value = element.getAttribute(attr);
      if (value && value.includes("hy.errors")) {
        return { handlesErrors: true, hasErrorPopover };
      }
    }
  }

  const allElements = selectAllWithRoot(doc);
  for (const element of allElements) {
    const attrs = element.getAttributeNames().filter((name) => name.startsWith("hy-attr-"));
    for (const attr of attrs) {
      const value = element.getAttribute(attr);
      if (value && value.includes("hy.errors")) {
        return { handlesErrors: true, hasErrorPopover };
      }
    }
  }

  return { handlesErrors: false, hasErrorPopover };
}

function isAssetNode(node: Element): boolean {
  const tag = node.tagName.toLowerCase();
  return tag === "script" || tag === "style" || tag === "link";
}

function selectWithRoot(root: ParentNode, selector: string): Element[] {
  const elements = Array.from(root.querySelectorAll(selector));
  if (root instanceof Element && root.matches(selector)) {
    elements.unshift(root);
  }
  return elements;
}

function selectAllWithRoot(root: ParentNode): Element[] {
  const elements = Array.from(root.querySelectorAll("*"));
  if (root instanceof Element) {
    elements.unshift(root);
  }
  return elements;
}
