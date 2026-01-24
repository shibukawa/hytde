import type { IrDocument } from "../ir.js";
import type { HyGlobals } from "../types.js";
import { loadResources, initSpaPrefetch, readHyGetPrefetch, type PrefetchOptions } from "./prefetch.js";
import { initSpaLifecycle, runMountCallbacks, runUnmountCallbacks } from "./lifecycle.js";
import { applyHtmlMetadata, reconcilePreserveElements } from "./preserve.js";
import { parseHashParams, parseSearchParams } from "../parse/params.js";
import { normalizePathPattern, stripQueryHash } from "../utils/path-pattern.js";

export type RouteManifest = Record<string, string>;

type RenderOptions = {
  hydrate?: boolean;
  routePath?: string;
  url?: string;
};

type RouteModule = {
  ir?: IrDocument;
  render?: (
    params: Record<string, string>,
    data: Record<string, unknown>,
    options?: RenderOptions
  ) => Node;
  init?: (data: Record<string, unknown>) => void | Promise<void>;
  registerTransforms?: (hy: Record<string, unknown>) => void;
  persistNamespaces?: string[] | null;
  transforms?: string | null;
};

export type RouterOptions = {
  manifestPath?: string;
  container?: HTMLElement;
  prefetch?: PrefetchOptions;
};

const DEFAULT_MANIFEST_PATH = "/route-manifest.json";

type HistoryMode = "push" | "replace" | "none";

export class SpaRouter {
  private manifest: RouteManifest = {};
  private container: HTMLElement;
  private manifestPath: string;
  private prefetchOptions: PrefetchOptions;
  private allowStalePrefetch = false;
  private ready: Promise<void> = Promise.resolve();

  constructor(options: RouterOptions = {}) {
    this.container = options.container ?? document.body;
    this.manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
    this.prefetchOptions = options.prefetch ?? {};
  }

  async init(): Promise<void> {
    this.ready = (async () => {
      this.manifest = await loadManifest(document, this.manifestPath);
    })();
    await this.ready;
    initSpaPrefetch(document, { ...this.prefetchOptions, manifestPath: this.manifestPath });
    initSpaLifecycle(document);
    void this.checkInitialRoute();
    this.interceptLinks();
    window.addEventListener("popstate", (event) => {
      const state = event.state as { path?: string } | null;
      const path = state?.path ?? window.location.pathname;
      this.allowStalePrefetch = true;
      void this.navigateInternal(path, {}, "none");
    });
  }

  async navigateTo(path: string, params: Record<string, string> = {}): Promise<void> {
    return this.navigateInternal(path, params, "push");
  }

  private async navigateInternal(path: string, params: Record<string, string>, historyMode: HistoryMode): Promise<void> {
    await this.ready;
    const normalized = normalizeRoutePath(path);
    const match = matchRoute(normalized, this.manifest);
    if (!match) {
      reportRouteError(window, "route not found", { path: normalized });
      window.location.href = path;
      return;
    }
    let module: RouteModule;
    try {
      module = await importRouteModule(match.modulePath);
    } catch {
      reportRouteError(window, "module import failed", { modulePath: match.modulePath });
      window.location.href = path;
      return;
    }
    if (module.ir?.resources) {
      await loadResources(document, module.ir.resources);
    }
    const render = module.render;
    if (!render) {
      reportRouteError(window, "render missing", { modulePath: match.modulePath });
      window.location.href = path;
      return;
    }
    const scope = window as unknown as { hy?: Record<string, unknown> };
    const hy = scope.hy ?? (scope.hy = { loading: false, errors: [] });
    const renderParams = { ...params };
    resetSpaParams(window);
    module.registerTransforms?.(hy);
    runUnmountCallbacks(document);
    const data = ensureHyState(window);
    const pathParams = parseRouteParams(match.routePath, normalized);
    const mergedParams = mergeParamsWithUrl({ ...pathParams, ...renderParams }, path);
    if (module.ir?.requestTargets) {
      applyHyGetPrefetchOverrides(module.ir.requestTargets, data, mergedParams, {
        allowStale: this.allowStalePrefetch
      });
    }
    let next: HTMLElement;
    try {
      const node = render(renderParams, data, { routePath: match.routePath, url: path });
      next = resolveRenderTarget(node);
    } catch (error) {
      reportRouteError(window, "render failed", { error: String(error) });
      window.location.href = path;
      return;
    }
    applySpaParams(window, mergedParams);
    resetState(window, module.persistNamespaces ?? null);
    reconcilePreserveElements(this.container, next);
    this.container.replaceWith(next);
    this.container = next;
    applyHtmlMetadata(module.ir?.html);
    if (historyMode === "push") {
      history.pushState({ path }, "", path);
    } else if (historyMode === "replace") {
      history.replaceState({ path }, "", path);
    }
    if (module.init) {
      try {
        await module.init(data);
      } catch {
        // ignore module init errors
      }
    }
    window.scrollTo(0, 0);
    runMountCallbacks(document);
    this.allowStalePrefetch = false;
  }

