console.log("[demo] main.ts loaded");

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab]"));
const sourceHtml = document.querySelector<HTMLElement>("#source-html");
const sourceHtmlBlocks = document.querySelector<HTMLElement>("#source-html-blocks");
const sourceJson = document.querySelector<HTMLElement>("#source-json");
const sourceJsonBlocks = document.querySelector<HTMLElement>("#source-json-blocks");
const sourceComponent = document.querySelector<HTMLElement>("#source-component");
const sourceComponentBlocks = document.querySelector<HTMLElement>("#source-component-blocks");
const sourceScript = document.querySelector<HTMLElement>("#source-script");
const sourceCdn = document.querySelector<HTMLElement>("#source-cdn");
const transformed = document.querySelector<HTMLElement>("#transformed-html");
const renderOutput = document.querySelector<HTMLElement>("#render-output");
const logPanel = document.querySelector<HTMLElement>("#runtime-log");
const LOG_BUFFER_KEY = "__hytdeLogBuffer";

const activateTab = (name: string) => {
  const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]"));
  if (tabPanels.length > 0) {
    for (const panel of tabPanels) {
      panel.classList.toggle("hidden", panel.dataset.tabPanel !== name);
    }
    for (const button of tabButtons) {
      const active = button.dataset.tab === name;
      button.classList.toggle("tab-active", active);
    }
    return;
  }

  if (!sourceHtmlBlocks || !sourceJsonBlocks) {
    return;
  }
  const showHtml = name === "html";
  const showJson = name === "json";
  const showComponent = name === "component";
  sourceHtmlBlocks.classList.toggle("hidden", !showHtml);
  sourceJsonBlocks.classList.toggle("hidden", !showJson);
  if (sourceComponentBlocks) {
    sourceComponentBlocks.classList.toggle("hidden", !showComponent);
  }

  for (const button of tabButtons) {
    const active = button.dataset.tab === name;
    button.classList.toggle("tab-active", active);
  }
};

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tab ?? "html");
  });
}

const appendLog = (entry: {
  type: string;
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
}) => {
  if (!logPanel) {
    return;
  }

  const line = document.createElement("div");
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const detail = entry.detail ? ` ${JSON.stringify(entry.detail)}` : "";
  line.textContent = `[${time}] ${entry.type}: ${entry.message}${detail}`;

  if (logPanel.firstElementChild?.textContent?.includes("Log entries")) {
    logPanel.innerHTML = "";
  }

  logPanel.append(line);
  while (logPanel.children.length > 120) {
    logPanel.removeChild(logPanel.firstElementChild as ChildNode);
  }
};

if (!window.hy) {
  console.error("[demo] hy runtime not detected yet.");
}

const readSourceText = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return "";
  }
  if (element instanceof HTMLTemplateElement) {
    return element.content.textContent ?? "";
  }
  return element.textContent ?? "";
};

const sourceHtmlRaw = readSourceText("#source-html-template").trim();
const sourceJsonTemplate = document.querySelector<HTMLElement>("#source-json-template");
const sourceJsonRaw = readSourceText("#source-json-template").trim();
const sourceComponentRaw = readSourceText("#source-component-template").trim();
const sourceCdnRaw = readSourceText("#source-cdn-template").trim();

const extractInlineScript = () => {
  const text = readSourceText("#source-inline-script");
  if (!text) {
    return { raw: "", extracted: "" };
  }
  const match = text.match(/\/\/ start-script\s*([\s\S]*?)\s*\/\/ end-script/);
  return {
    raw: text.trim(),
    extracted: match ? dedentByMarker(text, match[1]) : ""
  };
};

const dedentByMarker = (fullText: string, extracted: string) => {
  const markerMatch = fullText.match(/(^[ \t]*)\/\/ start-script/m);
  const indent = markerMatch ? markerMatch[1].length : 0;
  return extracted
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.slice(0, indent).trim() === "" ? line.slice(indent) : line)
    .join("\n")
    .trim();
};


const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const highlightHtml = (raw: string) => {
  let result = "";
  let cursor = 0;
  const stack: Array<{ textClass: string; tagClass: string; isDummy: boolean }> = [];

  while (cursor < raw.length) {
    const start = raw.indexOf("<", cursor);
    if (start === -1) {
      result += highlightText(raw.slice(cursor), stack);
      break;
    }

    result += highlightText(raw.slice(cursor, start), stack);
    const end = findTagEnd(raw, start + 1);
    if (end === -1) {
      result += highlightText(raw.slice(start), stack);
      break;
    }

    const tag = raw.slice(start, end + 1);
    result += highlightTag(tag, stack);
    cursor = end + 1;
  }

  return result;
};

