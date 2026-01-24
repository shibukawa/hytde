import type { MiddlewareHandler } from "hono";
import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { SlotifiedTemplate, SsrConfig } from "./types.js";
import { renderSsrPage } from "./html-renderer.js";

type TemplateMatch = {
  routePath: string;
  ssrPath: string;
  regex: RegExp;
  paramNames: string[];
};

let templateIndex: TemplateMatch[] | null = null;
let templateIndexRoot: string | null = null;

export function ssrMiddleware(config: SsrConfig = {}): MiddlewareHandler {
  const templateRoot = config.templateRoot ?? process.cwd();
  return async (c, next) => {
    const path = c.req.path;
    if (!shouldHandleHtml(path, c.req.header("accept"))) {
      return next();
    }
    const resolved = await resolveTemplatePath(templateRoot, path);
    if (!resolved) {
      return next();
    }

    let template: SlotifiedTemplate;
    try {
      const payload = await readFile(resolved.templatePath, "utf-8");
      template = JSON.parse(payload) as SlotifiedTemplate;
    } catch {
      return next();
    }

    try {
      const html = await renderSsrPage(template, c.req.raw, config, resolved.params);
      c.header("Content-Type", "text/html; charset=utf-8");
      return c.body(html, 200);
    } catch (error) {
      c.header("Content-Type", "text/html; charset=utf-8");
      return c.body(renderErrorPage(error, config.debug ?? false), 500);
    }
  };
}

function shouldHandleHtml(path: string, accept?: string | null): boolean {
  if (path.endsWith(".html") || path.endsWith(".htm")) {
    return true;
  }
  if (accept && accept.includes("text/html")) {
    return true;
  }
  return false;
}

async function resolveTemplatePath(
  templateRoot: string,
  path: string
): Promise<{ templatePath: string; params: Record<string, string> } | null> {
  const root = resolve(templateRoot);
  const normalized = path === "/" ? "/index.html" : path;
  const withExt = normalized.endsWith(".html") || normalized.endsWith(".htm") ? normalized : `${normalized}.html`;
  const relativePath = withExt.startsWith("/") ? withExt.slice(1) : withExt;
  const full = resolve(root, relativePath);
  if (!full.startsWith(root)) {
    return null;
  }
  const directPath = full.replace(/\.html?$/, ".ssr.json");
  if (await fileExists(directPath)) {
    return { templatePath: directPath, params: {} };
  }
  const templates = await getTemplateIndex(root);
  const requestPath = withExt.startsWith("/") ? withExt : `/${withExt}`;
  for (const template of templates) {
    const match = template.regex.exec(requestPath);
    if (!match) {
      continue;
    }
    const params: Record<string, string> = {};
    template.paramNames.forEach((name, index) => {
      const value = match[index + 1] ?? "";
      params[name] = decodeURIComponent(value);
    });
    return { templatePath: template.ssrPath, params };
  }
  return null;
}

async function getTemplateIndex(templateRoot: string): Promise<TemplateMatch[]> {
  if (templateIndex && templateIndexRoot === templateRoot) {
    return templateIndex;
  }
  const files = await collectSsrTemplates(templateRoot);
  const entries = files.map((filePath) => {
    const relativePath = toPosixPath(relative(templateRoot, filePath));
    const routePath = `/${relativePath.replace(/\.ssr\.json$/, ".html")}`;
    const compiled = compileRoutePattern(routePath);
    return {
      routePath,
      ssrPath: filePath,
      regex: compiled.regex,
      paramNames: compiled.paramNames
    };
  });
  entries.sort((a, b) => {
    if (a.paramNames.length !== b.paramNames.length) {
      return a.paramNames.length - b.paramNames.length;
    }
    return b.routePath.length - a.routePath.length;
  });
  templateIndex = entries;
  templateIndexRoot = templateRoot;
  return entries;
}

async function collectSsrTemplates(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = resolve(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectSsrTemplates(full)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ssr.json")) {
      results.push(full);
    }
  }
  return results;
}

function compileRoutePattern(routePath: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/\\\[([^\]]+)\\\]/g, (_raw, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${regexSource}$`), paramNames };
}

function toPosixPath(value: string): string {
  return value.split("\\\\").join("/");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

function renderErrorPage(error: unknown, debug: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error ? error.stack : null;
  const body = debug && detail ? `<pre>${escapeHtml(detail)}</pre>` : "<p>Internal Server Error</p>";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>SSR Error</title></head><body><h1>SSR Error</h1><p>${escapeHtml(message)}</p>${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
