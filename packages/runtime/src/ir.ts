import type {
  ParsedAttrBinding,
  ParsedDocument,
  ParsedFillAction,
  ParsedFillTarget,
  ParsedForTemplate,
  ParsedIfChain,
  ParsedIfChainNode,
  ParsedRequestTarget,
  ParsedTextBinding,
  ParsedExpression,
  TemplateToken
} from "./types.js";
import type { RuntimeState } from "./state.js";
import { expandKeys, normalizeIrDocument } from "./key-mapping.js";

export type NodeId = string;

export interface IrBase {
  executionMode: "production" | "mock" | "disable";
}

export interface IrTextBinding {
  nodeId: NodeId;
  expression: string;
  expressionParts?: ParsedExpression;
}

export interface IrHeadBinding {
  nodeId: NodeId;
  kind: "title" | "meta" | "link";
  target: "text" | "attr";
  attr?: string;
  sourceAttr: string;
  expression?: string;
  expressionParts?: ParsedExpression;
  template?: string;
  templateTokens?: TemplateToken[];
}

export interface IrAttrBinding {
  nodeId: NodeId;
  attr: string;
  target: string;
  template: string;
  templateTokens?: TemplateToken[];
}

export interface IrForTemplate {
  markerId: NodeId;
  templateHtml: string;
  varName: string;
  selector: string;
  selectorParts?: ParsedExpression;
}

export interface IrIfChainNode {
  nodeId: NodeId;
  kind: "if" | "else-if" | "else";
  expression: string | null;
  expressionParts?: ParsedExpression | null;
}

export interface IrIfChain {
  anchorId: NodeId;
  nodes: IrIfChainNode[];
}