const highlightText = (text: string, stack: Array<{ textClass: string; tagClass: string; isDummy: boolean }>) => {
  if (!text) {
    return "";
  }
  const escaped = escapeHtml(text);
  const current = stack[stack.length - 1];
  if (current?.textClass) {
    return `<span class="${current.textClass}">${escaped}</span>`;
  }
  return escaped;
};

const findTagEnd = (raw: string, start: number) => {
  let inQuote: string | null = null;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inQuote = char;
      continue;
    }
    if (char === ">") {
      return index;
    }
  }
  return -1;
};

const highlightTag = (tag: string, stack: Array<{ textClass: string; tagClass: string; isDummy: boolean }>) => {
  const closing = tag.startsWith("</");
  const selfClosing = tag.endsWith("/>");
  const inner = tag.slice(closing ? 2 : 1, selfClosing ? -2 : -1).trim();
  const parts = inner.match(/^([^\s/]+)([\s\S]*)$/);
  const tagName = parts?.[1] ?? "";
  const attrs = parts?.[2] ?? "";

  const symbolClass = "text-black/80";
  const htmlTagClass = "text-purple-500";
  const htmlAttrClass = "text-cyan-500";
  const htmlValueClass = "text-cyan-400";
  const hyTagClass = "text-fuchsia-500";
  const hyAttrClass = "text-fuchsia-500";
  const hyValueClass = "text-orange-400";
  const dummyClass = "text-gray-400";

  const open = `<span class="${symbolClass}">&lt;${closing ? "/" : ""}</span>`;
  const close = `<span class="${symbolClass}">${selfClosing ? "/" : ""}&gt;</span>`;

  let attrText = "";
  const attrRegex = /([^\s=]+)(?:=("[^"]*"|'[^']*'|[^\s]+))?/g;
  let attrMatch: RegExpExecArray | null;
  const parsedAttrs: Array<{ name: string; value?: string }> = [];
  while ((attrMatch = attrRegex.exec(attrs))) {
    const name = attrMatch[1];
    const value = attrMatch[2];
    if (!name) {
      continue;
    }
    parsedAttrs.push({ name, value });
  }

  const isDummy = parsedAttrs.some((attr) => attr.name === "hy-dummy");
  const isHyTag = tagName.startsWith("hy-");
  const hasHyText = parsedAttrs.some((attr) => attr.name === "hy");

  const tagClass = isDummy
    ? dummyClass
    : tagName.startsWith("hy-")
      ? hyTagClass
      : htmlTagClass;

  const highlightHyValue = (raw: string) => {
    const quote = raw.startsWith("\"") || raw.startsWith("'") ? raw[0] : "";
    const trimmed = quote && raw.endsWith(quote) ? raw.slice(1, -1) : raw;
    const parts = trimmed.split("|>");
    const op = `<span class="${hyAttrClass}">|&gt;</span>`;
    return parts
      .map((part, index) => {
        let text = escapeHtml(part);
        if (index === 0 && quote) {
          text = `${escapeHtml(quote)}${text}`;
        }
        if (index === parts.length - 1 && quote) {
          text = `${text}${escapeHtml(quote)}`;
        }
        return `<span class="${hyValueClass}">${text}</span>`;
      })
      .join(op);
  };

  for (const attr of parsedAttrs) {
    const isHy = isHyTag || attr.name === "hy" || attr.name.startsWith("hy-");
    const nameClass = isDummy ? dummyClass : isHy ? hyAttrClass : htmlAttrClass;
    const valueClass = isDummy ? dummyClass : isHy ? hyValueClass : htmlValueClass;
    attrText += ` <span class="${nameClass}">${escapeHtml(attr.name)}</span>`;
    if (attr.value) {
      const valueHtml = isDummy
        ? `<span class="${valueClass}">${escapeHtml(attr.value)}</span>`
        : isHy
          ? highlightHyValue(attr.value)
          : `<span class="${valueClass}">${escapeHtml(attr.value)}</span>`;
      attrText += `=${valueHtml}`;
    }
  }

  if (closing) {
    const entry = stack.pop();
    const closeClass = entry?.isDummy ? dummyClass : entry?.tagClass ?? tagClass;
    return `${open}<span class="${closeClass}">${escapeHtml(tagName)}</span>${close}`;
  }

  if (!selfClosing) {
    stack.push({
      textClass: isDummy || hasHyText ? dummyClass : "",
      tagClass,
      isDummy
    });
  }

  return `${open}<span class="${tagClass}">${escapeHtml(tagName)}</span>${attrText}${close}`;
};

const highlightJson = (raw: string) => {
  let escaped = escapeHtml(raw);
  escaped = escaped.replace(
    /"(?:\\.|[^"\\])*"(?=\\s*:)/g,
    (match) => `<span class="text-sky-500">${match}</span>`
  );
  escaped = escaped.replace(
    /"(?:\\.|[^"\\])*"/g,
    (match) => `<span class="text-emerald-500">${match}</span>`
  );
  escaped = escaped.replace(
    /\\b(true|false|null)\\b/g,
    (match) => `<span class="text-amber-500">${match}</span>`
  );
  escaped = escaped.replace(
    /-?\\b\\d+(?:\\.\\d+)?\\b/g,
    (match) => `<span class="text-violet-500">${match}</span>`
  );
  return escaped;
};

