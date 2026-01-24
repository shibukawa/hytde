import type { IrDocument, IrResourceItem } from "../ir.js";
import { parseHyPathMeta } from "../parse/hy-path.js";
import { normalizePathPattern, stripQueryHash } from "../utils/path-pattern.js";

export type RouteManifest = Record<string, string>;

export type PrefetchMode = "eager" | "force" | "disabled";

export type PrefetchOptions = {
  manifestPath?: string;
  defaultPrefetch?: PrefetchMode;
  forceBaseDelayMs?: number;
  forceMaxDelayMs?: number;
  hyGetTtlMs?: number;
};

type RouteModule = { ir?: IrDocument };

type HyGetCacheEntry = { expiresAt: number; payload: unknown };

const manifestCache = new Map<string, Promise<RouteManifest>>();
const moduleCache = new Map<string, Promise<RouteModule>>();
const cssCache = new Set<string>();
const jsCache = new Set<string>();
const prefetchCache = new Set<string>();
const hyGetCache = new Map<string, HyGetCacheEntry>();
const hyGetInFlight = new Map<string, Promise<void>>();

const DEFAULT_PREFETCH_PATH = "/route-manifest.json";
const DEFAULT_FORCE_BASE_DELAY_MS = 200;
const DEFAULT_FORCE_MAX_DELAY_MS = 5000;
const DEFAULT_HYGET_TTL_MS = 10_000;

export function initSpaPrefetch(doc: Document, options: PrefetchOptions = {}): void {
  const defaults = resolveDefaults(doc, options);
  const meta = parseHyPathMeta(doc);
  console.log("[hytde][spa] init prefetch", {
    ...defaults,
    pathMode: meta.mode ?? "hash"
  });
  setupHoverPrefetch(doc, defaults);
  scheduleForcePrefetch(doc, defaults);
  ensurePrefetchApi(doc, defaults);
}

export async function prefetchRoute(
  doc: Document,
  path: string,
  params: Record<string, string | number> = {},
  options: PrefetchOptions = {}
): Promise<void> {
  const defaults = resolveDefaults(doc, options);
  console.log("[hytde][spa] prefetch route", { path, params, manifestPath: defaults.manifestPath });
  const manifest = await loadManifest(doc, defaults.manifestPath);
  const normalized = normalizeRoutePath(path);
  const modulePath = matchRoute(normalized, manifest);
  if (!modulePath) {
    console.log("[hytde][spa] prefetch route not found", { path: normalized });
    return;
  }
  console.log("[hytde][spa] prefetch route match", { path: normalized, modulePath });
  let module: RouteModule;
  try {
    module = await importRouteModule(doc, modulePath);
  } catch (error) {
    console.log("[hytde][spa] prefetch module failed", { path, modulePath, error });
    return;
  }
  console.log("[hytde][spa] prefetch module loaded", { modulePath });
  const resources = module.ir?.resources;
  if (resources) {
    prefetchResources(doc, resources);
  }
  if (module.ir?.requestTargets) {
    await prefetchHyGet(module.ir.requestTargets, params, defaults);
  }
}

export function readHyGetPrefetch(url: string, options: { allowStale?: boolean } = {}): HyGetCacheEntry | null {
  const cached = hyGetCache.get(url);
  if (!cached) {
    return null;
  }
  if (!options.allowStale && cached.expiresAt <= Date.now()) {
    hyGetCache.delete(url);
    return null;
  }
  return cached;
}

export async function loadCss(doc: Document, resource: IrResourceItem): Promise<void> {
  const href = resource.href;
  if (!href || cssCache.has(href)) {
    return;
  }
  cssCache.add(href);
  await insertLink(doc, {
    rel: "stylesheet",
    href,
    integrity: resource.integrity,
    crossOrigin: resource.crossOrigin
  });
}

export async function loadJs(doc: Document, resource: IrResourceItem): Promise<void> {
  const src = resource.src;
  if (!src || jsCache.has(src)) {
    return;
  }
  jsCache.add(src);
  await insertScript(doc, {
    src,
    async: resource.async,
    defer: resource.defer,
    integrity: resource.integrity,
    crossOrigin: resource.crossOrigin
  });
}

export async function loadResources(doc: Document, resources: IrDocument["resources"]): Promise<void> {
  if (!resources) {
    return;
  }
  const cssTasks = (resources.css ?? []).map((entry) => loadCss(doc, entry));
  const jsTasks = (resources.js ?? []).map((entry) => loadJs(doc, entry));
  const prefetchTask = resources.prefetch?.length ? prefetchUrls(doc, resources.prefetch) : Promise.resolve();
  await Promise.all([...cssTasks, ...jsTasks, prefetchTask]);
}