  private async checkInitialRoute(): Promise<void> {
    await this.ready;
    const path = window.location.pathname;
    if (hasFileExtension(path) && !isHtmlPath(path)) {
      return;
    }
    const normalized = normalizeRoutePath(path);
    const match = matchRoute(normalized, this.manifest);
    if (!match) {
      const fallback = resolveDocumentRoutePath(document);
      if (!fallback) {
        reportRouteError(window, "initial route mismatch", { path: normalized });
        return;
      }
      const normalizedFallback = normalizeRoutePath(fallback);
      const fallbackMatch = matchRoute(normalizedFallback, this.manifest);
      if (!fallbackMatch) {
        reportRouteError(window, "initial route fallback missing", {
          path: normalized,
          fallback: normalizedFallback
        });
        return;
      }
      if (normalizedFallback !== normalized) {
        await this.navigateInternal(normalizedFallback, {}, "replace");
      }
      return;
    }
    await this.navigateInternal(path, {}, "none");
  }

  private interceptLinks(): void {
    document.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (!target) {
        return;
      }
      const link = target.closest("a");
      if (!link || !this.shouldIntercept(link)) {
        return;
      }
      event.preventDefault();
      const href = link.getAttribute("href");
      if (!href) {
        return;
      }
      void this.navigateTo(href);
    });
  }

  private shouldIntercept(link: HTMLAnchorElement): boolean {
    if (link.hasAttribute("download")) {
      return false;
    }
    if (link.target === "_blank") {
      return false;
    }
    if (link.getAttribute("href")?.startsWith("#")) {
      return false;
    }
    const url = new URL(link.getAttribute("href") ?? "", link.ownerDocument.baseURI);
    if (url.origin !== window.location.origin) {
      return false;
    }
    return true;
  }
}

function resolveRenderTarget(node: Node): HTMLElement {
  if (node instanceof Document) {
    return node.body;
  }
  if (node instanceof DocumentFragment) {
    const element = node.firstElementChild;
    if (!element) {
      throw new Error("[hytde] render output is empty.");
    }
    return element as HTMLElement;
  }
  if (node instanceof HTMLElement) {
    return node;
  }
  throw new Error("[hytde] render output is not a valid element.");
}

const DEFAULT_PERSIST_NAMESPACES = ["global", "async-upload"];

function ensureHyState(scope: Window): Record<string, unknown> {
  const globalScope = scope as unknown as { hyState?: Record<string, unknown> };
  if (!globalScope.hyState) {
    globalScope.hyState = {};
  }
  return globalScope.hyState;
}

function resetState(scope: Window, persistNamespaces: string[] | null): void {
  const state = ensureHyState(scope);
  const keep = new Set<string>(DEFAULT_PERSIST_NAMESPACES);
  if (Array.isArray(persistNamespaces)) {
    for (const name of persistNamespaces) {
      if (name) {
        keep.add(name);
      }
    }
  }
  for (const key of Object.keys(state)) {
    if (!keep.has(key)) {
      delete state[key];
    }
  }
  const hyScope = scope as unknown as { hy?: { loading?: boolean; errors?: unknown[] } };
  const hy = hyScope.hy ?? (hyScope.hy = { loading: false, errors: [] });
  hy.loading = false;
  hy.errors = [];
}

function applyHyGetPrefetchOverrides(
  targets: IrDocument["requestTargets"],
  state: Record<string, unknown>,
  params: Record<string, string>,
  options: { allowStale: boolean }
): void {
  const requests = targets.filter((target) => target.method === "GET" && target.trigger === "startup");
  for (const target of requests) {
    if (!target.store) {
      continue;
    }
    const url = resolveUrlTemplate(target.urlTemplate, state, params);
    if (!url) {
      continue;
    }
    const cached = readHyGetPrefetch(url, { allowStale: options.allowStale });
    if (!cached) {
      continue;
    }
    state[target.store] = cached.payload;
  }
}

