import { parseHTML } from "linkedom";
import { renderTableHTML } from "@extable/core/ssr";
import type { RuntimeGlobals } from "@hytde/runtime";
import { buildParsedDocumentFromIr, getRuntimeState, renderDocument } from "@hytde/runtime";
import { parseSubtree } from "@hytde/parser";
import type { SlotifiedTemplate, SsrConfig } from "./types.js";
import { buildSsrState, createRequestError } from "./ir-builder.js";
import { executePrefetch } from "./executor.js";
import { executeTransformScript } from "./transform-executor.js";

const SSR_STATE_ID = "hy-ssr-state";

export async function renderSsrPage(template: SlotifiedTemplate, request: Request, config: SsrConfig): Promise<string> {
  const html = assembleTemplateHtml(template);
  const { document, window } = parseHTML(html);
  ensureDomGlobals(window);
  const parsed = buildParsedDocumentFromIr(document, template.ir as unknown as import("@hytde/runtime").IrDocument);
  const ifChainTemplates = captureIfChainTemplates(parsed.ifChains);
  const globals = createRuntimeGlobals();
  const irRecord =
    template.ir && typeof template.ir === "object" ? (template.ir as Record<string, unknown>) : null;
  const transformScript = irRecord?.tr;
  if (typeof transformScript === "string") {
    executeTransformScript(transformScript, globals);
  }
  const parser = {
    parseDocument: () => parsed,
    parseSubtree
  };
  const state = getRuntimeState(document, globals, parsed, parser);
  removeMockMeta(document);
  removeHyCloakForSsr(document);

  const { prefetched, errors } = await executePrefetch(parsed.requestTargets, state, {
    apiBaseUrl: config.apiBaseUrl,
    timeoutMs: config.timeoutMs,
    getAuthHeaders: config.getAuthHeaders,
    request
  });

  const errorEntries = errors.map((message) => createRequestError(message));
  renderDocument(state);
  restoreIfChainTemplates(document, parsed.ifChains, ifChainTemplates);
  renderTables(document, state.globals, parsed.tables);

  const ssrState = buildSsrState({
    prefetched,
    initialState: { ...state.globals.hyState },
    errors: errorEntries
  });

  injectSsrState(document, ssrState);
  return serializeDocument(document);
}

function assembleTemplateHtml(template: SlotifiedTemplate): string {
  if (template.static.length === 0) {
    return "";
  }
  let output = "";
  for (let index = 0; index < template.static.length; index += 1) {
    output += template.static[index];
    if (index < template.slots.length) {
      output += template.slots[index].html;
    }
  }
  return output;
}

function createRuntimeGlobals(): RuntimeGlobals {
  return {
    hy: { loading: false, errors: [] },
    hyState: {},
    hyParams: {}
  };
}

function removeMockMeta(doc: Document): void {
  const mocks = Array.from(doc.querySelectorAll('meta[name=\"hy-mock\"]'));
  for (const meta of mocks) {
    meta.remove();
  }
}

function captureIfChainTemplates(chains: Array<{ nodes: Array<{ node: Element }> }>): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const chain of chains) {
    for (const node of chain.nodes) {
      const element = node.node;
      map.set(element.id, element.cloneNode(true) as Element);
    }
  }
  return map;
}

function restoreIfChainTemplates(
  doc: Document,
  chains: Array<{ anchor: Element; nodes: Array<{ node: Element }> }>,
  templates: Map<string, Element>
): void {
  for (const chain of chains) {
    const anchor = chain.anchor;
    if (!anchor?.parentNode) {
      continue;
    }
    const parent = anchor.parentNode;
    let insertAfter: Node = anchor;
    for (const node of chain.nodes) {
      const existing = node.node;
      if (existing?.isConnected) {
        insertAfter = existing;
        continue;
      }
      const clone = templates.get(node.node.id);
      if (!clone) {
        continue;
      }
      clone.setAttribute("hidden", "hy-ignore");
      if (insertAfter.parentNode !== parent) {
        insertAfter = anchor;
      }
      parent.insertBefore(clone, insertAfter.nextSibling);
      insertAfter = clone;
    }
  }
}

