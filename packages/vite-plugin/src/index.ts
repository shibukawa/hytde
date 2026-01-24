import type { Plugin, IndexHtmlTransformContext, ResolvedConfig } from "vite";
import type { OutputAsset, OutputBundle, SourceMap } from "rollup";
import { parseHTML } from "linkedom";
import type { Dirent } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdir, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { parseDocumentToIr, selectImportExports, compactIrDocument, expandIrDocument } from "@hytde/parser";
import type { IrDocument, IrResourceItem } from "@hytde/parser";

const PARSER_SNAPSHOT_ID = "hy-precompile-parser";
const STANDALONE_IMPORT_PATTERN = /@hytde\/standalone(?:\/[a-z-]+)?/g;
const TAILWIND_VIRTUAL_ID = "virtual:hytde-tailwind.css";
const TAILWIND_RESOLVED_ID = `\0${TAILWIND_VIRTUAL_ID}`;
const TAILWIND_ASSET_NAME = "hytde-tailwind.css";
const TAILWIND_LINK_MARKER = "data-hytde-tailwind";
const SPA_MODULE_PREFIX = "virtual:hytde-spa:";
const SPA_MODULE_RESOLVED_PREFIX = "\0hytde-spa:";
const SPA_MODULE_SUFFIX = ".spa.js";

type MockOption = "default" | true | false;

type HyTdePluginOptions = {
  debug?: boolean;
  mock?: MockOption;
  pathMode?: "hash" | "path";
  manual?: boolean;
  inputPaths?: string[];
  disableSSR?: boolean;
  spa?: boolean;
  manifestPath?: string;
  routerScriptPath?: string;
  /**
   * Enable Tailwind v4 processing for precompiled output.
   * - `true`: uses a virtual stylesheet with `@import "tailwindcss"`.
   * - `string`: path to a CSS file that imports Tailwind.
   */
  tailwindSupport?: boolean | string;
};

const require = createRequire(import.meta.url);

export default function hyTde(options: HyTdePluginOptions = {}): Plugin[] {
  let rootDir = process.cwd();
  let resolvedConfig: ResolvedConfig | null = null;
  let tailwindSupport: Promise<TailwindSupportConfig | null> | null = null;
  const ssrTemplates = new Map<string, string>();
  const spaModules = new Map<string, SpaModuleEntry>();
  const staticHtmlOutputs = new Map<string, string>();
  const spaEnabled = options.spa === true;
  const manifestConfig = resolveManifestConfig(options.manifestPath);
  let mswWorkerPathPromise: Promise<string | null> | null = null;
  const shouldEmitSsr = () => Boolean(resolvedConfig && resolvedConfig.command === "build" && options.disableSSR !== true);

  const corePlugin: Plugin = {
    name: "hytde",
    enforce: "pre",
    async config(config, env) {
      if (env.command !== "build") {
        return;
      }
      const root = resolve(config.root ?? process.cwd());
      tailwindSupport = resolveTailwindSupport(options, root);
      const htmlInputs = await collectHtmlEntries(root, options.inputPaths);
      if (htmlInputs.length === 0) {
        return;
      }
      const existing = config.build?.rollupOptions?.input;
      let mergedInput = mergeRollupInput(existing, htmlInputs, root);
      const tailwindEntry = await tailwindSupport;
      if (tailwindEntry) {
        mergedInput = mergeTailwindInput(mergedInput, tailwindEntry.input);
      }
      return {
        build: {
          rollupOptions: {
            input: mergedInput
          }
        }
      };
    },
    configResolved(config: ResolvedConfig) {
      rootDir = config.root;
      resolvedConfig = config;
    },
    async resolveId(source, importer) {
      if (source === TAILWIND_VIRTUAL_ID) {
        return TAILWIND_RESOLVED_ID;
      }
      if (source === TAILWIND_RESOLVED_ID) {
        return source;
      }
      if (source.startsWith(SPA_MODULE_PREFIX)) {
        return `${SPA_MODULE_RESOLVED_PREFIX}${source.slice(SPA_MODULE_PREFIX.length)}`;
      }
      if (source.startsWith(SPA_MODULE_RESOLVED_PREFIX)) {
        return source;
      }
      if (resolvedConfig?.command === "serve") {
        const localPrecompile = resolveLocalPrecompileEntry(source, rootDir);
        if (localPrecompile) {
          return localPrecompile;
        }
      }
      if (
        !source.includes("@hytde/standalone") ||
        source.includes("@hytde/standalone/debug-api") ||
        source.includes("@hytde/standalone/msw-debug")
      ) {
        return null;
      }
      const isDebug = resolveRuntimeDebugMode(undefined, options, resolvedConfig);
      const manual = Boolean(options.manual);
      const mapped = resolveStandaloneRuntimeImport(source, isDebug, manual);
      if (mapped === source) {
        return null;
      }
      const resolved = await this.resolve(mapped, importer, { skipSelf: true });
      return resolved?.id ?? null;
    },
    load(id) {
      if (id === TAILWIND_RESOLVED_ID) {
        return '@import "tailwindcss";\n';
      }
      if (id.startsWith(SPA_MODULE_RESOLVED_PREFIX)) {
        const templateId = id.slice(SPA_MODULE_RESOLVED_PREFIX.length);
        const entry = spaModules.get(templateId);
        if (!entry) {
          return null;
        }
        return buildSpaModuleOutput(entry);
      }
      return null;
    },
    async transformIndexHtml(html, ctx) {
      const resolveId = async (id: string, importer?: string) => {
        const ctxResolve = (this as { resolve?: (id: string, importer?: string, options?: unknown) => Promise<unknown> } | undefined)
          ?.resolve;
        if (typeof ctxResolve === "function") {
          const resolved = await ctxResolve.call(this, id, importer, { skipSelf: true });
          return normalizeResolvedId(resolved);
        }
        return null;
      };
      const support = tailwindSupport ?? resolveTailwindSupport(options, rootDir);
      tailwindSupport = support;
      const emitSsr = Boolean(resolvedConfig && resolvedConfig.command === "build" && options.disableSSR !== true);
      const result = await precompileHtml(
        html,
        ctx,
        rootDir,
        resolveId,
        options,
        resolvedConfig,
        await support,
        emitSsr
      );
      if (emitSsr && result.ssrTemplate && result.templateId) {
        const fileName = result.templateId.replace(/\.html?$/, ".ssr.json");
        ssrTemplates.set(fileName, JSON.stringify(result.ssrTemplate));
      }
      if (spaEnabled && resolvedConfig?.command === "build" && result.templateId) {
        const entry = buildSpaModuleEntry(result.html, result.templateId);
        if (entry) {
          spaModules.set(result.templateId, entry);
        }
      }
      if (resolvedConfig?.command === "build" && result.templateId) {
        staticHtmlOutputs.set(result.templateId, result.html);
      }
      return result.html;
    },
    async generateBundle(_options, bundle) {
      if (spaEnabled && resolvedConfig?.command === "build") {
        const moduleEntries = new Map<string, SpaModuleEntry>();
        for (const entry of spaModules.values()) {
          moduleEntries.set(entry.templateId, entry);
        }
        const htmlEntries = collectSpaHtmlEntries(bundle, staticHtmlOutputs);
        for (const [templateId, html] of htmlEntries.entries()) {
          if (moduleEntries.has(templateId)) {
            continue;
          }
          const entry = buildSpaModuleEntry(html, templateId);
          if (entry) {
            moduleEntries.set(templateId, entry);
          }
        }
        for (const entry of moduleEntries.values()) {
          const output = buildSpaModuleOutput(entry);
          const mapFile = `${entry.fileName}.map`;
          const mapRef = `${basename(entry.fileName)}.map`;
          const code = `${output.code}\n//# sourceMappingURL=${mapRef}`;
          bundle[entry.fileName] = createOutputAsset(entry.fileName, code);
          bundle[mapFile] = createOutputAsset(mapFile, output.map.toString());
        }
        const manifest = await buildRouteManifest(rootDir, options.inputPaths, { moduleSuffix: SPA_MODULE_SUFFIX });
        if (Object.keys(manifest).length > 0) {
          this.emitFile({
            type: "asset",
            fileName: manifestConfig.fileName,
            source: JSON.stringify(manifest, null, 2)
          });
        }
        spaModules.clear();
      }
      if (resolvedConfig?.command === "build" && staticHtmlOutputs.size > 0) {
        const emitted = new Set<string>();
        for (const output of Object.values(bundle)) {
          if (output.type !== "asset" || !output.fileName.endsWith(".html")) {
            continue;
          }
          const key = toPosixPath(output.fileName);
          const html = staticHtmlOutputs.get(key);
          if (!html) {
            continue;
          }
          validateStaticHtmlOutput(html, key);
          output.source = html;
          emitted.add(key);
        }
        for (const [fileName, html] of staticHtmlOutputs.entries()) {
          if (emitted.has(fileName)) {
            continue;
          }
          validateStaticHtmlOutput(html, fileName);
          this.emitFile({
            type: "asset",
            fileName,
            source: html
          });
        }
        staticHtmlOutputs.clear();
      }
      if (!shouldEmitSsr()) {
        ssrTemplates.clear();
        return;
      }
      const emitted = new Set<string>();
      for (const [fileName, source] of ssrTemplates.entries()) {
        this.emitFile({ type: "asset", fileName, source });
        emitted.add(fileName);
      }
      for (const output of Object.values(bundle)) {
        if (output.type !== "asset" || !output.fileName.endsWith(".html")) {
          continue;
        }
        const templateId = output.fileName;
        const ssrName = templateId.replace(/\.html?$/, ".ssr.json");
        if (emitted.has(ssrName)) {
          continue;
        }
        const source = readAssetSource(output);
        if (!source) {
          continue;
        }
        const ir = extractIrFromHtml(source);
        if (!ir) {
          continue;
        }
        const template = buildSlotifiedTemplate(source, ir, templateId);
        this.emitFile({ type: "asset", fileName: ssrName, source: JSON.stringify(template) });
        emitted.add(ssrName);
      }
      ssrTemplates.clear();
    },
    async writeBundle() {
      if (!resolvedConfig) {
        return;
      }
      const outDir = resolve(rootDir, resolvedConfig.build.outDir ?? "dist");
      if (spaEnabled && resolvedConfig.command === "build") {
        const htmlOutputs = await collectHtmlOutputs(outDir);
        for (const htmlPath of htmlOutputs) {
          const source = await readFile(htmlPath, "utf8").catch(() => null);
          if (!source) {
            continue;
          }
          const templateId = toPosixPath(relative(outDir, htmlPath));
          const entry = buildSpaModuleEntry(source, templateId);
          if (!entry) {
            continue;
          }
          const output = buildSpaModuleOutput(entry);
          const mapFile = `${entry.fileName}.map`;
          const mapRef = `${basename(entry.fileName)}.map`;
          const modulePath = resolve(outDir, entry.fileName);
          const mapPath = resolve(outDir, mapFile);
          await mkdir(dirname(modulePath), { recursive: true });
          const code = `${output.code}\n//# sourceMappingURL=${mapRef}`;
          await writeFile(modulePath, code);
          await writeFile(mapPath, output.map.toString());
        }
      }
      if (!shouldEmitSsr()) {
        return;
      }
      const htmlOutputs = await collectHtmlOutputs(outDir);
      for (const htmlPath of htmlOutputs) {
        const source = await readFile(htmlPath, "utf8").catch(() => null);
        if (!source) {
          continue;
        }
        const ir = extractIrFromHtml(source);
        if (!ir) {
          continue;
        }
        const templateId = toPosixPath(relative(outDir, htmlPath));
        const template = buildSlotifiedTemplate(source, ir, templateId);
        const ssrPath = htmlPath.replace(/\.html?$/, ".ssr.json");
        await mkdir(dirname(ssrPath), { recursive: true });
        await writeFile(ssrPath, JSON.stringify(template));
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (spaEnabled && url === manifestConfig.urlPath) {
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.statusCode = 405;
            res.end();
            return;
          }
          const manifest = await buildRouteManifest(rootDir, options.inputPaths);
          const payload = JSON.stringify(manifest, null, 2);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-cache");
          res.end(req.method === "HEAD" ? "" : payload);
          return;
        }
        if (url === "/mockServiceWorker.js") {
          if (!mswWorkerPathPromise) {
            mswWorkerPathPromise = resolveMswWorkerPath(rootDir);
          }
          const workerPath = await mswWorkerPathPromise;
          if (!workerPath) {
            next();
            return;
          }
          const content = await readFile(workerPath, "utf8").catch(() => null);
          if (!content) {
            next();
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/javascript");
          res.setHeader("Cache-Control", "no-cache");
          res.end(content);
          return;
        }
        if (!url || url.endsWith(".html") || url.includes(".")) {
          next();
          return;
        }
        const resolved = await resolveDynamicTemplate(rootDir, url);
        if (resolved) {
          req.url = `/${toPosixPath(relative(rootDir, resolved))}`;
        }
        next();
      });
    }
  };

  const tailwindLinkPlugin: Plugin = {
    name: "hytde-tailwind-link",
    apply: "build",
    enforce: "post",
    async generateBundle(_options, bundle) {
      const support = await tailwindSupport;
      if (!support) {
        return;
      }
      const cssAsset = findTailwindCssAsset(bundle, support);
      if (!cssAsset) {
        this.warn(`[hytde] tailwind CSS asset not found for ${support.input}`);
        return;
      }
      const href = normalizeAssetHref(cssAsset.fileName);
      for (const output of Object.values(bundle)) {
        if (output.type !== "asset" || !output.fileName.endsWith(".html")) {
          continue;
        }
        const source = readAssetSource(output);
        if (!source || !source.includes(TAILWIND_LINK_MARKER)) {
          continue;
        }
        const updated = updateTailwindLinkHref(source, href);
        if (updated !== source) {
          output.source = updated;
        }
      }
    }
  };

  return [corePlugin, tailwindLinkPlugin];
}