export async function prefetchUrls(doc: Document, urls: string[]): Promise<void> {
  void doc;
  await Promise.all(urls.map((url) => fetch(url).then(() => undefined).catch(() => undefined)));
}

function resolveDefaults(doc: Document, options: PrefetchOptions): Required<PrefetchOptions> {
  const defaultPrefetch = options.defaultPrefetch ?? resolveDefaultPrefetch(doc);
  return {
    manifestPath: options.manifestPath ?? DEFAULT_PREFETCH_PATH,
    defaultPrefetch,
    forceBaseDelayMs: options.forceBaseDelayMs ?? DEFAULT_FORCE_BASE_DELAY_MS,
    forceMaxDelayMs: options.forceMaxDelayMs ?? DEFAULT_FORCE_MAX_DELAY_MS,
    hyGetTtlMs: options.hyGetTtlMs ?? DEFAULT_HYGET_TTL_MS
  };
}

function resolveDefaultPrefetch(doc: Document): PrefetchMode {
  const meta = parseHyPathMeta(doc);
  return meta.mode === "path" ? "eager" : "disabled";
}

function ensurePrefetchApi(doc: Document, options: Required<PrefetchOptions>): void {
  const view = doc.defaultView;
  if (!view) {
    return;
  }
  const hy = (view.hy ?? (view.hy = { loading: false, errors: [] })) as unknown as Record<string, unknown>;
  if (typeof hy.prefetch === "function") {
    return;
  }
  hy.prefetch = (path: string, params?: Record<string, string | number>) =>
    prefetchRoute(doc, path, params ?? {}, options);
}

async function loadManifest(doc: Document, manifestPath: string): Promise<RouteManifest> {
  const key = new URL(manifestPath, doc.baseURI).toString();
  const cached = manifestCache.get(key);
  if (cached) {
    return cached;
  }
  console.log("[hytde][spa] fetch manifest", { manifestPath: key });
  const promise = fetch(key)
    .then((response) => {
      console.log("[hytde][spa] manifest response", { url: key, ok: response.ok, status: response.status });
      return response.json() as Promise<RouteManifest>;
    })
    .catch((error) => {
      console.log("[hytde][spa] manifest fetch failed", { url: key, error });
      return {};
    });
  manifestCache.set(key, promise);
  return promise;
}

function normalizeRoutePath(path: string): string {
  return normalizePathPattern(stripQueryHash(path));
}

function matchRoute(path: string, manifest: RouteManifest): string | null {
  if (manifest[path]) {
    return manifest[path];
  }
  for (const [pattern, modulePath] of Object.entries(manifest)) {
    if (!pattern.includes("[")) {
      continue;
    }
    const regex = patternToRegex(pattern);
    if (regex.test(path)) {
      return modulePath;
    }
  }
  return null;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wildcard = escaped.replace(/\\\[[^\]]+\\\]/g, "[^/]+");
  return new RegExp(`^${wildcard}$`);
}

async function importRouteModule(doc: Document, modulePath: string): Promise<RouteModule> {
  const url = new URL(modulePath, doc.baseURI).toString();
  const cached = moduleCache.get(url);
  if (cached) {
    return cached;
  }
  const promise = import(/* @vite-ignore */ url) as Promise<RouteModule>;
  moduleCache.set(url, promise);
  return promise;
}

function prefetchResources(doc: Document, resources: IrDocument["resources"]): void {
  if (!resources) {
    return;
  }
  for (const css of resources.css ?? []) {
    if (css.href) {
      prefetchResource(doc, css.href, "style");
    }
  }
  for (const js of resources.js ?? []) {
    if (js.src) {
      prefetchResource(doc, js.src, "script");
    }
  }
  if (resources.prefetch?.length) {
    void prefetchUrls(doc, resources.prefetch);
  }
}

function prefetchResource(doc: Document, url: string, asType: "style" | "script"): void {
  if (asType === "style" && (cssCache.has(url) || prefetchCache.has(url))) {
    return;
  }
  if (asType === "script" && (jsCache.has(url) || prefetchCache.has(url))) {
    return;
  }
  prefetchCache.add(url);
  const link = doc.createElement("link");
  link.rel = "prefetch";
  link.href = url;
  link.as = asType;
  doc.head?.appendChild(link);
}

async function prefetchHyGet(
  targets: IrDocument["requestTargets"],
  params: Record<string, string | number>,
  options: Required<PrefetchOptions>
): Promise<void> {
  const requests = targets.filter((target) => target.method === "GET" && target.trigger === "startup");
  await Promise.all(requests.map((target) => prefetchHyGetUrl(target.urlTemplate, params, options.hyGetTtlMs)));
}

