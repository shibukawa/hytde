import type { IrHtmlMetadata } from "../ir.js";

export function reconcilePreserveElements(current: HTMLElement, incoming: HTMLElement): void {
  const incomingPreserved = collectPreserveMap(incoming);
  if (incomingPreserved.size === 0) {
    return;
  }
  const currentPreserved = collectPreserveMap(current);
  for (const [id, nextElement] of incomingPreserved.entries()) {
    const existing = currentPreserved.get(id);
    if (!existing) {
      continue;
    }
    const placeholder = incoming.querySelector(`#${cssEscape(id)}`);
    if (!placeholder) {
      continue;
    }
    placeholder.replaceWith(existing);
  }
}

export function applyHtmlMetadata(meta?: IrHtmlMetadata): void {
  if (!meta) {
    return;
  }
  if (meta.title) {
    document.title = meta.title;
  }
  if (meta.htmlAttrs) {
    applyElementAttributes(document.documentElement, meta.htmlAttrs);
  }
  if (meta.bodyAttrs) {
    applyElementAttributes(document.body, meta.bodyAttrs);
  }
}

function collectPreserveMap(root: HTMLElement): Map<string, HTMLElement> {
  const elements = Array.from(root.querySelectorAll("[hy-preserve][id]"));
  const map = new Map<string, HTMLElement>();
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (!id) {
      continue;
    }
    map.set(id, element as HTMLElement);
  }
  return map;
}

function applyElementAttributes(element: Element | null, attrs: Record<string, string>): void {
  if (!element) {
    return;
  }
  const nextKeys = new Set(Object.keys(attrs));
  for (const attr of Array.from(element.attributes)) {
    if (!nextKeys.has(attr.name) && attr.name !== "id") {
      element.removeAttribute(attr.name);
    }
  }
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([\"#.;:+*!~'()\[\]\\/])/g, "\\$1");
}