export interface IrRequestTarget {
  elementId: NodeId;
  urlTemplate: string;
  templateTokens?: TemplateToken[];
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

export interface IrResourceItem {
  href?: string;
  src?: string;
  critical?: boolean;
  async?: boolean;
  defer?: boolean;
  integrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";
}

export interface IrHtmlMetadata {
  title?: string;
  htmlAttrs?: Record<string, string>;
  bodyAttrs?: Record<string, string>;
  preserveIds?: NodeId[];
}

export interface IrDocument extends IrBase {
  mockRules: unknown[];
  parseErrors: Array<{ message: string; detail?: Record<string, unknown> }>;
  handlesErrors: boolean;
  hasErrorPopover: boolean;
  transforms?: string | null;
  transformScripts?: string | null;
  resources?: {
    css: IrResourceItem[];
    js: IrResourceItem[];
    prefetch: string[];
  };
  routePath?: string;
  html?: IrHtmlMetadata;
  textBindings: IrTextBinding[];
  headBindings: IrHeadBinding[];
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

export function buildParsedDocumentFromIr(doc: Document, ir: IrDocument): ParsedDocument {
  assertCompactIr(ir);
  const normalizedIr = normalizeIrDocument(expandKeys(ir) as IrDocument);
  const resolveElement = (id: NodeId, label: string): Element => {
    const element = doc.getElementById(id);
    if (!element) {
      throw new Error(`[hytde] missing element for ${label}: ${id}`);
    }
    return element;
  };

  const toTemplateElement = (html: string): Element => {
    const container = doc.createElement("template");
    container.innerHTML = html;
    const element = container.content.firstElementChild;
    if (!element) {
      throw new Error("[hytde] template HTML did not yield an element.");
    }
    if (container.content.childElementCount !== 1) {
      throw new Error("[hytde] template HTML must contain a single root element.");
    }
    return element;
  };

  const textBindings: ParsedTextBinding[] = normalizedIr.textBindings.map((binding) => ({
    element: resolveElement(binding.nodeId, "textBinding"),
    expression: binding.expressionParts ?? { selector: binding.expression, transforms: [] }
  }));

  const headBindings = (normalizedIr.headBindings ?? []).map((binding) => ({
    element: resolveElement(binding.nodeId, "headBinding"),
    kind: binding.kind,
    target: binding.target,
    attr: binding.attr,
    sourceAttr: binding.sourceAttr,
    expression: binding.expressionParts
      ?? (binding.expression ? { selector: binding.expression, transforms: [] } : undefined),
    template: binding.template,
    templateTokens: binding.templateTokens
  }));

  const attrBindings: ParsedAttrBinding[] = normalizedIr.attrBindings.map((binding) => ({
    element: resolveElement(binding.nodeId, "attrBinding"),
    attr: binding.attr,
    target: binding.target,
    template: binding.template,
    templateTokens: binding.templateTokens
  }));

  const forTemplates: ParsedForTemplate[] = normalizedIr.forTemplates.map((template) => {
    const marker = resolveElement(template.markerId, "forTemplate.marker");
    const markerId = marker.getAttribute("id") ?? "";
    const rendered =
      markerId === ""
        ? []
        : Array.from(doc.querySelectorAll(`[id^="${markerId}-item-"]`));
    return {
      marker,
      template: toTemplateElement(template.templateHtml),
      varName: template.varName,
      selector: template.selector,
      selectorExpression: template.selectorParts ?? { selector: template.selector, transforms: [] },
      rendered
    };
  });

  const ifChains: ParsedIfChain[] = normalizedIr.ifChains.map((chain) => ({
    anchor: resolveElement(chain.anchorId, "ifChain.anchor"),
    nodes: (chain.nodes ?? []).map((node): ParsedIfChainNode => ({
      node: resolveElement(node.nodeId, "ifChain.node"),
      kind: node.kind,
      expression: node.expressionParts ?? (node.expression ? { selector: node.expression, transforms: [] } : null)
    }))
  }));

  const requestTargets: ParsedRequestTarget[] = normalizedIr.requestTargets.map((target) => ({
    element: resolveElement(target.elementId, "requestTarget.element"),
    urlTemplate: target.urlTemplate,
    templateTokens: target.templateTokens,
    store: target.store,
    unwrap: target.unwrap,
    method: target.method,
    kind: target.kind,
    streamInitial: target.streamInitial,
    streamTimeoutMs: target.streamTimeoutMs,
    streamKey: target.streamKey,
    pollIntervalMs: target.pollIntervalMs,
    isForm: Boolean(target.isForm),
    trigger: target.trigger,
    actionDebounceMs: target.actionDebounceMs,
    redirect: target.redirect,
    form: target.formId ? (resolveElement(target.formId, "requestTarget.form") as HTMLFormElement) : null,
    fillIntoForms: (target.fillIntoIds ?? []).map(
      (id) => resolveElement(id, "requestTarget.fillInto") as HTMLFormElement
    ),
    fillIntoSelector: null,
    fillTargetElement: target.fillTargetId
      ? (resolveElement(target.fillTargetId, "requestTarget.fillTarget") as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
      : null,
    fillTargetSelector: target.fillTargetSelector ?? null,
    fillValue: target.fillValue
  }));

  const fillTargets: ParsedFillTarget[] = normalizedIr.fillTargets.map((target) => ({
    form: resolveElement(target.formId, "fillTarget.form") as HTMLFormElement,
    selector: target.selector
  }));

  const fillActions: ParsedFillAction[] = normalizedIr.fillActions.map((action) => ({
    element: resolveElement(action.elementId, "fillAction.element"),
    selector: action.selector,
    value: action.value,
    form: action.formId ? (resolveElement(action.formId, "fillAction.form") as HTMLFormElement) : null,
    command: action.command,
    commandFor: action.commandFor,
    target: action.targetId
      ? (resolveElement(action.targetId, "fillAction.target") as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
      : null
  }));

  const historyForms = normalizedIr.historyForms.map((entry) => ({
    form: resolveElement(entry.formId, "history.form") as HTMLFormElement,
    mode: entry.mode,
    paramsSource: entry.paramsSource,
    fieldNames: entry.fieldNames
  }));

  const autoSubmitForms = normalizedIr.autoSubmitForms.map((entry) => ({
    form: resolveElement(entry.formId, "autoSubmit.form") as HTMLFormElement,
    events: entry.events ?? [],
    debounceMs: entry.debounceMs,
    composeMode: entry.composeMode
  }));

  const asyncUploadForms = normalizedIr.asyncUploadForms.map((entry) => ({
    form: resolveElement(entry.formId, "asyncUpload.form") as HTMLFormElement,
    mode: entry.mode,
    uploaderUrl: entry.uploaderUrl,
    chunkSizeBytes: entry.chunkSizeBytes,
    afterSubmitAction: entry.afterSubmitAction,
    afterSubmitActionPresent: Boolean(entry.afterSubmitActionPresent),
    redirectConflict: Boolean(entry.redirectConflict)
  }));

  const formStateCandidates = normalizedIr.formStateCandidates.map((candidate) => ({
    form: resolveElement(candidate.formId, "formState.form") as HTMLFormElement,
    owner: resolveElement(candidate.ownerId, "formState.owner") as HTMLElement,
    raw: candidate.raw
  }));

  const tables = normalizedIr.tables.map((table) => ({
    table: resolveElement(table.tableElementId, "table.element") as HTMLTableElement,
    tableId: table.tableId,
    dataPath: table.dataPath,
    options: table.options ?? {},
    columns: table.columns ?? [],
    bindShortcut: Boolean(table.bindShortcut)
  }));

  return {
    doc,
    executionMode: normalizedIr.executionMode,
    mockRules: normalizedIr.mockRules,
    parseErrors: normalizedIr.parseErrors,
    requestTargets,
    handlesErrors: normalizedIr.handlesErrors,
    hasErrorPopover: normalizedIr.hasErrorPopover,
    dummyElements: [],
    cloakElements: normalizedIr.cloakElementIds.map((id) => resolveElement(id, "cloakElement")),
    forTemplates,
    ifChains,
    textBindings,
    headBindings,
    attrBindings,
    fillTargets,
    fillActions,
    historyForms,
    autoSubmitForms,
    asyncUploadForms,
    formStateCandidates,
    tables,
    tableDiagnostics: normalizedIr.tableDiagnostics
  };
}

export function requireRuntimeIr(state: RuntimeState): IrDocument {
  return state.parsed as unknown as IrDocument;
}

function assertCompactIr(ir: IrDocument): void {
  if (ir && typeof ir === "object") {
    const obj = ir as unknown as Record<string, unknown>;
    if ("executionMode" in obj || "textBindings" in obj || "requestTargets" in obj) {
      throw new Error("[hytde] verbose IR format is not supported. Regenerate with compact output.");
    }
  }
}