type PrecompileResult = {
  html: string;
  ssrTemplate?: SlotifiedTemplate;
  templateId?: string | null;
};

type SpaModuleEntry = {
  templateId: string;
  fileName: string;
  templateHtml: string;
  bodyHtml: string;
  ir: IrDocument;
  transformScripts: string | null;
  persistNamespaces: string[] | null;
};

type SlotifiedTemplate = {
  version: 1;
  templateId: string;
  static: string[];
  slots: SlotDescriptor[];
  ir: unknown;
  nodeMeta: Record<string, NodeMeta>;
};

type SlotDescriptor = {
  id: string;
  kind: "inner" | "outer";
  html: string;
};

type NodeMeta = {
  tag: string;
  attrs: Record<string, string>;
};

type ElementLocation = { line: number; column: number };

async function precompileHtml(
  html: string,
  ctx: IndexHtmlTransformContext | undefined,
  rootDir: string,
  resolveId: (id: string, importer?: string) => Promise<{ id: string } | null>,
  options: HyTdePluginOptions,
  resolvedConfig: ResolvedConfig | null,
  tailwindSupport: TailwindSupportConfig | null,
  emitSsr: boolean
): Promise<PrecompileResult> {
  const doc = parseHtmlDocument(html);
  const basePath = resolveBasePath(ctx, rootDir);
  await resolveImports(doc, basePath, resolveId, rootDir);
  const templateId = resolveTemplateId(ctx, rootDir);
  const locationSnapshot = serializeDocument(doc);
  const locationMap = buildElementLocationMap(doc, locationSnapshot);
  const idGenerator = templateId
    ? createStableIdGenerator(templateId, locationMap)
    : undefined;
  const ir = parseDocumentToIr(doc, { idGenerator });
  const resources = extractResources(doc, basePath, rootDir);
  if (resources) {
    ir.resources = resources;
  }
  if (!ir.routePath && templateId) {
    ir.routePath = `/${templateId}`;
  }
  clearTextBindingPlaceholders(doc, ir);
  stripPrototypingArtifacts(doc);
  normalizeSelectAnchors(doc);
  applyTailwindSupport(doc, tailwindSupport);
  stripTailwindCdn(doc, tailwindSupport);
  const isDebug = resolveRuntimeDebugMode(ctx, options, resolvedConfig);
  applyMockHandling(doc, ir, options, resolvedConfig, isDebug);
  normalizeTemplateHtml(ir);
  applyPathModeHandling(doc, ctx, options);
  if (options.spa === true && options.routerScriptPath) {
    injectRouterScriptTag(doc, options.routerScriptPath);
  }
  if (options.spa !== true) {
    injectPrerenderLinks(doc, ir.resources);
  }
  const compactIr = compactIrDocument(ir);
  validateIrSnapshot(compactIr, templateId);
  injectParserSnapshot(doc, compactIr);
  replaceRuntimeImports(doc, ctx, options, resolvedConfig, rootDir);
  const htmlOutput = serializeDocument(doc);
  const ssrTemplate = emitSsr && templateId ? buildSlotifiedTemplate(htmlOutput, ir, templateId) : undefined;
  return { html: htmlOutput, ssrTemplate, templateId };
}

function applyPathModeHandling(
  doc: Document,
  ctx: IndexHtmlTransformContext | undefined,
  options: HyTdePluginOptions
): void {
  const mode = options.pathMode === "path" ? "path" : "hash";
  if (ctx?.server) {
    setPathModeMeta(doc, mode);
    return;
  }
  setPathModeMeta(doc, mode);
}

