import type { Plugin, IndexHtmlTransformContext, ResolvedConfig } from "vite";
import type { OutputAsset, OutputBundle } from "rollup";
import { parseHTML } from "linkedom";
import type { Dirent } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdir, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { parseDocumentToIr, selectImportExports } from "@hytde/parser";
import type { IrDocument } from "@hytde/runtime";

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
  /**
   * Enable Tailwind v4 processing for precompiled output.
   * - `true`: uses a virtual stylesheet with `@import "tailwindcss"`.
   * - `string`: path to a CSS file that imports Tailwind.
   */
  tailwindSupport?: boolean | string;
};

export default function hyTde(options: HyTdePluginOptions = {}): Plugin[] {
  let rootDir = process.cwd();
  let resolvedConfig: ResolvedConfig | null = null;
  let tailwindSupport: Promise<TailwindSupportConfig | null> | null = null;

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
      if (!source.includes("@hytde/standalone") || source.includes("@hytde/standalone/debug-api")) {
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
      return precompileHtml(html, ctx, rootDir, resolveId, options, resolvedConfig, await support);
    },
    configureServer(server) {
      server.middlewares.use(async (req, _res, next) => {
        const url = req.url?.split("?")[0] ?? "";
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

async function precompileHtml(
  html: string,
  ctx: IndexHtmlTransformContext | undefined,
  rootDir: string,
  resolveId: (id: string, importer?: string) => Promise<{ id: string } | null>,
  options: HyTdePluginOptions,
  resolvedConfig: ResolvedConfig | null,
  tailwindSupport: TailwindSupportConfig | null
): Promise<string> {
  const doc = parseHtmlDocument(html);
  const basePath = resolveBasePath(ctx, rootDir);
  await resolveImports(doc, basePath, resolveId, rootDir);
  const ir = parseDocumentToIr(doc);
  stripPrototypingArtifacts(doc);
  normalizeSelectAnchors(doc);
  applyTailwindSupport(doc, tailwindSupport);
  const isDebug = resolveRuntimeDebugMode(ctx, options, resolvedConfig);
  applyMockHandling(doc, ir, options, resolvedConfig, isDebug);
  preparseExpressions(ir);
  normalizeTemplateHtml(ir);
  applyPathModeHandling(doc, ctx, options);
  injectParserSnapshot(doc, ir);
  replaceRuntimeImports(doc, ctx, options, resolvedConfig);
  return serializeDocument(doc);
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
    if (element.tagName.toLowerCase() === "hy-anchor") {
      continue;
    }
    element.removeAttribute("hidden");
  }

  const cloakElements = Array.from(doc.querySelectorAll("[hy-cloak]"));
  for (const element of cloakElements) {
    element.removeAttribute("hy-cloak");
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
  const anchors = Array.from(doc.querySelectorAll("select hy-anchor[data-hy-anchor='for']"));
  for (const anchor of anchors) {
    const parent = anchor.parentElement;
    if (!parent || parent.tagName.toLowerCase() !== "select") {
      continue;
    }
    const option = doc.createElement("option");
    const id = anchor.getAttribute("id");
    if (id) {
      option.setAttribute("id", id);
    }
    option.setAttribute("data-hy-anchor", "for");
    option.setAttribute("hidden", "hy-ignore");
    option.setAttribute("value", "");
    anchor.replaceWith(option);
  }
}

function injectParserSnapshot(doc: Document, ir: IrDocument): void {
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
  resolvedConfig: ResolvedConfig | null
): void {
  const isDebug = resolveRuntimeDebugMode(ctx, options, resolvedConfig);
  const manual = Boolean(options.manual);
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
      resolveStandaloneRuntimeImport(match, isDebug, manual)
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

function resolveStandaloneRuntimeImport(specifier: string, isDebug: boolean, manual: boolean): string {
  if (specifier.endsWith("/debug-api")) {
    return specifier;
  }
  const isNoAuto = manual || specifier.includes("/no-auto");
  if (isNoAuto) {
    return isDebug ? "@hytde/precompile/no-auto-debug" : "@hytde/precompile/no-auto";
  }
  return isDebug ? "@hytde/precompile/debug" : "@hytde/precompile";
}

function replaceStandaloneRuntimeUrl(value: string, isDebug: boolean, manual: boolean): string {
  if (!value.includes("@hytde/standalone") || value.includes("@hytde/standalone/debug-api")) {
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

function serializeDocument(doc: Document): string {
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
  const html = doc.documentElement?.outerHTML ?? "";
  return `${doctype}\n${html}`;
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

function preparseExpressions(ir: IrDocument): void {
  for (const binding of ir.textBindings) {
    const parts = parseExpressionParts(binding.expression);
    if (parts) {
      binding.expressionParts = parts;
    }
  }
  for (const chain of ir.ifChains) {
    for (const node of chain.nodes) {
      if (!node.expression) {
        continue;
      }
      const parts = parseExpressionParts(node.expression);
      if (parts) {
        node.expressionParts = parts;
      }
    }
  }
  for (const template of ir.forTemplates) {
    const parts = parseExpressionParts(template.selector);
    if (parts) {
      template.selectorParts = parts;
    }
  }
}

function parseExpressionParts(expression: string): { selector: string; selectorTokens: Array<string | number>; transforms: Array<{ name: string; args: Array<string | number | boolean | null> }> } | null {
  const parts = expression.split("|>").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const selector = parts[0];
  const parsedSelector = parseSelectorTokensStrict(selector);
  if (parsedSelector.error) {
    return null;
  }
  const transforms = parts.slice(1).map((part) => parseTransformSpec(part));
  return {
    selector,
    selectorTokens: parsedSelector.tokens,
    transforms
  };
}

function parseSelectorTokensStrict(
  selector: string
): { tokens: Array<string | number>; error: string | null } {
  const tokens: Array<string | number> = [];
  if (!selector) {
    return { tokens, error: "Selector is empty." };
  }
  let cursor = 0;
  const length = selector.length;

  const readIdentifier = (): string | null => {
    const match = selector.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
    if (!match) {
      return null;
    }
    cursor += match[1].length;
    return match[1];
  };

  const first = readIdentifier();
  if (!first) {
    return { tokens, error: "Selector must start with an identifier." };
  }
  tokens.push(first);

  while (cursor < length) {
    const char = selector[cursor];
    if (char === ".") {
      cursor += 1;
      const ident = readIdentifier();
      if (!ident) {
        return { tokens, error: "Selector dot segment must be an identifier." };
      }
      tokens.push(ident);
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
        let value = "";
        while (cursor < length) {
          if (selector[cursor] === "\\" && cursor + 1 < length) {
            value += selector[cursor + 1];
            cursor += 2;
            continue;
          }
          if (selector[cursor] === quote) {
            break;
          }
          value += selector[cursor];
          cursor += 1;
        }
        cursor += 1;
        tokens.push(value);
      } else {
        const end = selector.indexOf("]", cursor);
        const raw = selector.slice(cursor, end === -1 ? length : end).trim();
        const num = Number(raw);
        tokens.push(Number.isNaN(num) ? raw : num);
        cursor = end === -1 ? length : end;
      }

      while (cursor < length && selector[cursor] !== "]") {
        cursor += 1;
      }
      cursor += 1;
      continue;
    }

    return { tokens, error: "Selector has invalid token." };
  }

  return { tokens, error: null };
}

function parseTransformSpec(transform: string): { name: string; args: Array<string | number | boolean | null> } {
  const match = transform.match(/^([A-Za-z_$][\w$]*)(?:\((.*)\))?$/);
  if (!match) {
    return { name: transform, args: [] };
  }

  const name = match[1];
  const args = match[2] ? parseLiteralArgs(match[2]) : [];
  return { name, args };
}

function parseLiteralArgs(text: string): Array<string | number | boolean | null> {
  const args: Array<string | number | boolean | null> = [];
  let cursor = 0;

  while (cursor < text.length) {
    while (text[cursor] === " " || text[cursor] === "\n" || text[cursor] === "\t" || text[cursor] === ",") {
      cursor += 1;
    }
    if (cursor >= text.length) {
      break;
    }

    const quote = text[cursor];
    if (quote === "'" || quote === "\"") {
      cursor += 1;
      let value = "";
      while (cursor < text.length) {
        if (text[cursor] === "\\" && cursor + 1 < text.length) {
          value += text[cursor + 1];
          cursor += 2;
          continue;
        }
        if (text[cursor] === quote) {
          break;
        }
        value += text[cursor];
        cursor += 1;
      }
      cursor += 1;
      args.push(value);
      continue;
    }

    const end = findArgEnd(text, cursor);
    const raw = text.slice(cursor, end).trim();
    if (raw === "true") {
      args.push(true);
    } else if (raw === "false") {
      args.push(false);
    } else if (raw === "null") {
      args.push(null);
    } else if (raw) {
      const num = Number(raw);
      args.push(Number.isNaN(num) ? raw : num);
    }
    cursor = end;
  }

  return args;
}

function findArgEnd(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "," || char === ")") {
      break;
    }
    cursor += 1;
  }
  return cursor;
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