const formatDom = (container: Element) => {
  const lines: string[] = [];
  for (const node of Array.from(container.childNodes)) {
    const formatted = formatNode(node, 0);
    if (formatted) {
      lines.push(formatted);
    }
  }
  return lines.join("\n").trim();
};

const formatNode = (node: Node, depth: number): string => {
  const indent = "  ".repeat(depth);

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text.trim()) {
      return "";
    }
    return `${indent}${text.trim()}`;
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    return `${indent}<!--${(node as Comment).data}-->`;
  }

  if (!(node instanceof Element)) {
    return "";
  }

  const tagName = node.tagName.toLowerCase();
  const attrString = node
    .getAttributeNames()
    .map((name) => {
      const value = node.getAttribute(name);
      if (value == null || value === "") {
        return name;
      }
      return `${name}="${escapeAttr(value)}"`;
    })
    .join(" ");
  const openTag = `<${tagName}${attrString ? ` ${attrString}` : ""}>`;
  const closeTag = `</${tagName}>`;

  const children = Array.from(node.childNodes).filter((child) => {
    return !(child.nodeType === Node.TEXT_NODE && !(child.textContent ?? "").trim());
  });

  if (children.length === 0) {
    return `${indent}${openTag}${closeTag}`;
  }

  if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
    return `${indent}${openTag}${(children[0].textContent ?? "").trim()}${closeTag}`;
  }

  const nested = children
    .map((child) => formatNode(child, depth + 1))
    .filter(Boolean)
    .join("\n");

  return `${indent}${openTag}\n${nested}\n${indent}${closeTag}`;
};

const dumpTransformed = () => {
  if (!renderOutput || !transformed) {
    return;
  }
  const formatted = formatDom(renderOutput);
  transformed.innerHTML = highlightHtml(formatted || " ");
};

const updatePopoverVisibility = () => {
  const state = (globalThis as {
    hyState?: { suggestions?: { items?: unknown }; notifications?: { items?: unknown } };
  }).hyState;

  const popovers = [
    {
      id: "completion-popover",
      items: state?.suggestions?.items
    },
    {
      id: "notification-popover",
      items: state?.notifications?.items
    }
  ];

  for (const entry of popovers) {
    const popover = document.getElementById(entry.id);
    if (!popover) {
      continue;
    }
    const hasItems = Array.isArray(entry.items) && entry.items.length > 0;
    if (!hasItems) {
      popover.classList.add("hidden");
      continue;
    }
    if (popover.dataset.dismissed === "true") {
      popover.classList.add("hidden");
      continue;
    }
    popover.classList.remove("hidden");
  }
};

const setupPopoverDismissal = () => {
  const anchors = Array.from(
    document.querySelectorAll<HTMLElement>("[data-demo-popover-anchor]")
  );

  const clearDismissed = (popoverId: string) => {
    const popover = document.getElementById(popoverId);
    if (!popover) {
      return;
    }
    delete popover.dataset.dismissed;
    updatePopoverVisibility();
  };

  for (const anchor of anchors) {
    const popoverId = anchor.dataset.demoPopoverAnchor;
    if (!popoverId) {
      continue;
    }
    const handler = () => clearDismissed(popoverId);
    anchor.addEventListener("click", handler);
    anchor.addEventListener("focusin", handler);
    anchor.addEventListener("input", handler);
  }

  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    const popoverIds = new Set(
      anchors.map((anchor) => anchor.dataset.demoPopoverAnchor).filter(Boolean) as string[]
    );
    const insideAnchor = anchors.some((anchor) => anchor.contains(target));
    if (insideAnchor) {
      return;
    }
    for (const popoverId of popoverIds) {
      const popover = document.getElementById(popoverId);
      if (!popover) {
        continue;
      }
      if (popover.contains(target)) {
        return;
      }
    }
    for (const popoverId of popoverIds) {
      const popover = document.getElementById(popoverId);
      if (!popover) {
        continue;
      }
      popover.dataset.dismissed = "true";
      popover.classList.add("hidden");
    }
  });
};