function setPathModeMeta(doc: Document, mode: "hash" | "path"): void {
  const metas = Array.from(doc.querySelectorAll('meta[name="hy-path-mode"]'));
  for (const meta of metas) {
    meta.remove();
  }
  const meta = doc.createElement("meta");
  meta.setAttribute("name", "hy-path-mode");
  meta.setAttribute("content", `mode=${mode}; rules=*`);
  if (doc.head) {
    doc.head.appendChild(meta);
  }
}

function applyMockHandling(
  doc: Document,
  ir: IrDocument,
  options: HyTdePluginOptions,
  resolvedConfig: ResolvedConfig | null,
  isDebug: boolean
): void {
  const mock = options.mock ?? "default";
  if (mock === true) {
    return;
  }
  const isProductionBuild = resolvedConfig?.command === "build" && resolvedConfig.mode === "production";
  const shouldDisableMock = mock === false || (isProductionBuild && !isDebug);
  if (mock === false) {
    removeMockMeta(doc);
    if (isProductionBuild && !isDebug) {
      removeProductionModeMeta(doc);
      removeDebugScripts(doc);
    }
    if (shouldDisableMock) {
      ir.executionMode = "production";
      ir.mockRules = [];
    }
    return;
  }
  if (isProductionBuild && !isDebug) {
    removeProductionModeMeta(doc);
    removeMockMeta(doc);
    removeDebugScripts(doc);
    ir.executionMode = "production";
    ir.mockRules = [];
  }
}

function removeMockMeta(doc: Document): void {
  const metas = Array.from(doc.querySelectorAll('meta[name="hy-mock"]'));
  for (const meta of metas) {
    meta.remove();
  }
}

function removeProductionModeMeta(doc: Document): void {
  const metas = Array.from(doc.querySelectorAll('meta[name="hy-mode"]'));
  for (const meta of metas) {
    meta.remove();
  }
}

function removeDebugScripts(doc: Document): void {
  const scripts = Array.from(doc.querySelectorAll("script[hy-debug]"));
  for (const script of scripts) {
    script.remove();
  }
}

function parseHtmlDocument(html: string): Document {
  const { document, window } = parseHTML(html);
  ensureDomGlobals(window);
  return document as unknown as Document;
}

function extractResources(
  doc: Document,
  basePath: string,
  rootDir: string
): IrDocument["resources"] | null {
  const css: IrResourceItem[] = [];
  const js: IrResourceItem[] = [];
  const prefetch: string[] = [];

  const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) {
      continue;
    }
    const resolved = resolveResourceUrl(href, basePath, rootDir);
    css.push({
      href: resolved ?? href,
      integrity: link.getAttribute("integrity") ?? undefined,
      crossOrigin: parseCrossOrigin(link.getAttribute("crossorigin")),
      critical: link.hasAttribute("critical") || undefined
    });
  }

  const scripts = Array.from(doc.querySelectorAll("script[src]"));
  for (const script of scripts) {
    const src = script.getAttribute("src");
    if (!src) {
      continue;
    }
    const resolved = resolveResourceUrl(src, basePath, rootDir);
    js.push({
      src: resolved ?? src,
      integrity: script.getAttribute("integrity") ?? undefined,
      crossOrigin: parseCrossOrigin(script.getAttribute("crossorigin")),
      async: script.hasAttribute("async") || undefined,
      defer: script.hasAttribute("defer") || undefined,
      critical: script.hasAttribute("critical") || undefined
    });
  }

  const metaPrefetch = Array.from(doc.querySelectorAll('meta[name="hy-prefetch"]'));
  for (const meta of metaPrefetch) {
    const content = meta.getAttribute("content") ?? "";
    const urls = content
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const url of urls) {
      const resolved = resolveResourceUrl(url, basePath, rootDir);
      prefetch.push(resolved ?? url);
    }
  }

  if (css.length === 0 && js.length === 0 && prefetch.length === 0) {
    return null;
  }

  return { css, js, prefetch };
}

function resolveResourceUrl(value: string, basePath: string, rootDir: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  const baseDir = dirname(basePath);
  const resolved = resolve(baseDir, trimmed);
  if (!resolved.startsWith(rootDir)) {
    return trimmed;
  }
  return `/${toPosixPath(relative(rootDir, resolved))}`;
}

function parseCrossOrigin(value: string | null): "anonymous" | "use-credentials" | undefined {
  if (value === "anonymous" || value === "use-credentials") {
    return value;
  }
  return undefined;
}

function extractIrFromHtml(html: string): IrDocument | null {
  const doc = parseHtmlDocument(html);
  const script = doc.getElementById(PARSER_SNAPSHOT_ID);
  if (!script) {
    return null;
  }
  const payload = script.textContent?.trim();
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as IrDocument;
  } catch {
    return null;
  }
}

function buildSpaModuleEntry(html: string, templateId: string): SpaModuleEntry | null {
  const ir = extractIrFromHtml(html);
  if (!ir) {
    return null;
  }
  const doc = parseHtmlDocument(html);
  const expanded = expandIrDocument(ir);
  const cloakElementIds = Array.isArray(expanded.cloakElementIds) ? expanded.cloakElementIds : [];
  removeSpaCloakDisplay(doc, cloakElementIds);
  stripWhitespaceNodes(doc.body);
  const bodyHtml = doc.body?.outerHTML ?? `<body>${doc.body?.innerHTML ?? ""}</body>`;
  const transformScripts = expanded.transformScripts ?? null;
  const persistNamespaces = extractPersistNamespaces(doc);
  return {
    templateId,
    fileName: toSpaModuleFileName(templateId),
    templateHtml: html,
    bodyHtml,
    ir,
    transformScripts,
    persistNamespaces
  };
}

function toSpaModuleFileName(templateId: string): string {
  const normalized = templateId.replace(/\.html?$/, "");
  return `${normalized}${SPA_MODULE_SUFFIX}`;
}

function buildSpaModuleOutput(entry: SpaModuleEntry): { code: string; map: SourceMap } {
  const bodyHtml = toTemplateLiteral(entry.bodyHtml);
  const ir = JSON.stringify(entry.ir);
  const transforms = JSON.stringify(entry.transformScripts);
  const persistNamespaces = JSON.stringify(entry.persistNamespaces);
  const code = `/* DO NOT EDIT - Generated file */
const spaRuntime = globalThis.__hytdeSpaRuntime;
if (!spaRuntime) {
  throw new Error("[hytde][spa] runtime globals not available; ensure precompile/standalone entry is loaded.");
}
const { createRuntime, initHyPathParams, parseSubtree } = spaRuntime;

export const ir = ${ir};
export const transforms = ${transforms};
export const persistNamespaces = ${persistNamespaces};

const runtime = createRuntime({
  parseDocument: () => {
    throw new Error("parseDocument is not available in SPA runtime.");
  },
  parseSubtree
});

let transformsRegistered = false;

function resolveSpaUrlPath(options) {
  const rawUrl = options && options.url ? String(options.url) : "";
  if (rawUrl) {
    try {
      return new URL(rawUrl, window.location.origin).pathname || "";
    } catch {
      return rawUrl.split(/[?#]/)[0] || "";
    }
  }
  return window.location.pathname || "";
}

function syncHyPathMeta(routePath) {
  if (!routePath || typeof document === "undefined") {
    return;
  }
  const head = document.head;
  if (!head) {
    return;
  }
  let meta = head.querySelector('meta[name="hy-path"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "hy-path");
    head.appendChild(meta);
  }
  meta.setAttribute("content", routePath);
}

function parseRouteParams(routePath, urlPath) {
  if (!routePath || !urlPath) {
    return {};
  }
  const names = [];
  const escaped = routePath.replace(/[.*+?^{}()|[\\]\\\\$]/g, "\\\\$&");
  const regexSource = escaped.replace(/\\\\\\[([^\\]]+)\\\\\\]/g, (_raw, name) => {
    names.push(name);
    return "([^/]+)";
  });
  const regex = new RegExp("^" + regexSource + "$");
  const match = regex.exec(urlPath);
  if (!match) {
    return {};
  }
  const params = {};
  names.forEach((name, index) => {
    params[name] = decodeURIComponent(match[index + 1] || "");
  });
  return params;
}

function applySpaRouteParams(params, routePath, urlPath) {
  if (!params || typeof params !== "object" || !routePath) {
    return;
  }
  const overrides = { ...params };
  const parsed = parseRouteParams(routePath, urlPath);
  const next = { ...parsed, ...overrides };
  for (const key of Object.keys(params)) {
    delete params[key];
  }
  Object.assign(params, next);
  const scope = typeof window !== "undefined" ? window : globalThis;
  const hy = scope.hy ?? (scope.hy = { loading: false, errors: [] });
  scope.hyParams = next;
  hy.pathParams = next;
}

export function render(params, data, options) {
  void data;
  if (options && options.hydrate) {
    return document.body;
  }
  const routePath = options && options.routePath ? String(options.routePath) : "";
  if (routePath) {
    syncHyPathMeta(routePath);
    applySpaRouteParams(params, routePath, resolveSpaUrlPath(options));
  }
  const parser = new DOMParser();
  const parsed = parser.parseFromString(${bodyHtml}, "text/html");
  if (!parsed.body) {
    throw new Error("[hytde] SPA render did not create a body element.");
  }
  return parsed.body;
}

export function registerTransforms(hy) {
  if (transformsRegistered) {
    return;
  }
  if (typeof transforms !== "string" || !transforms.trim()) {
    transformsRegistered = true;
    return;
  }
  try {
    const runner = new Function("hy", transforms);
    runner(hy);
    transformsRegistered = true;
  } catch (error) {
    console.error("[hytde][spa] transform script error", error);
  }
}

export function init(data) {
  const scope = typeof window !== "undefined" ? window : globalThis;
  if (data && typeof data === "object") {
    scope.hyState = data;
  }
  const hy = scope.hy ?? (scope.hy = { loading: false, errors: [] });
  registerTransforms(hy);
  initHyPathParams(document);
  runtime.init(document, ir);
}
`;
  const map = buildSpaModuleSourceMap(entry, code);
  return { code, map };
}

