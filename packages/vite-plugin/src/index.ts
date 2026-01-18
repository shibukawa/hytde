import type { Plugin, IndexHtmlTransformContext, ResolvedConfig } from "vite";
import type { OutputAsset, OutputBundle } from "rollup";
import { parseHTML } from "linkedom";
import type { Dirent } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdir, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { parseDocumentToIr, selectImportExports, compactIrDocument, expandIrDocument } from "@hytde/parser";
import type { IrDocument } from "@hytde/parser";

const PARSER_SNAPSHOT_ID = "hy-precompile-parser";
const STANDALONE_IMPORT_PATTERN = /@hytde\/standalone(?:\/[a-z-]+)?/g;
const TAILWIND_VIRTUAL_ID = "virtual:hytde-tailwind.css";
const TAILWIND_RESOLVED_ID = `\0${TAILWIND_VIRTUAL_ID}`;
const TAILWIND_ASSET_NAME = "hytde-tailwind.css";
const TAILWIND_LINK_MARKER = "data-hytde-tailwind";

type MockOption = "default" | true | false;

type HyTdePluginOptions = {
  debug?: boolean;
  mock?: MockOption;
  pathMode?: "hash" | "path";
  manual?: boolean;
  inputPaths?: string[];
  disableSSR?: boolean;
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
      return result.html;
    },
    generateBundle(_options, bundle) {
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
      if (!shouldEmitSsr() || !resolvedConfig) {
        return;
      }
      const outDir = resolve(rootDir, resolvedConfig.build.outDir ?? "dist");
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
  clearTextBindingPlaceholders(doc, ir);
  stripPrototypingArtifacts(doc);
  normalizeSelectAnchors(doc);
  applyTailwindSupport(doc, tailwindSupport);
  const isDebug = resolveRuntimeDebugMode(ctx, options, resolvedConfig);
  applyMockHandling(doc, ir, options, resolvedConfig, isDebug);
  normalizeTemplateHtml(ir);
  applyPathModeHandling(doc, ctx, options);
  injectParserSnapshot(doc, compactIrDocument(ir));
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
  if (hasTailwindCdn(doc)) {
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