const registerRuntimeHooks = () => {
  const runtimeGlobal = globalThis as typeof globalThis & { hy?: Record<string, unknown> };
  const hy = (runtimeGlobal.hy ?? { loading: false, errors: [] }) as Record<string, unknown>;
  const renderKey = "__hytdeRenderCallbacks";
  const logKey = "__hytdeLogCallbacks";

  if (!Array.isArray(hy[renderKey])) {
    hy[renderKey] = [];
  }
  if (!Array.isArray(hy[logKey])) {
    hy[logKey] = [];
  }

  if (typeof hy.onRenderComplete !== "function") {
    hy.onRenderComplete = (callback: () => void) => {
      (hy[renderKey] as Array<() => void>).push(callback);
    };
  }
  if (typeof hy.onLog !== "function") {
    hy.onLog = (callback: (entry: unknown) => void) => {
      (hy[logKey] as Array<(entry: unknown) => void>).push(callback);
    };
  }

  runtimeGlobal.hy = hy;
};

if (sourceHtml) {
  sourceHtml.innerHTML = highlightHtml(sourceHtmlRaw);
}
if (sourceJson) {
  if (sourceJsonTemplate?.dataset.source === "mock") {
    void loadMockJsonInto(sourceJson);
  } else {
    sourceJson.innerHTML = highlightJson(sourceJsonRaw);
  }
}
if (sourceComponent) {
  sourceComponent.innerHTML = highlightHtml(sourceComponentRaw);
}
const updateSourceScript = () => {
  if (!sourceScript) {
    return;
  }
  const scriptContent = extractInlineScript();
  sourceScript.textContent = scriptContent.extracted;
};
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", updateSourceScript, { once: true });
} else {
  updateSourceScript();
}
if (sourceCdn) {
  sourceCdn.innerHTML = escapeHtml(sourceCdnRaw);
}

void loadJsonSources();

registerRuntimeHooks();
const runtimeGlobal = globalThis as typeof globalThis & {
  hy?: { onRenderComplete?: (cb: () => void) => void; onLog?: (cb: (entry: unknown) => void) => void };
};
runtimeGlobal.hy?.onRenderComplete?.(dumpTransformed);
runtimeGlobal.hy?.onRenderComplete?.(updatePopoverVisibility);
runtimeGlobal.hy?.onLog?.(appendLog);
const bufferedLogs = (runtimeGlobal.hy as Record<string, unknown> | undefined)?.[LOG_BUFFER_KEY];
if (Array.isArray(bufferedLogs)) {
  bufferedLogs.forEach((entry) => appendLog(entry as { type: string; message: string; detail?: Record<string, unknown>; timestamp: number }));
  bufferedLogs.length = 0;
}

appendLog({
  type: "info",
  message: "demo:ready",
  timestamp: Date.now()
});

dumpTransformed();
updatePopoverVisibility();
setupPopoverDismissal();

async function loadMockJsonInto(target: HTMLElement): Promise<void> {
  const mockMetas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="hy-mock"]'));
  if (mockMetas.length === 0) {
    target.innerHTML = highlightJson("{}");
    return;
  }

  const entries = mockMetas.map((meta) => parseMockMeta(meta.content ?? ""));
  const results = await Promise.all(
    entries.map(async (entry, index) => {
      if (!entry?.path) {
        return { key: `mock-${index}`, value: { error: "missing path" } };
      }
      try {
        const response = await fetch(entry.path);
        if (!response.ok) {
          return { key: entry.path, value: { error: `status ${response.status}` } };
        }
        const payload = await response.json();
        return { key: entry.path, value: payload };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { key: entry.path, value: { error: message } };
      }
    })
  );

  const container = target.parentElement ?? target;
  container.innerHTML = "";
  for (const result of results) {
    const block = document.createElement("div");
    block.className = "space-y-2";

    const label = document.createElement("div");
    label.className = "text-[11px] font-semibold uppercase tracking-wide text-base-content/60";
    label.textContent = result.key;
    block.append(label);

    const pre = document.createElement("pre");
    pre.className = target.className;
    pre.innerHTML = highlightJson(JSON.stringify(result.value, null, 2));
    block.append(pre);

    container.append(block);
  }
}

function parseMockMeta(content: string): { path: string | null } | null {
  const tokens = content.split(/\s+/).filter(Boolean);
  let path: string | null = null;
  for (const token of tokens) {
    const [key, rawValue] = token.includes("=") ? token.split("=") : token.split(":");
    if (!key || rawValue == null) {
      continue;
    }
    if (key === "path") {
      path = rawValue.trim();
    }
  }
  return { path };
}

async function loadJsonSources(): Promise<void> {
  const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-json-source]"));
  if (targets.length === 0) {
    return;
  }

  await Promise.all(
    targets.map(async (target) => {
      const source = target.dataset.jsonSource;
      if (!source) {
        return;
      }
      try {
        const response = await fetch(source);
        if (!response.ok) {
          target.innerHTML = highlightJson(JSON.stringify({ error: `status ${response.status}` }, null, 2));
          return;
        }
        const payload = await response.json();
        target.innerHTML = highlightJson(JSON.stringify(payload, null, 2));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        target.innerHTML = highlightJson(JSON.stringify({ error: message }, null, 2));
      }
    })
  );
}