function extractPersistNamespaces(doc: Document): string[] | null {
  const meta = doc.querySelector('meta[name="hy-persist-state"]');
  const content = meta?.getAttribute("content")?.trim();
  if (!content) {
    return null;
  }
  const entries = content
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : null;
}

function toTemplateLiteral(value: string): string {
  const escaped = value
    .replace(/\\\\/g, "\\\\\\\\")
    .replace(/`/g, "\\\\`")
    .replace(/\\$\\{/g, "\\\\${");
  return "`" + escaped + "`";
}

function removeSpaCloakDisplay(doc: Document, cloakElementIds: string[]): void {
  for (const id of cloakElementIds) {
    const element = doc.getElementById(id);
    if (!element) {
      continue;
    }
    const rawStyle = element.getAttribute("style");
    if (!rawStyle) {
      continue;
    }
    const nextStyle = rawStyle
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => {
        const [prop, ...rest] = entry.split(":");
        const name = prop?.trim().toLowerCase();
        const value = rest.join(":").trim().toLowerCase();
        return !(name === "display" && value === "none");
      });
    if (nextStyle.length === 0) {
      element.removeAttribute("style");
    } else {
      element.setAttribute("style", nextStyle.join("; "));
    }
  }
}

function stripWhitespaceNodes(root: Element | null): void {
  if (!root) {
    return;
  }
  const stack: Array<{ node: Node; inPre: boolean }> = [{ node: root, inPre: false }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const node = current.node;
    const inPre = current.inPre;
    if (node.nodeType === 1) {
      const element = node as Element;
      const tag = element.tagName ? element.tagName.toLowerCase() : "";
      const nextInPre = inPre || tag === "pre" || tag === "textarea" || tag === "script" || tag === "style";
      const children = Array.from(element.childNodes);
      for (const child of children) {
        stack.push({ node: child, inPre: nextInPre });
      }
      continue;
    }
    if (node.nodeType === 3 && !inPre) {
      if (!node.textContent || node.textContent.trim() === "") {
        node.parentNode?.removeChild(node);
      }
    }
  }
}

function buildSpaModuleSourceMap(entry: SpaModuleEntry, code: string): SourceMap {
  const source = entry.templateHtml;
  const raw = {
    version: 3,
    file: entry.fileName,
    sources: [entry.templateId],
    sourcesContent: [source],
    names: [],
    mappings: ""
  };
  const json = () => JSON.stringify(raw);
  return {
    ...raw,
    toString: () => json(),
    toUrl: () => `data:application/json;charset=utf-8,${encodeURIComponent(json())}`
  };
}

function resolveBasePath(ctx: IndexHtmlTransformContext | undefined, rootDir: string): string {
  if (ctx?.filename) {
    return ctx.filename;
  }
  if (ctx?.path) {
    const path = ctx.path.startsWith("/") ? ctx.path.slice(1) : ctx.path;
    return join(rootDir, path);
  }
  return rootDir;
}

async function resolveImports(
  doc: Document,
  basePath: string,
  resolveId: (id: string, importer?: string) => Promise<{ id: string } | null>,
  rootDir: string,
  stack: Set<string> = new Set()
): Promise<void> {
  const targets = Array.from(doc.querySelectorAll("hy-import"));
  for (const target of targets) {
    const src = target.getAttribute("src");
    if (!src) {
      continue;
    }
    const resolved = await resolveImportSource(src, basePath, resolveId, rootDir);
    if (!resolved) {
      target.remove();
      continue;
    }
    if (stack.has(resolved.url)) {
      target.remove();
      continue;
    }
    const nextStack = new Set(stack);
    nextStack.add(resolved.url);
    await resolveImports(resolved.doc, resolved.path, resolveId, rootDir, nextStack);

    const selection = selectImportExports(resolved.doc, target.getAttribute("hy-export"));
    const contentNodes = selection.contentNodes.map((node) => cloneIntoDocument(doc, node));
    const assetNodes = selection.assetNodes.map((node) => cloneIntoDocument(doc, node));

    for (const node of [...contentNodes, ...assetNodes]) {
      if (node instanceof Element) {
        node.removeAttribute("hy-export");
      }
    }

    ensureUniqueIds(contentNodes, doc);
    mergeAssets(assetNodes, doc, resolved.url);
    replaceImportTarget(target, contentNodes);
  }
}

function cloneIntoDocument(doc: Document, node: Element): Element {
  if (typeof doc.importNode === "function") {
    return doc.importNode(node, true) as Element;
  }
  return node.cloneNode(true) as Element;
}

async function resolveImportSource(
  src: string,
  basePath: string,
  resolveId: (id: string, importer?: string) => Promise<{ id: string } | null>,
  rootDir: string
): Promise<{ url: string; path: string; doc: Document } | null> {
  const importer = resolveImporter(basePath, rootDir);
  const resolved = importer ? await resolveId(src, importer) : null;
  if (resolved?.id) {
    const cleaned = stripQueryAndHash(resolved.id);
    if (cleaned.startsWith("file://")) {
      const filePath = fileURLToPath(cleaned);
      const html = await readFile(filePath, "utf8");
      return { url: pathToFileURL(filePath).toString(), path: filePath, doc: parseHtmlDocument(html) };
    }
    if (isAbsolute(cleaned)) {
      const html = await readFile(cleaned, "utf8");
      return { url: pathToFileURL(cleaned).toString(), path: cleaned, doc: parseHtmlDocument(html) };
    }
  }

  const fallbackUrl = resolveImportUrl(src, basePath, rootDir);
  if (!fallbackUrl) {
    return null;
  }
  if (fallbackUrl.startsWith("file://")) {
    const filePath = fileURLToPath(fallbackUrl);
    const html = await readFile(filePath, "utf8");
    return { url: fallbackUrl, path: filePath, doc: parseHtmlDocument(html) };
  }
  const response = await fetch(fallbackUrl);
  if (!response.ok) {
    return null;
  }
  const html = await response.text();
  return { url: fallbackUrl, path: fallbackUrl, doc: parseHtmlDocument(html) };
}

function resolveImportUrl(src: string, basePath: string, rootDir: string): string | null {
  if (isHttpUrl(src)) {
    return src;
  }
  if (isHttpUrl(basePath)) {
    return new URL(src, basePath).toString();
  }
  if (basePath.startsWith("file://")) {
    return new URL(src, basePath).toString();
  }
  if (src.startsWith("/")) {
    const filePath = join(rootDir, src.slice(1));
    if (isFileSync(filePath)) {
      return pathToFileURL(filePath).toString();
    }
    const publicPath = join(rootDir, "public", src.slice(1));
    if (isFileSync(publicPath)) {
      return pathToFileURL(publicPath).toString();
    }
    return pathToFileURL(filePath).toString();
  }
  if (isAbsolute(basePath)) {
    return pathToFileURL(join(dirname(basePath), src)).toString();
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function stripQueryAndHash(value: string): string {
  const index = value.search(/[?#]/);
  if (index === -1) {
    return value;
  }
  return value.slice(0, index);
}

function resolveImporter(basePath: string, rootDir: string): string | null {
  if (isHttpUrl(basePath)) {
    return null;
  }
  if (basePath.startsWith("file://")) {
    return fileURLToPath(basePath);
  }
  if (isAbsolute(basePath)) {
    return basePath;
  }
  return join(rootDir, basePath);
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
  const exists = (id: string) => doc.getElementById(id) !== null || seen.has(id);

  for (const root of nodes) {
    const elements = [root, ...Array.from(root.querySelectorAll("[id]"))];
    for (const element of elements) {
      const id = element.getAttribute("id");
      if (!id) {
        continue;
      }
      if (exists(id)) {
        element.removeAttribute("id");
        continue;
      }
      seen.add(id);
    }
  }
}

function stripPrototypingArtifacts(doc: Document): void {
  const dummyElements = Array.from(doc.querySelectorAll("[hy-dummy]"));
  for (const element of dummyElements) {
    element.remove();
  }

  const previewHidden = Array.from(doc.querySelectorAll('[hidden="hy-ignore"]'));
  for (const element of previewHidden) {
    const id = element.getAttribute("id") ?? "";
    if (id.startsWith("hy-if-") || id.startsWith("hy-for-")) {
      continue;
    }
    element.removeAttribute("hidden");
  }

  const cloakElements = Array.from(doc.querySelectorAll("[hy-cloak]"));
  for (const element of cloakElements) {
    element.removeAttribute("hy-cloak");
  }
}

function clearTextBindingPlaceholders(doc: Document, ir: IrDocument): void {
  for (const binding of ir.textBindings) {
    const id = binding.nodeId;
    if (!id) {
      continue;
    }
    const element = doc.getElementById(id);
    if (!element) {
      continue;
    }
    element.textContent = "";
  }
}


type TailwindSupportConfig = {
  mode: "virtual" | "file";
  input: string;
  href: string;
};

async function resolveTailwindSupport(
  options: HyTdePluginOptions,
  rootDir: string
): Promise<TailwindSupportConfig | null> {
  const support = options.tailwindSupport;
  if (!support) {
    return null;
  }
  if (support === true) {
    return {
      mode: "virtual",
      input: TAILWIND_VIRTUAL_ID,
      href: TAILWIND_VIRTUAL_ID
    };
  }
  const resolved = isAbsolute(support) ? support : resolve(rootDir, support);
  const css = await readTailwindCss(resolved, support);
  if (!/@import\s+['"]tailwindcss['"]/.test(css)) {
    throw new Error(`[hytde] tailwindSupport file must include @import "tailwindcss": ${support}`);
  }
  const href = toPosixPath(relative(rootDir, resolved));
  return {
    mode: "file",
    input: resolved,
    href: href.startsWith(".") ? href : `/${href}`
  };
}

async function readTailwindCss(resolvedPath: string, original: string): Promise<string> {
  try {
    return await readFile(resolvedPath, "utf8");
  } catch {
    throw new Error(`[hytde] tailwindSupport file not found: ${original}`);
  }
}

function applyTailwindSupport(doc: Document, support: TailwindSupportConfig | null): void {
  if (!support) {
    return;
  }
  if (!hasTailwindCdn(doc)) {
    return;
  }
  if (doc.querySelector(`link[${TAILWIND_LINK_MARKER}]`)) {
    return;
  }
  const head = doc.head ?? doc.querySelector("head");
  if (!head) {
    return;
  }
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = support.href;
  link.setAttribute(TAILWIND_LINK_MARKER, "true");
  head.appendChild(link);
}

function stripTailwindCdn(doc: Document, support: TailwindSupportConfig | null): void {
  if (!support) {
    return;
  }
  if (!hasTailwindCdn(doc)) {
    return;
  }
  for (const script of Array.from(doc.querySelectorAll('script[src*="cdn.tailwindcss.com"]'))) {
    script.remove();
  }
  for (const style of Array.from(doc.querySelectorAll('style[type="text/tailwindcss"]'))) {
    style.remove();
  }
}

function findTailwindCssAsset(
  bundle: OutputBundle,
  support: TailwindSupportConfig
): OutputAsset | null {
  const targetName = support.mode === "file" ? basename(support.input) : TAILWIND_ASSET_NAME;
  for (const output of Object.values(bundle)) {
    if (output.type !== "asset" || !output.fileName.endsWith(".css")) {
      continue;
    }
    if (output.name === targetName) {
      return output;
    }
  }
  return null;
}

function normalizeAssetHref(fileName: string): string {
  return fileName.startsWith("/") ? fileName : `/${fileName}`;
}

function updateTailwindLinkHref(html: string, href: string): string {
  return html.replace(/<link\b[^>]*data-hytde-tailwind="true"[^>]*>/g, (tag) => {
    if (tag.includes("href=")) {
      return tag.replace(/href=(["']).*?\1/, `href="${href}"`);
    }
    return tag.replace("<link", `<link href="${href}"`);
  });
}

function readAssetSource(asset: OutputAsset): string | null {
  if (typeof asset.source === "string") {
    return asset.source;
  }
  if (asset.source instanceof Uint8Array) {
    return Buffer.from(asset.source).toString("utf8");
  }
  return null;
}

function hasTailwindCdn(doc: Document): boolean {
  return Boolean(doc.querySelector('script[src*="cdn.tailwindcss.com"]'));
}

function normalizeSelectAnchors(doc: Document): void {
  const anchors = Array.from(doc.querySelectorAll('select [hidden="hy-ignore"]'));
  for (const anchor of anchors) {
    const parent = anchor.parentElement;
    if (!parent || parent.tagName.toLowerCase() !== "select") {
      continue;
    }
    if (anchor.tagName.toLowerCase() === "option") {
      continue;
    }
    const id = anchor.getAttribute("id") ?? "";
    if (!id.startsWith("hy-for-") && !id.startsWith("hy-if-")) {
      continue;
    }
    const option = doc.createElement("option");
    if (id) {
      option.setAttribute("id", id);
    }
    option.setAttribute("hidden", "hy-ignore");
    option.setAttribute("value", "");
    anchor.replaceWith(option);
  }
}

function injectParserSnapshot(doc: Document, ir: unknown): void {
  const script = doc.createElement("script");
  script.id = PARSER_SNAPSHOT_ID;
  script.type = "application/json";
  script.textContent = JSON.stringify(ir);
  if (doc.head) {
    doc.head.appendChild(script);
    return;
  }
  doc.documentElement?.appendChild(script);
}

function injectPrerenderLinks(
  doc: Document,
  resources: IrDocument["resources"] | null | undefined
): void {
  if (!resources?.prefetch || resources.prefetch.length === 0) {
    return;
  }
  const head = doc.head ?? doc.querySelector("head");
  if (!head) {
    return;
  }
  const existing = new Set<string>();
  for (const link of Array.from(head.querySelectorAll('link[rel="prerender"][href]'))) {
    const href = link.getAttribute("href");
    if (href) {
      existing.add(href);
    }
  }
  for (const href of resources.prefetch) {
    if (!href || existing.has(href)) {
      continue;
    }
    const link = doc.createElement("link");
    link.setAttribute("rel", "prerender");
    link.setAttribute("href", href);
    head.appendChild(link);
    existing.add(href);
  }
}

function injectRouterScriptTag(doc: Document, routerScriptPath?: string): void {
  const path = routerScriptPath ?? "/router.js";
  if (!path) {
    return;
  }
  const body = doc.body ?? doc.querySelector("body");
  if (!body) {
    return;
  }
  const existing = Array.from(body.querySelectorAll("script[src]")).some(
    (script) => script.getAttribute("src") === path
  );
  if (existing) {
    return;
  }
  const script = doc.createElement("script");
  script.setAttribute("src", path);
  script.setAttribute("defer", "");
  body.appendChild(script);
}

function validateStaticHtmlOutput(html: string, templateId: string): void {
  const doc = parseHtmlDocument(html);
  if (!doc.documentElement || !doc.body) {
    console.warn("[hytde] static html missing root elements", { templateId });
  }
  const snapshot = doc.getElementById(PARSER_SNAPSHOT_ID);
  if (!snapshot) {
    console.warn("[hytde] static html missing parser snapshot", { templateId });
  }
}

function collectSpaHtmlEntries(
  bundle: OutputBundle,
  staticHtml: Map<string, string>
): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [fileName, html] of staticHtml.entries()) {
    if (html) {
      entries.set(fileName, html);
    }
  }
  for (const output of Object.values(bundle)) {
    if (output.type !== "asset" || !output.fileName.endsWith(".html")) {
      continue;
    }
    const html = readAssetSource(output);
    if (html) {
      const key = toPosixPath(output.fileName);
      if (!entries.has(key)) {
        entries.set(key, html);
      }
    }
  }
  return entries;
}

function createOutputAsset(fileName: string, source: string): OutputAsset {
  return {
    type: "asset",
    fileName,
    name: fileName,
    names: [fileName],
    originalFileName: null,
    originalFileNames: [],
    needsCodeReference: false,
    source
  };
}

function validateIrSnapshot(snapshot: unknown, templateId: string | null): void {
  if (!snapshot || typeof snapshot !== "object") {
    console.warn("[hytde] invalid IR snapshot", { templateId });
    return;
  }
  try {
    JSON.stringify(snapshot);
  } catch (error) {
    console.warn("[hytde] IR snapshot not serializable", { templateId, error });
  }
  const record = snapshot as Record<string, unknown>;
  if (!("tb" in record) && !("rt" in record) && !("ic" in record) && !("m" in record)) {
    console.warn("[hytde] IR snapshot missing compact keys", { templateId });
  }
}


function replaceRuntimeImports(
  doc: Document,
  ctx: IndexHtmlTransformContext | undefined,
  options: HyTdePluginOptions,
  resolvedConfig: ResolvedConfig | null,
  rootDir: string
): void {
  const isDebug = resolveRuntimeDebugMode(ctx, options, resolvedConfig);
  const manual = Boolean(options.manual);
  const isDevServer = Boolean(ctx?.server || resolvedConfig?.command === "serve");
  const devPrecompile = isDevServer ? resolveDevPrecompileSpecifier(rootDir, isDebug, manual) : null;
  const scripts = Array.from(doc.querySelectorAll('script[type="module"]'));
  for (const script of scripts) {
    if (script instanceof HTMLScriptElement && script.src) {
      const nextSrc = replaceStandaloneRuntimeUrl(script.src, isDebug, manual);
      if (nextSrc !== script.src) {
        script.src = nextSrc;
      }
      continue;
    }
    const original = script.textContent ?? "";
    const next = original.replace(STANDALONE_IMPORT_PATTERN, (match) =>
      resolveStandaloneRuntimeImport(match, isDebug, manual, devPrecompile)
    );
    if (next !== original) {
      script.textContent = next;
    }
  }
}

function resolveRuntimeDebugMode(
  ctx: IndexHtmlTransformContext | undefined,
  options: HyTdePluginOptions,
  resolvedConfig: ResolvedConfig | null
): boolean {
  if (options.mock === true) {
    return true;
  }
  if (typeof options.debug === "boolean") {
    return options.debug;
  }
  if (ctx?.server) {
    return true;
  }
  const mode = resolvedConfig?.mode ?? "production";
  return mode !== "production";
}

function resolveStandaloneRuntimeImport(
  specifier: string,
  isDebug: boolean,
  manual: boolean,
  devPrecompile?: string | null
): string {
  if (specifier.endsWith("/debug-api") || specifier.endsWith("/msw-debug")) {
    return specifier;
  }
  if (devPrecompile) {
    return devPrecompile;
  }
  const isNoAuto = manual || specifier.includes("/no-auto");
  if (isNoAuto) {
    return isDebug ? "@hytde/precompile/no-auto-debug" : "@hytde/precompile/no-auto";
  }
  return isDebug ? "@hytde/precompile/debug" : "@hytde/precompile";
}

function replaceStandaloneRuntimeUrl(value: string, isDebug: boolean, manual: boolean): string {
  if (
    !value.includes("@hytde/standalone") ||
    value.includes("@hytde/standalone/debug-api") ||
    value.includes("@hytde/standalone/msw-debug")
  ) {
    return value;
  }
  let next = value.replace("@hytde/standalone", "@hytde/precompile");
  next = next.replace(
    /@hytde\/precompile\/(debug|no-auto|no-auto-debug)(?=\/|$)/,
    (_match, kind) => {
      if (manual || kind === "no-auto" || kind === "no-auto-debug") {
        return isDebug ? "@hytde/precompile/no-auto-debug" : "@hytde/precompile/no-auto";
      }
      return isDebug ? "@hytde/precompile/debug" : "@hytde/precompile";
    }
  );
  const variantMatch = next.match(/\/(production|debug)-(auto|manual)\//);
  if (variantMatch) {
    const isManual = manual || variantMatch[2] === "manual";
    const variant = `${isDebug ? "debug" : "production"}-${isManual ? "manual" : "auto"}`;
    next = next.replace(/\/(production|debug)-(auto|manual)\//, `/${variant}/`);
  }
  return next;
}

function resolvePrecompileEntryPath(rootDir: string, variant: string): string | null {
  const candidates = [
    resolve(rootDir, "..", "precompile", "entries", variant, "index.ts"),
    resolve(rootDir, "packages", "precompile", "entries", variant, "index.ts")
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Ignore missing candidates; fallback tries the next path.
    }
  }
  return null;
}

async function resolveMswWorkerPath(rootDir: string): Promise<string | null> {
  const candidates: string[] = [];
  const publicCandidate = resolve(rootDir, "public", "mockServiceWorker.js");
  candidates.push(publicCandidate);
  let mswRoot: string | null = null;
  try {
    mswRoot = resolve(require.resolve("msw/package.json"), "..");
  } catch {
    mswRoot = null;
  }
  if (mswRoot) {
    candidates.push(
      resolve(mswRoot, "lib/mockServiceWorker.js"),
      resolve(mswRoot, "src/mockServiceWorker.js"),
      resolve(mswRoot, "dist/mockServiceWorker.js")
    );
  }
  candidates.push(
    resolve(rootDir, "node_modules", "msw", "lib", "mockServiceWorker.js"),
    resolve(rootDir, "node_modules", "msw", "src", "mockServiceWorker.js"),
    resolve(rootDir, "node_modules", "msw", "dist", "mockServiceWorker.js")
  );
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // Continue to next candidate.
    }
  }
  return null;
}

function resolveDevPrecompileSpecifier(rootDir: string, isDebug: boolean, manual: boolean): string | null {
  const variant = isDebug
    ? manual
      ? "debug-manual"
      : "debug-auto"
    : manual
      ? "production-manual"
      : "production-auto";
  const candidate = resolvePrecompileEntryPath(rootDir, variant);
  if (!candidate) {
    return null;
  }
  return `/@fs/${toPosixPath(candidate)}`;
}

function resolveLocalPrecompileEntry(source: string, rootDir: string): string | null {
  if (!source.startsWith("@hytde/precompile")) {
    return null;
  }
  let variant = "production-auto";
  if (source.endsWith("/no-auto-debug")) {
    variant = "debug-manual";
  } else if (source.endsWith("/no-auto")) {
    variant = "production-manual";
  } else if (source.endsWith("/debug")) {
    variant = "debug-auto";
  }
  return resolvePrecompileEntryPath(rootDir, variant);
}

function serializeDocument(doc: Document): string {
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
  const html = doc.documentElement?.outerHTML ?? "";
  return `${doctype}\n${html}`;
}

function resolveTemplateId(ctx: IndexHtmlTransformContext | undefined, rootDir: string): string | null {
  if (ctx?.filename) {
    return toPosixPath(relative(rootDir, ctx.filename));
  }
  if (ctx?.path) {
    const cleaned = ctx.path.startsWith("/") ? ctx.path.slice(1) : ctx.path;
    return cleaned || null;
  }
  return null;
}

function buildSlotifiedTemplate(html: string, ir: unknown, templateId: string): SlotifiedTemplate {
  const doc = parseHtmlDocument(html);
  const { compact, verbose } = normalizeSlotIr(ir);
  const slotIds = collectSlotIds(verbose);
  const outerSlotIds = collectOuterSlotIds(verbose);
  const slotElements = collectSlotElements(doc, slotIds);
  const { htmlWithMarkers, slots, nodeMeta } = replaceSlotsWithMarkers(doc, slotElements, outerSlotIds);
  const staticParts = splitSlotMarkers(htmlWithMarkers, slots.length);
  return {
    version: 1,
    templateId,
    static: staticParts,
    slots,
    ir: compact,
    nodeMeta
  };
}

function normalizeSlotIr(ir: unknown): { compact: unknown; verbose: IrDocument } {
  const record = ir && typeof ir === "object" ? (ir as Record<string, unknown>) : null;
  const isCompact = Boolean(record && ("tb" in record || "rt" in record || "ic" in record));
  if (isCompact) {
    return { compact: ir, verbose: expandIrDocument(ir) };
  }
  return { compact: compactIrDocument(ir as IrDocument), verbose: ir as IrDocument };
}

function collectSlotIds(ir: IrDocument): Set<string> {
  const ids = new Set<string>();
  for (const binding of ir.textBindings ?? []) {
    ids.add(binding.nodeId);
  }
  for (const binding of ir.attrBindings ?? []) {
    ids.add(binding.nodeId);
  }
  for (const template of ir.forTemplates ?? []) {
    ids.add(template.markerId);
  }
  for (const chain of ir.ifChains ?? []) {
    ids.add(chain.anchorId);
    for (const node of chain.nodes ?? []) {
      ids.add(node.nodeId);
    }
  }
  for (const table of ir.tables ?? []) {
    ids.add(table.tableElementId);
  }
  for (const id of ir.dummyElementIds ?? []) {
    ids.add(id);
  }
  return ids;
}

function collectOuterSlotIds(ir: IrDocument): Set<string> {
  const ids = new Set<string>();
  for (const template of ir.forTemplates ?? []) {
    ids.add(template.markerId);
  }
  for (const chain of ir.ifChains ?? []) {
    ids.add(chain.anchorId);
    for (const node of chain.nodes ?? []) {
      ids.add(node.nodeId);
    }
  }
  for (const table of ir.tables ?? []) {
    ids.add(table.tableElementId);
  }
  for (const id of ir.dummyElementIds ?? []) {
    ids.add(id);
  }
  return ids;
}

function collectSlotElements(doc: Document, slotIds: Set<string>): Element[] {
  const candidates = Array.from(doc.querySelectorAll("[id]"));
  const selected = candidates.filter((element) => {
    const id = element.getAttribute("id");
    return id ? slotIds.has(id) : false;
  });
  return selected.filter((element) => !hasSlotAncestor(element, slotIds));
}

function hasSlotAncestor(element: Element, slotIds: Set<string>): boolean {
  let current = element.parentElement;
  while (current) {
    const id = current.getAttribute("id");
    if (id && slotIds.has(id)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function replaceSlotsWithMarkers(
  doc: Document,
  slotElements: Element[],
  outerSlotIds: Set<string>
): { htmlWithMarkers: string; slots: SlotDescriptor[]; nodeMeta: Record<string, NodeMeta> } {
  const slots: SlotDescriptor[] = [];
  const nodeMeta: Record<string, NodeMeta> = {};
  slotElements.forEach((element, index) => {
    const id = element.getAttribute("id") ?? "";
    const marker = `hytde-slot:${index}`;
    const comment = doc.createComment(marker);
    const kind: SlotDescriptor["kind"] = outerSlotIds.has(id) ? "outer" : "inner";
    slots.push({ id, kind, html: element.outerHTML });
    nodeMeta[id] = {
      tag: element.tagName.toLowerCase(),
      attrs: collectAttributes(element)
    };
    element.replaceWith(comment);
  });
  const htmlWithMarkers = serializeDocument(doc);
  return { htmlWithMarkers, slots, nodeMeta };
}

function collectAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const name of element.getAttributeNames()) {
    const value = element.getAttribute(name);
    if (value != null) {
      attrs[name] = value;
    }
  }
  return attrs;
}

function splitSlotMarkers(html: string, slotCount: number): string[] {
  const parts: string[] = [];
  let cursor = 0;
  for (let index = 0; index < slotCount; index += 1) {
    const marker = `<!--hytde-slot:${index}-->`;
    const matchIndex = html.indexOf(marker, cursor);
    if (matchIndex === -1) {
      break;
    }
    parts.push(html.slice(cursor, matchIndex));
    cursor = matchIndex + marker.length;
  }
  parts.push(html.slice(cursor));
  return parts;
}

type ElementLocationMaps = {
  locations: WeakMap<Element, ElementLocation>;
};

function buildElementLocationMap(doc: Document, html: string): ElementLocationMaps {
  const elements = Array.from(doc.querySelectorAll("*"));
  const locations = collectStartTagLocations(html);
  const locationMap = new WeakMap<Element, ElementLocation>();
  elements.forEach((element, index) => {
    const location = locations[index];
    if (location) {
      locationMap.set(element, location);
    }
  });
  return { locations: locationMap };
}

function createStableIdGenerator(
  templateId: string,
  maps: ElementLocationMaps
): (element: Element) => string {
  let fallbackCounter = 0;
  return (element: Element) => {
    const location = maps.locations.get(element);
    const tag = element.tagName ? element.tagName.toLowerCase() : "node";
    const key = location
      ? `${templateId}:${location.line}:${location.column}:${tag}`
      : `${templateId}:${tag}:gen:${fallbackCounter++}`;
    return `hy-id-${hashString(key)}`;
  };
}

function collectStartTagLocations(html: string): ElementLocation[] {
  const locations: ElementLocation[] = [];
  const lower = html.toLowerCase();
  let line = 1;
  let column = 1;
  let cursor = 0;

  const advanceBy = (chunk: string) => {
    for (const char of chunk) {
      if (char === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
  };

  while (cursor < html.length) {
    const char = html[cursor];
    if (char === "\n") {
      line += 1;
      column = 1;
      cursor += 1;
      continue;
    }
    if (char !== "<") {
      column += 1;
      cursor += 1;
      continue;
    }
    const next = html[cursor + 1] ?? "";
    if (next === "!") {
      if (lower.startsWith("<!--", cursor)) {
        const end = lower.indexOf("-->", cursor + 4);
        const endIndex = end === -1 ? html.length : end + 3;
        advanceBy(html.slice(cursor, endIndex));
        cursor = endIndex;
        continue;
      }
      const end = html.indexOf(">", cursor + 2);
      const endIndex = end === -1 ? html.length : end + 1;
      advanceBy(html.slice(cursor, endIndex));
      cursor = endIndex;
      continue;
    }
    if (next === "/") {
      const end = html.indexOf(">", cursor + 2);
      const endIndex = end === -1 ? html.length : end + 1;
      advanceBy(html.slice(cursor, endIndex));
      cursor = endIndex;
      continue;
    }

    const tagLine = line;
    const tagColumn = column;
    const tagEnd = findTagEnd(html, cursor + 1);
    const tagContent = html.slice(cursor + 1, tagEnd);
    const tagName = readTagName(tagContent);
    if (tagName) {
      locations.push({ line: tagLine, column: tagColumn });
    }
    const endIndex = tagEnd + 1;
    advanceBy(html.slice(cursor, endIndex));
    cursor = endIndex;

    if (!tagName) {
      continue;
    }
    if (tagName === "script" || tagName === "style") {
      if (/\/\s*$/.test(tagContent)) {
        continue;
      }
      const closeTag = `</${tagName}`;
      const closeIndex = lower.indexOf(closeTag, cursor);
      if (closeIndex === -1) {
        continue;
      }
      const closeEnd = lower.indexOf(">", closeIndex);
      const endTagIndex = closeEnd === -1 ? html.length : closeEnd + 1;
      advanceBy(html.slice(cursor, endTagIndex));
      cursor = endTagIndex;
    }
  }

  return locations;
}

function readTagName(content: string): string | null {
  let cursor = 0;
  while (cursor < content.length && /\s/.test(content[cursor])) {
    cursor += 1;
  }
  const match = content.slice(cursor).match(/^([A-Za-z0-9:-]+)/);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase();
}

function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  let cursor = start;
  while (cursor < html.length) {
    const char = html[cursor];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && cursor + 1 < html.length) {
        cursor += 1;
      }
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === ">") {
      return cursor;
    }
    cursor += 1;
  }
  return html.length - 1;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function resolveDynamicTemplate(rootDir: string, urlPath: string): Promise<string | null> {
  const segments = urlPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  let cursor = rootDir;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    if (isLast) {
      const exactFile = join(cursor, `${segment}.html`);
      if (await isFile(exactFile)) {
        return exactFile;
      }
      const bracketFile = await findBracketFile(cursor);
      if (bracketFile) {
        return join(cursor, bracketFile);
      }
      return null;
    }
    const exactDir = join(cursor, segment);
    if (await isDirectory(exactDir)) {
      cursor = exactDir;
      continue;
    }
    const bracketDir = await findBracketDir(cursor);
    if (!bracketDir) {
      return null;
    }
    cursor = join(cursor, bracketDir);
  }
  return null;
}

async function findBracketDir(baseDir: string): Promise<string | null> {
  const entries = await readDirSafe(baseDir);
  for (const entry of entries) {
    if (entry.isDirectory() && isBracketName(entry.name)) {
      return entry.name;
    }
  }
  return null;
}

async function findBracketFile(baseDir: string): Promise<string | null> {
  const entries = await readDirSafe(baseDir);
  for (const entry of entries) {
    if (entry.isFile() && isBracketName(entry.name.replace(/\.html$/, "")) && entry.name.endsWith(".html")) {
      return entry.name;
    }
  }
  return null;
}

async function readDirSafe(baseDir: string): Promise<Dirent[]> {
  try {
    return await readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statSafe(target: string) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

function isBracketName(name: string): boolean {
  return /^\[[^\]]+\]$/.test(name);
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const stats = await stat(target);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    const stats = await stat(target);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isFileSync(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function toPosixPath(value: string): string {
  return value.split("\\").join("/");
}

function ensureDomGlobals(window: {
  Element?: unknown;
  Document?: unknown;
  Node?: unknown;
  HTMLElement?: unknown;
  HTMLFormElement?: unknown;
  HTMLInputElement?: unknown;
  HTMLSelectElement?: unknown;
  HTMLTextAreaElement?: unknown;
  HTMLScriptElement?: unknown;
  HTMLLinkElement?: unknown;
  HTMLButtonElement?: unknown;
  HTMLOptionElement?: unknown;
  HTMLImageElement?: unknown;
  HTMLAnchorElement?: unknown;
  HTMLTemplateElement?: unknown;
  HTMLTableElement?: unknown;
  HTMLTableRowElement?: unknown;
  HTMLTableSectionElement?: unknown;
  HTMLTableCellElement?: unknown;
}): void {
  const scope = globalThis as typeof globalThis & Record<string, unknown>;
  const globals: Array<[string, unknown]> = [
    ["Element", window.Element],
    ["Document", window.Document],
    ["Node", window.Node],
    ["HTMLElement", window.HTMLElement],
    ["HTMLFormElement", window.HTMLFormElement],
    ["HTMLInputElement", window.HTMLInputElement],
    ["HTMLSelectElement", window.HTMLSelectElement],
    ["HTMLTextAreaElement", window.HTMLTextAreaElement],
    ["HTMLScriptElement", window.HTMLScriptElement],
    ["HTMLLinkElement", window.HTMLLinkElement],
    ["HTMLButtonElement", window.HTMLButtonElement],
    ["HTMLOptionElement", window.HTMLOptionElement],
    ["HTMLImageElement", window.HTMLImageElement],
    ["HTMLAnchorElement", window.HTMLAnchorElement],
    ["HTMLTemplateElement", window.HTMLTemplateElement],
    ["HTMLTableElement", window.HTMLTableElement],
    ["HTMLTableRowElement", window.HTMLTableRowElement],
    ["HTMLTableSectionElement", window.HTMLTableSectionElement],
    ["HTMLTableCellElement", window.HTMLTableCellElement]
  ];
  for (const [key, value] of globals) {
    if (value && !scope[key]) {
      scope[key] = value;
    }
  }
}

type RouteManifest = Record<string, string>;

type ManifestConfig = {
  urlPath: string;
  fileName: string;
};

function resolveManifestConfig(manifestPath?: string): ManifestConfig {
  const fallback = "route-manifest.json";
  const raw = (manifestPath ?? fallback).trim() || fallback;
  const urlPath = raw.startsWith("/") ? raw : `/${raw}`;
  const fileName = raw.replace(/^\/+/, "");
  return { urlPath, fileName };
}

async function buildRouteManifest(
  rootDir: string,
  inputPaths?: string[],
  options: { moduleSuffix?: string } = {}
): Promise<RouteManifest> {
  const entries = await collectHtmlEntries(rootDir, inputPaths);
  const manifest: RouteManifest = {};
  for (const entry of entries) {
    const html = await readFile(entry, "utf8").catch(() => null);
    if (!html) {
      continue;
    }
    const routePath = resolveRoutePathFromHtml(html, entry, rootDir);
    if (!routePath) {
      console.warn("[hytde] route manifest skipped; missing route path", { entry });
      continue;
    }
    const relativePath = toPosixPath(relative(rootDir, entry));
    const modulePath = options.moduleSuffix
      ? `/${relativePath.replace(/\.html?$/, options.moduleSuffix)}`
      : `/${relativePath}`;
    addRouteManifestEntry(manifest, routePath, modulePath);
  }
  return manifest;
}

function resolveRoutePathFromHtml(html: string, entry: string, rootDir: string): string | null {
  const doc = parseHtmlDocument(html);
  const meta = doc.querySelector('meta[name="hy-path"]');
  const content = meta?.getAttribute("content")?.trim();
  if (content) {
    return normalizeRoutePath(content);
  }
  const relativePath = toPosixPath(relative(rootDir, entry));
  if (!relativePath) {
    return null;
  }
  return normalizeRoutePath(`/${relativePath}`);
}

function normalizeRoutePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function addRouteManifestEntry(manifest: RouteManifest, routePath: string, modulePath: string): void {
  if (!routePath) {
    return;
  }
  if (manifest[routePath] && manifest[routePath] !== modulePath) {
    console.warn("[hytde] route manifest duplicate; overwriting", { routePath, modulePath, previous: manifest[routePath] });
  }
  manifest[routePath] = modulePath;
  for (const alias of buildRouteAliases(routePath)) {
    if (manifest[alias] && manifest[alias] !== modulePath) {
      console.warn("[hytde] route manifest alias duplicate; overwriting", {
        routePath,
        alias,
        modulePath,
        previous: manifest[alias]
      });
    }
    manifest[alias] = modulePath;
  }
}

function buildRouteAliases(routePath: string): string[] {
  const aliases: string[] = [];
  if (routePath.endsWith("/index.html")) {
    const base = routePath.slice(0, -"/index.html".length);
    aliases.push(base || "/");
  }
  if (routePath.endsWith(".html")) {
    aliases.push(routePath.slice(0, -".html".length));
  }
  const unique = new Set<string>();
  const normalized: string[] = [];
  for (const alias of aliases) {
    const next = normalizeRoutePath(alias);
    if (!next || unique.has(next)) {
      continue;
    }
    unique.add(next);
    normalized.push(next);
  }
  return normalized;
}

function normalizeResolvedId(resolved: unknown): { id: string } | null {
  if (!resolved) {
    return null;
  }
  if (typeof resolved === "string") {
    return { id: resolved };
  }
  if (typeof resolved === "object" && "id" in resolved && typeof resolved.id === "string") {
    return { id: resolved.id };
  }
  return null;
}


function normalizeTemplateHtml(ir: IrDocument): void {
  for (const template of ir.forTemplates) {
    template.templateHtml = compactTemplateHtml(template.templateHtml);
  }
}

function compactTemplateHtml(value: string): string {
  return value.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
}

async function collectHtmlEntries(rootDir: string, inputPaths?: string[]): Promise<string[]> {
  const targets = inputPaths && inputPaths.length > 0 ? inputPaths : ["src"];
  const results: string[] = [];
  for (const target of targets) {
    const resolved = resolve(rootDir, target);
    const statInfo = await statSafe(resolved);
    if (!statInfo) {
      continue;
    }
    if (statInfo.isDirectory()) {
      await walkHtmlEntries(resolved, results);
      continue;
    }
    if (statInfo.isFile() && resolved.endsWith(".html")) {
      results.push(resolved);
    }
  }
  return results;
}

async function collectHtmlOutputs(outDir: string): Promise<string[]> {
  const results: string[] = [];
  const statInfo = await statSafe(outDir);
  if (!statInfo || !statInfo.isDirectory()) {
    return results;
  }
  await walkHtmlOutputs(outDir, results);
  return results;
}

async function walkHtmlEntries(dir: string, results: string[]): Promise<void> {
  const entries = await readDirSafe(dir);
  for (const entry of entries) {
    const nextPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "components" || entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      await walkHtmlEntries(nextPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".html")) {
      results.push(nextPath);
    }
  }
}

async function walkHtmlOutputs(dir: string, results: string[]): Promise<void> {
  const entries = await readDirSafe(dir);
  for (const entry of entries) {
    const nextPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkHtmlOutputs(nextPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".html")) {
      results.push(nextPath);
    }
  }
}

function mergeRollupInput(
  existing: ResolvedConfig["build"]["rollupOptions"]["input"],
  htmlInputs: string[],
  rootDir: string
): ResolvedConfig["build"]["rollupOptions"]["input"] {
  if (!existing) {
    return htmlInputs;
  }
  if (typeof existing === "string") {
    return uniqueInputs([existing, ...htmlInputs]);
  }
  if (Array.isArray(existing)) {
    return uniqueInputs([...existing, ...htmlInputs]);
  }
  const merged = { ...existing };
  const existingValues = new Set(Object.values(existing));
  for (const file of htmlInputs) {
    if (existingValues.has(file)) {
      continue;
    }
    const key = toPosixPath(relative(rootDir, file)).replace(/\.html$/, "");
    if (!(key in merged)) {
      merged[key] = file;
    }
  }
  return merged;
}

function mergeTailwindInput(
  existing: ResolvedConfig["build"]["rollupOptions"]["input"],
  tailwindInput: string
): ResolvedConfig["build"]["rollupOptions"]["input"] {
  if (!existing) {
    return [tailwindInput];
  }
  if (typeof existing === "string") {
    return uniqueInputs([existing, tailwindInput]);
  }
  if (Array.isArray(existing)) {
    return uniqueInputs([...existing, tailwindInput]);
  }
  const merged = { ...existing };
  const values = new Set(Object.values(merged));
  if (!values.has(tailwindInput)) {
    merged.tailwind = tailwindInput;
  }
  return merged;
}

function uniqueInputs(inputs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const input of inputs) {
    if (seen.has(input)) {
      continue;
    }
    seen.add(input);
    result.push(input);
  }
  return result;
}