async function prefetchHyGetUrl(
  template: string,
  params: Record<string, string | number>,
  ttlMs: number
): Promise<void> {
  const url = resolveTemplateWithParams(template, params);
  if (!url) {
    return;
  }
  const cached = hyGetCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return;
  }
  const inflight = hyGetInFlight.get(url);
  if (inflight) {
    return;
  }
  const promise = fetch(url)
    .then(async (response) => {
      const payload = await safeJson(response);
      hyGetCache.set(url, { expiresAt: Date.now() + ttlMs, payload });
    })
    .catch(() => undefined)
    .finally(() => {
      hyGetInFlight.delete(url);
    });
  hyGetInFlight.set(url, promise);
  await promise;
}

function resolveTemplateWithParams(template: string, params: Record<string, string | number>): string | null {
  if (!template.includes("{")) {
    return template;
  }
  // SPA prefetch only supports direct param tokens (e.g. "{userId}", "{hyParams.userId}").
  return template.replace(/\{([^}]+)\}/g, (_, raw) => {
    const key = String(raw).trim();
    const plainKey = key.startsWith("hyParams.") ? key.slice("hyParams.".length) : key;
    const value = params[plainKey];
    if (value == null) {
      return "";
    }
    return encodeURIComponent(String(value));
  });
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function setupHoverPrefetch(doc: Document, options: Required<PrefetchOptions>): void {
  const handler = (event: Event) => {
    const target = event.target as Element | null;
    if (!target) {
      return;
    }
    const link = target.closest("a");
    if (!link || !(link instanceof HTMLAnchorElement) || !isPrefetchableLink(link)) {
      return;
    }
    const mode = resolveLinkPrefetchMode(link, options.defaultPrefetch);
    if (mode !== "eager") {
      return;
    }
    const href = link.getAttribute("href");
    if (!href) {
      return;
    }
    console.log("[hytde][spa] hover prefetch", { href });
    void prefetchRoute(doc, href, {}, options);
  };
  doc.addEventListener("pointerenter", handler, { capture: true });
}

function scheduleForcePrefetch(doc: Document, options: Required<PrefetchOptions>): void {
  const links = Array.from(doc.querySelectorAll("a[hy-prefetch='force']"));
  const prefetchable = links.filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement)
    .filter((link) => isPrefetchableLink(link));
  let delay = options.forceBaseDelayMs;
  for (const link of prefetchable) {
    const href = link.getAttribute("href");
    if (!href) {
      continue;
    }
    const scheduled = delay;
    console.log("[hytde][spa] force prefetch scheduled", { href, delayMs: scheduled });
    setTimeout(() => {
      void prefetchRoute(doc, href, {}, options);
    }, scheduled);
    delay = Math.min(delay * 2, options.forceMaxDelayMs);
  }
}

function resolveLinkPrefetchMode(link: HTMLAnchorElement, defaultMode: PrefetchMode): PrefetchMode {
  const raw = link.getAttribute("hy-prefetch");
  if (raw === "eager" || raw === "force" || raw === "disabled") {
    return raw;
  }
  return defaultMode;
}

function isPrefetchableLink(link: HTMLAnchorElement): boolean {
  const view = link.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  if (link.hasAttribute("download")) {
    return false;
  }
  if (link.target === "_blank") {
    return false;
  }
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#")) {
    return false;
  }
  const url = new URL(href, link.ownerDocument.baseURI);
  if (url.origin !== view.location.origin) {
    return false;
  }
  return true;
}

function insertLink(
  doc: Document,
  attrs: { rel: string; href: string; integrity?: string; crossOrigin?: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = doc.createElement("link");
    link.rel = attrs.rel;
    link.href = attrs.href;
    if (attrs.integrity) {
      link.integrity = attrs.integrity;
    }
    if (attrs.crossOrigin) {
      link.crossOrigin = attrs.crossOrigin;
    }
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error("link load failed")), { once: true });
    doc.head?.appendChild(link);
  });
}

function insertScript(
  doc: Document,
  attrs: { src: string; async?: boolean; defer?: boolean; integrity?: string; crossOrigin?: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = attrs.src;
    script.async = Boolean(attrs.async);
    script.defer = Boolean(attrs.defer);
    if (attrs.integrity) {
      script.integrity = attrs.integrity;
    }
    if (attrs.crossOrigin) {
      script.crossOrigin = attrs.crossOrigin;
    }
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("script load failed")), { once: true });
    doc.head?.appendChild(script);
  });
}
