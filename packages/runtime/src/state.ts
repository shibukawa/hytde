import type {
  AsyncUploadEntry,
  HyLogEntry,
  HytdePlugin,
  ParsedDocument,
  ParsedFillAction,
  ParsedRequestTarget,
  ParserAdapter,
  PluginState,
  PluginWatchTarget,
  RuntimeGlobals
} from "./types.js";

export type AsyncUploadMode = "s3" | "simple";
export type AfterSubmitAction = "clear" | "keep";

export type AsyncUploadConfig = {
  form: HTMLFormElement;
  formId: string | null;
  mode: AsyncUploadMode;
  uploaderUrl: string | null;
  chunkSizeBytes: number;
  concurrency: number;
  uploadUuid: string;
  afterSubmitAction: AfterSubmitAction;
  afterSubmitActionPresent: boolean;
  redirectConflict: boolean;
};

export type AsyncUploadFileState = {
  key: string;
  uploadUuid: string;
  fileUuid: string;
  inputName: string;
  fileIndex: number;
  fileName: string;
  size: number;
  mime: string;
  chunkSizeBytes: number;
  totalChunks: number;
  uploadedChunks: number;
  status: AsyncUploadEntry["status"];
  startedAt: number;
  lastError?: string;
  uploadId?: string;
  s3Path?: string;
  partUrls?: string[];
  partEtags?: Array<string | null>;
  fileId?: string;
  inFlightProgress: Map<number, number>;
  file?: File;
};

export type AsyncUploadSession = {
  config: AsyncUploadConfig;
  files: Map<string, AsyncUploadFileState>;
  pendingSubmit: AsyncUploadPendingSubmit | null;
};

export type AsyncUploadPendingSubmit = {
  target: ParsedRequestTarget;
  payload: Record<string, unknown>;
  method: string;
  actionUrl: string;
};

export type CascadeDisabledState = {
  prevDisabled: boolean;
  prevAriaBusy: string | null;
};

export type CascadeState = {
  storeToSelects: Map<string, Set<HTMLSelectElement>>;
  selectToStores: Map<HTMLSelectElement, Set<string>>;
  selectIds: WeakMap<HTMLSelectElement, string>;
  cycleSelects: WeakSet<HTMLSelectElement>;
  cycleLogs: Set<string>;
  disabledState: WeakMap<HTMLSelectElement, CascadeDisabledState>;
  actionSkip: WeakSet<HTMLSelectElement>;
};

export interface ErrorUiState {
  toast: HTMLDivElement;
  toastCount: HTMLSpanElement;
  dialog: HTMLDivElement;
  list: HTMLDivElement;
  clearButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

export type PluginRegistration = {
  plugin: HytdePlugin;
  state: PluginState;
  watches: PluginWatchTarget[];
};

export type FormDisableSnapshot = {
  controls: Array<{ element: HTMLElement; wasDisabled: boolean }>;
};

export type HyPathMode = "hash" | "path";

export type HyPathMeta = {
  template: string | null;
  mode: HyPathMode;
};

export type HyPathDiagnostics = {
  mode: HyPathMode;
  hashOverrides: string[];
  pathMatched: boolean;
  hashUsed: boolean;
};

export type FormStateMode = "autosave-guard" | "autosave" | "guard" | "off";

export interface FormStateDeclaration {
  mode: FormStateMode;
  durationMs: number;
  raw: string;
}

export interface FormStateContext {
  form: HTMLFormElement;
  owner: HTMLElement;
  ownerId: string | null;
  mode: FormStateMode;
  autosaveDelayMs: number;
  autosaveEnabled: boolean;
  dirty: boolean;
  hasDraft: boolean;
  lastCommittedJson: string | null;
  autosaveTimer: number | null;
  fileWarningEmitted: boolean;
}

export interface AutoSubmitState {
  timer: number | null;
  composing: boolean;
  pendingComposition: boolean;
}

export type ActionRequestHandler = (target: ParsedRequestTarget, state: RuntimeState) => Promise<boolean>;
export type ActionPrefetchHandler = (target: ParsedRequestTarget, state: RuntimeState) => Promise<void>;

export interface ActionHandlers {
  handleActionRequest: ActionRequestHandler;
  prefetchActionRequest: ActionPrefetchHandler;
}

export interface RuntimeState {
  doc: Document;
  globals: RuntimeGlobals;
  parsed: ParsedDocument;
  parser: ParserAdapter;
  cascade: CascadeState;
  asyncUploads: Map<HTMLFormElement, AsyncUploadSession>;
  asyncUploadEntries: Map<string, AsyncUploadEntry>;
  bootstrapPending: boolean;
  plugins: PluginRegistration[];
  pluginsInitialized: boolean;
  unloadListenerAttached: boolean;
  disposed: boolean;
  cloakApplied: boolean;
  appendStores: Set<string> | null;
  appendLogOnlyNew: boolean;
  appendMarkedElements: Set<Element>;
  streamKeyCache: Map<string, Set<string>>;
  sseSources: Map<ParsedRequestTarget, EventSource>;
  pollingTimers: Map<ParsedRequestTarget, number>;
  streamStores: string[];
  requestCache: Map<string, { promise: Promise<void>; payload: unknown; payloadSet: boolean }>;
  requestCounter: number;
  pendingRequests: number;
  formListeners: WeakSet<HTMLFormElement>;
  formTargets: Map<HTMLFormElement, ParsedRequestTarget>;
  submitterTargets: Map<Element, ParsedRequestTarget>;
  formStateContexts: Map<HTMLFormElement, FormStateContext>;
  formStateListeners: WeakSet<HTMLFormElement>;
  fillActionListeners: WeakSet<Element>;
  fillActionData: WeakMap<Element, ParsedFillAction>;
  autoSubmitListeners: WeakSet<HTMLFormElement>;
  autoSubmitState: WeakMap<HTMLFormElement, AutoSubmitState>;
  inFlightForms: WeakSet<HTMLFormElement>;
  actionListeners: WeakSet<Element>;
  actionDebounceTimers: WeakMap<Element, number>;
  actionPrefetchCache: Map<string, { timestamp: number; payload: unknown }>;
  actionPrefetchInFlight: Map<string, Promise<void>>;
  actionCommandSkip: WeakSet<Element>;
  actionHandlers: ActionHandlers;
  optimisticInputValues: WeakMap<HTMLInputElement, unknown>;
  formDisableSnapshots: WeakMap<HTMLFormElement, FormDisableSnapshot>;
  historyListenerAttached: boolean;
  renderCallbacks: Array<() => void>;
  logCallbacks: Array<(entry: HyLogEntry) => void>;
  errorUi: ErrorUiState | null;
  errorDedup: Set<string>;
  pathMeta: HyPathMeta;
  pathDiagnostics: HyPathDiagnostics | null;
  pathDiagnosticsEmitted: boolean;
  missingPathParams: Set<string>;
  navListenerAttached: boolean;
  formStateNavListenerAttached: boolean;
}
