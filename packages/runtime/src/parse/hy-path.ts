import type { HyPathMeta, HyPathMode } from "../state.js";
import { isRelativePath, normalizePathPattern, stripQueryHash } from "../utils/path-pattern.js";

export function parseHyPathMeta(doc: Document): HyPathMeta {
  const template = parseHyPathTemplate(doc);
  const modeMetas = findMetaTags(doc, "hy-path-mode");
  let mode: HyPathMode = "hash";
  modeMetas.forEach((meta) => {
    const content = meta.getAttribute("content") ?? "";
    const parsed = parseHyPathMode(content);
    if (parsed) {
      mode = parsed;
    }
  });

  return { template, mode };
}

export function parseHyPathTemplate(doc: Document): string | null {
  const meta = findMetaTags(doc, "hy-path")[0] ?? null;
  if (!meta) {
    return null;
  }
  const content = meta.getAttribute("content") ?? "";
  if (!content.trim()) {
    return null;
  }
  const parsed = parseMetaContent(content);
  const raw = parsed.template ?? content;
  const template = raw.trim();
  if (!template) {
    return null;
  }
  if (!isRelativePath(template)) {
    return null;
  }
  return normalizePathPattern(stripQueryHash(template));
}

function findMetaTags(doc: Document, name: string): HTMLMetaElement[] {
  const metas = Array.from(doc.getElementsByTagName("meta"));
  return metas.filter((meta) => meta.getAttribute("name") === name);
}

export function parseHyPathMode(content: string): HyPathMode | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "hash" || trimmed === "path") {
    return trimmed;
  }
  const parsed = parseMetaContent(trimmed);
  const mode = parsed.mode?.trim();
  if (mode === "hash" || mode === "path") {
    return mode;
  }
  return null;
}

function parseMetaContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = content.split(";").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    if (!rawKey || rest.length === 0) {
      continue;
    }
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (!key) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
