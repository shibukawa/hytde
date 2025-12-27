export type ExecutionMode = "production" | "mock" | "disable";

export interface MockRule {
  pattern: RegExp;
  path: string;
  method: string;
  status?: number;
  delayMs?: { min: number; max: number };
}

export interface ForTemplate {
  marker: Comment;
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
  trigger: "startup" | "submit";
  form: HTMLFormElement | null;
  fillInto: string | null;
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

export interface IfChain {
  nodes: Element[];
}

export interface ParsedSubtree {
  dummyElements: Element[];
  cloakElements: Element[];
  forTemplates: ForTemplate[];
  ifChains: IfChain[];
  textBindings: TextBinding[];
  attrBindings: AttrBinding[];
  fillTargets: FillTarget[];
}

export interface ParsedDocument extends ParsedSubtree {
  doc: Document;
  executionMode: ExecutionMode;
  mockRules: MockRule[];
  requestTargets: RequestTarget[];
  importTargets: ImportTarget[];
  handlesErrors: boolean;
  hasErrorPopover: boolean;
}

export function parseDocument(doc: Document): ParsedDocument {
  const { handlesErrors, hasErrorPopover } = detectErrorHandling(doc);
  return {
    doc,
    executionMode: getExecutionMode(doc),
    mockRules: parseMockRules(doc),
    requestTargets: parseRequestTargets(doc),
    importTargets: parseImportTargets(doc),
    handlesErrors,
    hasErrorPopover,
    ...parseSubtree(doc)
  };
}

export function parseSubtree(root: ParentNode): ParsedSubtree {
  const dummyElements = selectWithRoot(root, "[hy-dummy]");
  const cloakElements = selectWithRoot(root, "[hy-cloak]");
  const forTemplates = parseForTemplates(root);
  const ifChains = parseIfChains(root);
  const textBindings = parseTextBindings(root);
  const attrBindings = parseAttrBindings(root);
  const fillTargets = parseFillTargets(root);

  return {
    dummyElements,
    cloakElements,
    forTemplates,
    ifChains,
    textBindings,
    attrBindings,
    fillTargets
  };
}

export interface FillTarget {
  form: HTMLFormElement;
  selector: string;
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

function parseRequestTargets(doc: Document): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("[hy-get],[hy-post],[hy-put],[hy-patch],[hy-delete]"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const methodAttr = resolveMethodAttribute(element);
    if (!methodAttr) {
      continue;
    }
    const urlTemplate = element.getAttribute(methodAttr.attr);
    const store = element.getAttribute("hy-store");
    const unwrap = element.getAttribute("hy-unwrap");
    element.removeAttribute(methodAttr.attr);
    element.removeAttribute("hy-store");
    element.removeAttribute("hy-unwrap");
    element.removeAttribute("hy-get");
    element.removeAttribute("hy-post");
    element.removeAttribute("hy-put");
    element.removeAttribute("hy-patch");
    element.removeAttribute("hy-delete");
    if (!urlTemplate) {
      continue;
    }
    const isForm = element instanceof HTMLFormElement;
    const isSubmitter = isSubmitControl(element);
    const trigger = isForm || isSubmitter ? "submit" : "startup";
    const form = isForm ? (element as HTMLFormElement) : isSubmitter ? getSubmitterForm(element) : null;
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
      form,
      fillInto: null
    });
  }

  const tagTargets = parseGetTagTargets(doc);
  targets.push(...tagTargets);
  targets.push(...parseStreamTargets(doc));
  targets.push(...parseSseTargets(doc));
  targets.push(...parsePollingTargets(doc));

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

function isSubmitControl(element: Element): element is HTMLButtonElement | HTMLInputElement {
  if (element instanceof HTMLButtonElement) {
    return element.type !== "button";
  }
  if (element instanceof HTMLInputElement) {
    return element.type === "submit";
  }
  return false;
}

function getSubmitterForm(element: HTMLButtonElement | HTMLInputElement): HTMLFormElement | null {
  return element.form ?? (element.closest("form") as HTMLFormElement | null);
}

function parseGetTagTargets(doc: Document): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("hy-get"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const src = element.getAttribute("src");
    const store = element.getAttribute("store");
    const unwrap = element.getAttribute("unwrap");
    const fillInto = element.getAttribute("fill-into");
    const parent = element.parentElement;
    element.remove();
    if (!src || !parent) {
      continue;
    }

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
      form: null,
      fillInto
    });
  }

  return targets;
}

function parseStreamTargets(doc: Document): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("hy-get-stream"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const urlTemplate = element.getAttribute("src");
    const store = element.getAttribute("store");
    const unwrap = element.getAttribute("unwrap");
    const streamInitial = parseStreamInitial(element);
    const streamTimeoutMs = parseStreamTimeout(element);
    const streamKey = parseStreamKey(element);
    const parent = element.parentElement;
    element.remove();
    if (!urlTemplate || !parent) {
      continue;
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
      form: null,
      fillInto: null
    });
  }

  return targets;
}

function parseSseTargets(doc: Document): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("hy-sse"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const urlTemplate = element.getAttribute("src");
    const store = element.getAttribute("store");
    const unwrap = element.getAttribute("unwrap");
    const streamInitial = parseStreamInitial(element);
    const streamTimeoutMs = parseStreamTimeout(element);
    const streamKey = parseStreamKey(element);
    const parent = element.parentElement;
    element.remove();
    if (!urlTemplate || !parent) {
      continue;
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
      form: null,
      fillInto: null
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

function parsePollingTargets(doc: Document): RequestTarget[] {
  const elements = Array.from(doc.querySelectorAll("hy-get-polling"));
  const targets: RequestTarget[] = [];

  for (const element of elements) {
    const urlTemplate = element.getAttribute("src");
    const store = element.getAttribute("store");
    const unwrap = element.getAttribute("unwrap");
    const pollIntervalMs = parsePollingInterval(element);
    const parent = element.parentElement;
    element.remove();
    if (!urlTemplate || !parent) {
      continue;
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
      form: null,
      fillInto: null
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

function parseForTemplates(root: ParentNode): ForTemplate[] {
  const elements = selectWithRoot(root, "[hy-for]");
  const templates: ForTemplate[] = [];

  for (const element of elements) {
    const expression = element.getAttribute("hy-for") ?? "";
    const config = parseForExpression(expression);
    if (!config) {
      continue;
    }

    const doc = element.ownerDocument ?? (root instanceof Document ? root : null);
    if (!doc) {
      continue;
    }

    const marker = doc.createComment("hy-for");
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

function parseIfChains(root: ParentNode): IfChain[] {
  const ifElements = selectWithRoot(root, "[hy-if]");
  const processed = new WeakSet<Element>();
  const chains: IfChain[] = [];

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

    chains.push({ nodes: chain });
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
  }

  return bindings;
}

function parseFillTargets(root: ParentNode): FillTarget[] {
  const elements = selectWithRoot(root, "form[hy-fill]");
  const targets: FillTarget[] = [];

  for (const element of elements) {
    const selector = element.getAttribute("hy-fill");
    element.removeAttribute("hy-fill");
    if (!selector || !(element instanceof HTMLFormElement)) {
      continue;
    }
    targets.push({ form: element, selector });
  }

  return targets;
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
