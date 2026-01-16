import type { MiddlewareHandler } from "hono";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SlotifiedTemplate, SsrConfig } from "./types.js";
import { renderSsrPage } from "./html-renderer.js";

export function ssrMiddleware(config: SsrConfig = {}): MiddlewareHandler {
  const templateRoot = config.templateRoot ?? process.cwd();
  return async (c, next) => {
    const path = c.req.path;
    if (!shouldHandleHtml(path, c.req.header("accept"))) {
      return next();
    }
    const templatePath = resolveTemplatePath(templateRoot, path);
    if (!templatePath) {
      return next();
    }

    let template: SlotifiedTemplate;
    try {
      const payload = await readFile(templatePath, "utf-8");
      template = JSON.parse(payload) as SlotifiedTemplate;
    } catch {
      return next();
    }

    try {
      const html = await renderSsrPage(template, c.req.raw, config);
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

function resolveTemplatePath(templateRoot: string, path: string): string | null {
  const normalized = path === "/" ? "/index.html" : path;
  const withExt = normalized.endsWith(".html") || normalized.endsWith(".htm") ? normalized : `${normalized}.html`;
  const relativePath = withExt.startsWith("/") ? withExt.slice(1) : withExt;
  const full = resolve(templateRoot, relativePath);
  if (!full.startsWith(resolve(templateRoot))) {
    return null;
  }
  const ssrPath = full.replace(/\.html?$/, ".ssr.json");
  return ssrPath;
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
