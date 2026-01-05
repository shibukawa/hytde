export interface HyError {
  type: "request" | "transform" | "syntax" | "data";
  message: string;
  detail?: Record<string, unknown> & {
    url?: string;
    method?: string;
    status?: number;
    selector?: string;
    transform?: string;
    expression?: string;
    attribute?: string;
    context?: string;
  };
  timestamp: number;
}

export interface HyLogEntry {
  type: "render" | "request" | "error" | "info";
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
}

export type AsyncUploadStatus = "queued" | "uploading" | "finalizing" | "completed" | "failed";

export type AsyncUploadEntry = {
  uploadUuid: string;
  formId: string | null;
  inputName: string;
  fileName: string;
  size: number;
  mime: string;
  status: AsyncUploadStatus;
  totalChunks: number;
  uploadedChunks: number;
  progress: number;
  startedAt: number;
  lastError?: string;
};

export type PluginState = Record<string, unknown> | null;

export type PluginWatchTarget =
  | { type: "store"; selector: string }
  | { type: "dom"; selector: string };

export type PluginParseContext = {
  doc: Document;
  parsed: ParsedDocument;
};

export type PluginParseResult = {
  state?: PluginState;
  watches?: PluginWatchTarget[];
};

export type PluginChange = PluginWatchTarget;

export type PluginRenderContext = {
  doc: Document;
  parsed: ParsedDocument;
  reason: "init" | "update";
  changes?: PluginChange[];
};

export interface HytdePlugin {
  name: string;
  onParse?: (context: PluginParseContext) => PluginParseResult | void;
  onRender?: (context: PluginRenderContext, state: PluginState) => void;
  onBeforeUnload?: (context: PluginRenderContext, state: PluginState) => string | void;
  onDispose?: (context: PluginRenderContext, state: PluginState) => void;
}

export type JsonScalar = string | number | boolean | null;
export type JsonScalarType = "string" | "number" | "boolean" | "null";

export interface HyGlobals {
  loading: boolean;
  errors: HyError[];
  uploading?: AsyncUploadEntry[];
  mockStreamDelayMs?: number;
  mockSseDelayMs?: number;
  onRenderComplete?: (callback: () => void) => void;
  onLog?: (callback: (entry: HyLogEntry) => void) => void;
  onError?: (errors: HyError[]) => void;
  plugins?: HytdePlugin[];
  registerPlugin?: (plugin: HytdePlugin) => void;
  registerTransform?: (
    name: string,
    inputType: JsonScalarType,
    fn: (input: JsonScalar, ...args: unknown[]) => JsonScalar
  ) => void;
}

export interface RuntimeGlobals {
  hy: HyGlobals;
  hyState: Record<string, unknown>;
  hyParams: Record<string, string>;
}

export interface ParsedForTemplate {
  marker: Comment;
  template: Element;
  varName: string;
  selector: string;
  rendered: Node[];
}

export interface ParsedRequestTarget {
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
  form: HTMLFormElement | null;
  fillInto: string | null;
  fillTarget: string | null;
  fillValue: string | null;
}

export interface ParsedFillTarget {
  form: HTMLFormElement;
  selector: string;
}

export interface ParsedFillAction {
  element: Element;
  selector: string;
  value: string | null;
  form: HTMLFormElement | null;
  command: string | null;
  commandFor: string | null;
}

export interface ParsedTextBinding {
  element: Element;
  expression: string;
}

export interface ParsedAttrBinding {
  element: Element;
  attr: string;
  target: string;
  template: string;
}

export interface ParsedIfChainNode {
  node: Element;
  kind: "if" | "else-if" | "else";
  expression: string | null;
}

export interface ParsedIfChain {
  anchor: Comment;
  nodes: ParsedIfChainNode[];
}

export interface ParsedSubtree {
  dummyElements: Element[];
  cloakElements: Element[];
  forTemplates: ParsedForTemplate[];
  ifChains: ParsedIfChain[];
  textBindings: ParsedTextBinding[];
  attrBindings: ParsedAttrBinding[];
  fillTargets: ParsedFillTarget[];
  fillActions: ParsedFillAction[];
}

export interface ParsedDocument extends ParsedSubtree {
  doc: Document;
  executionMode: "production" | "mock" | "disable";
  mockRules: unknown[];
  parseErrors: Array<{ message: string; detail?: Record<string, unknown> }>;
  requestTargets: ParsedRequestTarget[];
  handlesErrors: boolean;
  hasErrorPopover: boolean;
}

export interface ParserAdapter {
  parseDocument: (doc: Document) => ParsedDocument;
  parseSubtree(root: ParentNode): ParsedSubtree;
}
