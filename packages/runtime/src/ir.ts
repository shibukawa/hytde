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
  ParsedExpression
} from "./types";
import type { RuntimeState } from "./state";

export type NodeId = string;

export interface IrBase {
  executionMode: "production" | "mock" | "disable";
}

export interface IrTextBinding {
  nodeId: NodeId;
  expression: string;
  expressionParts?: ParsedExpression;
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
  mockRules: unknown[];
  parseErrors: Array<{ message: string; detail?: Record<string, unknown> }>;
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

export function buildParsedDocumentFromIr(doc: Document, ir: IrDocument): ParsedDocument {
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

  const textBindings: ParsedTextBinding[] = ir.textBindings.map((binding) => ({
    element: resolveElement(binding.nodeId, "textBinding"),
    expression: binding.expressionParts ?? binding.expression
  }));

  const attrBindings: ParsedAttrBinding[] = ir.attrBindings.map((binding) => ({
    element: resolveElement(binding.nodeId, "attrBinding"),
    attr: binding.attr,
    target: binding.target,
    template: binding.template
  }));

  const forTemplates: ParsedForTemplate[] = ir.forTemplates.map((template) => ({
    marker: resolveElement(template.markerId, "forTemplate.marker"),
    template: toTemplateElement(template.templateHtml),
    varName: template.varName,
    selector: template.selector,
    selectorExpression: template.selectorParts ?? undefined,
    rendered: []
  }));

  const ifChains: ParsedIfChain[] = ir.ifChains.map((chain) => ({
    anchor: resolveElement(chain.anchorId, "ifChain.anchor"),
    nodes: chain.nodes.map((node): ParsedIfChainNode => ({
      node: resolveElement(node.nodeId, "ifChain.node"),
      kind: node.kind,
      expression: node.expressionParts ?? node.expression
    }))
  }));

  const requestTargets: ParsedRequestTarget[] = ir.requestTargets.map((target) => ({
    element: resolveElement(target.elementId, "requestTarget.element"),
    urlTemplate: target.urlTemplate,
    store: target.store,
    unwrap: target.unwrap,
    method: target.method,
    kind: target.kind,
    streamInitial: target.streamInitial,
    streamTimeoutMs: target.streamTimeoutMs,
    streamKey: target.streamKey,
    pollIntervalMs: target.pollIntervalMs,
    isForm: target.isForm,
    trigger: target.trigger,
    actionDebounceMs: target.actionDebounceMs,
    redirect: target.redirect,
    form: target.formId ? (resolveElement(target.formId, "requestTarget.form") as HTMLFormElement) : null,
    fillIntoForms: target.fillIntoIds.map(
      (id) => resolveElement(id, "requestTarget.fillInto") as HTMLFormElement
    ),
    fillIntoSelector: null,
    fillTargetElement: target.fillTargetId
      ? (resolveElement(target.fillTargetId, "requestTarget.fillTarget") as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
      : null,
    fillTargetSelector: target.fillTargetSelector ?? null,
    fillValue: target.fillValue
  }));

  const fillTargets: ParsedFillTarget[] = ir.fillTargets.map((target) => ({
    form: resolveElement(target.formId, "fillTarget.form") as HTMLFormElement,
    selector: target.selector
  }));

  const fillActions: ParsedFillAction[] = ir.fillActions.map((action) => ({
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

  const historyForms = ir.historyForms.map((entry) => ({
    form: resolveElement(entry.formId, "history.form") as HTMLFormElement,
    mode: entry.mode,
    paramsSource: entry.paramsSource,
    fieldNames: entry.fieldNames
  }));

  const autoSubmitForms = ir.autoSubmitForms.map((entry) => ({
    form: resolveElement(entry.formId, "autoSubmit.form") as HTMLFormElement,
    events: entry.events,
    debounceMs: entry.debounceMs,
    composeMode: entry.composeMode
  }));

  const asyncUploadForms = ir.asyncUploadForms.map((entry) => ({
    form: resolveElement(entry.formId, "asyncUpload.form") as HTMLFormElement,
    mode: entry.mode,
    uploaderUrl: entry.uploaderUrl,
    chunkSizeBytes: entry.chunkSizeBytes,
    afterSubmitAction: entry.afterSubmitAction,
    afterSubmitActionPresent: entry.afterSubmitActionPresent,
    redirectConflict: entry.redirectConflict
  }));

  const formStateCandidates = ir.formStateCandidates.map((candidate) => ({
    form: resolveElement(candidate.formId, "formState.form") as HTMLFormElement,
    owner: resolveElement(candidate.ownerId, "formState.owner") as HTMLElement,
    raw: candidate.raw
  }));

  const tables = ir.tables.map((table) => ({
    table: resolveElement(table.tableElementId, "table.element") as HTMLTableElement,
    tableId: table.tableId,
    dataPath: table.dataPath,
    options: table.options,
    columns: table.columns,
    bindShortcut: table.bindShortcut
  }));

  return {
    doc,
    executionMode: ir.executionMode,
    mockRules: ir.mockRules,
    parseErrors: ir.parseErrors,
    requestTargets,
    handlesErrors: ir.handlesErrors,
    hasErrorPopover: ir.hasErrorPopover,
    dummyElements: [],
    cloakElements: ir.cloakElementIds.map((id) => resolveElement(id, "cloakElement")),
    forTemplates,
    ifChains,
    textBindings,
    attrBindings,
    fillTargets,
    fillActions,
    historyForms,
    autoSubmitForms,
    asyncUploadForms,
    formStateCandidates,
    tables,
    tableDiagnostics: ir.tableDiagnostics
  };
}

export function requireRuntimeIr(state: RuntimeState): IrDocument {
  return state.parsed as unknown as IrDocument;
}