function removeHyCloakForSsr(doc: Document): void {
  const cloaks = Array.from(doc.querySelectorAll("[hy-cloak]"));
  for (const element of cloaks) {
    element.removeAttribute("hy-cloak");
    if (element instanceof HTMLElement) {
      element.style.removeProperty("display");
      if (element.style.length === 0) {
        element.removeAttribute("style");
      }
    }
  }
}

function injectSsrState(doc: Document, state: unknown): void {
  const existing = doc.getElementById(SSR_STATE_ID);
  if (existing) {
    existing.remove();
  }
  const script = doc.createElement("script");
  script.id = SSR_STATE_ID;
  script.type = "application/json";
  script.textContent = serializeJsonForScript(state);
  if (doc.head) {
    doc.head.appendChild(script);
  } else {
    doc.documentElement?.appendChild(script);
  }
  const bootstrap = doc.createElement("script");
  bootstrap.textContent = "window.hy?.initSsr?.();";
  if (doc.head) {
    doc.head.appendChild(bootstrap);
  } else {
    doc.documentElement?.appendChild(bootstrap);
  }
}

function serializeJsonForScript(state: unknown): string {
  return JSON.stringify(state).replace(/</g, "\\u003c");
}

function serializeDocument(doc: Document): string {
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
  const html = doc.documentElement?.outerHTML ?? "";
  return `${doctype}\n${html}`;
}

function renderTables(doc: Document, globals: RuntimeGlobals, tables: Array<{ table: HTMLTableElement; tableId: string; dataPath: string | null; columns: Array<{ key: string; type: "number" | "date" | "boolean" | "string"; header?: string; width?: number; format?: string }> }>): void {
  for (const table of tables) {
    const tableElement = table.table;
    if (!tableElement || tableElement.tagName.toLowerCase() !== "table") {
      continue;
    }
    const data = table.dataPath ? resolvePath(globals.hyState, parseSelectorTokens(table.dataPath)) : null;
    const result = renderTableHTML({
      data: Array.isArray(data) ? data : null,
      schema: { columns: table.columns },
      includeStyles: false,
      wrapWithRoot: false
    });

    const normalized = ensureExtableRendererAttribute(result.html);
    const container = doc.createElement("template");
    container.innerHTML = normalized;
    const rendered = container.content.querySelector("table");
    if (!rendered) {
      continue;
    }
    tableElement.innerHTML = rendered.innerHTML;
    const rendererAttr = rendered.getAttribute("data-extable-renderer");
    if (rendererAttr) {
      tableElement.setAttribute("data-extable-renderer", rendererAttr);
    }
    tableElement.dataset.hyTableId = table.tableId;
  }
}

function resolvePath(value: unknown, tokens: Array<string | number>): unknown {
  let current = value as unknown;
  for (const token of tokens) {
    if (current == null) {
      return null;
    }
    if (typeof token === "number") {
      current = (current as unknown[])[token];
    } else {
      if (token === "last" && Array.isArray(current)) {
        current = current.length > 0 ? current[current.length - 1] : null;
        continue;
      }
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current ?? null;
}

function parseSelectorTokens(selector: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let cursor = 0;
  const length = selector.length;

  const readIdentifier = (): string | null => {
    const match = selector.slice(cursor).match(/^([A-Za-z_$][\\w$]*)/);
    if (!match) {
      return null;
    }
    cursor += match[1].length;
    return match[1];
  };

  const first = readIdentifier();
  if (!first) {
    return tokens;
  }
  tokens.push(first);

  while (cursor < length) {
    const char = selector[cursor];
    if (char === ".") {
      cursor += 1;
      const ident = readIdentifier();
      if (!ident) {
        break;
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

    break;
  }

  return tokens;
}

function ensureExtableRendererAttribute(html: string): string {
  if (html.includes('data-extable-renderer="html"')) {
    return html;
  }
  return html.replace(/<table(\s|>)/i, '<table data-extable-renderer="html"$1');
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