function resolveUrlTemplate(
  template: string,
  state: Record<string, unknown>,
  params: Record<string, string>
): string | null {
  if (!template.includes("{")) {
    return template;
  }
  // SPA prefetch reuse only supports direct tokens (e.g. "{userId}", "{hyState.userId}").
  return template.replace(/\{([^}]+)\}/g, (_, raw) => {
    const key = String(raw).trim();
    if (key.startsWith("hyParams.")) {
      const paramKey = key.slice("hyParams.".length);
      return encodeURIComponent(params[paramKey] ?? "");
    }
    const plainKey = key.startsWith("hyState.") ? key.slice("hyState.".length) : key;
    const value = resolveStateValue(plainKey, state);
    if (value == null) {
      return "";
    }
    return encodeURIComponent(String(value));
  });
}

function resolveStateValue(selector: string, state: Record<string, unknown>): unknown {
  const parts = selector.split(".").map((entry) => entry.trim()).filter(Boolean);
  let current: unknown = state;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function applySpaParams(scope: Window, params: Record<string, string>): void {
  const globals = scope as unknown as { hyParams?: Record<string, string>; hy?: HyGlobals };
  globals.hyParams = params;
  const hy = globals.hy ?? (globals.hy = { loading: false, errors: [] });
  (hy as HyGlobals & { pathParams?: Record<string, string> }).pathParams = params;
}

function resetSpaParams(scope: Window): void {
  applySpaParams(scope, {});
}

function mergeParamsWithUrl(params: Record<string, string>, path: string): Record<string, string> {
  const url = new URL(path, window.location.origin);
  const searchParams = parseSearchParams(url.search);
  const hashParams = parseHashParams(url.hash);
  return { ...params, ...searchParams, ...hashParams };
}

function resolveDocumentRoutePath(doc: Document): string | null {
  const meta = doc.querySelector('meta[name="hy-path"]');
  const content = meta?.getAttribute("content")?.trim();
  if (!content) {
    return null;
  }
  return normalizeRoutePath(content);
}

function reportRouteError(scope: Window, message: string, detail: Record<string, unknown>): void {
  const globals = scope as unknown as { hy?: HyGlobals };
  const hy = globals.hy ?? (globals.hy = { loading: false, errors: [] });
  hy.errors = [
    ...hy.errors,
    {
      type: "data",
      message: `[hytde][spa] ${message}`,
      detail,
      timestamp: Date.now()
    }
  ];
}

const manifestCache = new Map<string, Promise<RouteManifest>>();

async function loadManifest(doc: Document, manifestPath: string): Promise<RouteManifest> {
  const key = new URL(manifestPath, doc.baseURI).toString();
  const cached = manifestCache.get(key);
  if (cached) {
    return cached;
  }
  const promise = fetch(key)
    .then((response) => {
      return response.json() as Promise<RouteManifest>;
    })
    .catch((error) => {
      void error;
      return {};
    });
  manifestCache.set(key, promise);
  return promise;
}

function normalizeRoutePath(path: string): string {
  return normalizePathPattern(stripQueryHash(path));
}

function hasFileExtension(path: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(path);
}

function isHtmlPath(path: string): boolean {
  return path.endsWith(".html") || path.endsWith(".htm");
}

function matchRoute(path: string, manifest: RouteManifest): { modulePath: string; routePath: string } | null {
  if (manifest[path]) {
    return { modulePath: manifest[path], routePath: path };
  }
  for (const [pattern, modulePath] of Object.entries(manifest)) {
    if (!pattern.includes("[")) {
      continue;
    }
    if (testPattern(pattern, path)) {
      return { modulePath, routePath: pattern };
    }
  }
  return null;
}

function testPattern(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/\\\[([^\]]+)\\\]/g, "([^/]+)");
  const regex = new RegExp(`^${regexSource}$`);
  return Boolean(regex.exec(path));
}

function parseRouteParams(routePath: string, path: string): Record<string, string> {
  if (!routePath.includes("[")) {
    return {};
  }
  const names: string[] = [];
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/\\\[([^\]]+)\\\]/g, (_raw, name) => {
    names.push(name);
    return "([^/]+)";
  });
  const regex = new RegExp(`^${regexSource}$`);
  const match = regex.exec(path);
  if (!match) {
    return {};
  }
  const params: Record<string, string> = {};
  names.forEach((name, index) => {
    params[name] = decodeURIComponent(match[index + 1] ?? "");
  });
  return params;
}

async function importRouteModule(modulePath: string): Promise<RouteModule> {
  const url = new URL(modulePath, document.baseURI).toString();
  return import(/* @vite-ignore */ url) as Promise<RouteModule>;
}
