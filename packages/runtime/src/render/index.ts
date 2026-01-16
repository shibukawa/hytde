import { cleanupRequestTargets } from "./cleanup.js";
import { APPEND_MARK_ATTR, applyHyCloak, clearAppendMarkers, removeDummyNodes } from "./utils.js";
import type {
  ExpressionInput,
  ParsedAttrBinding,
  ParsedFillTarget,
  ParsedForTemplate,
  ParsedIfChain,
  ParsedIfChainNode,
  ParsedSubtree,
  ParsedTextBinding,
  PluginChange
} from "../types.js";
import type { RuntimeState } from "../state.js";
import { emitLog, emitRenderComplete } from "../utils/logging.js";
import { runPluginRender } from "../utils/plugins.js";
import { setupFillActionHandlers } from "../action/actions.js";
import { applyFillTargets } from "../form/form-fill.js";
import { evaluateExpression, interpolateTemplate, resolveUrlTemplate } from "../state/expression.js";
import { NAV_FALLBACK_ATTR } from "../state/constants.js";

export type ScopeStack = Array<Record<string, unknown>>;

export function renderDocument(
  state: RuntimeState,
  changes?: PluginChange[],
  options?: { appendStores?: string[] }
): void {
  const doc = state.doc;
  if (!doc.body) {
    return;
  }
  state.appendStores = options?.appendStores ? new Set(options.appendStores) : null;
  state.appendLogOnlyNew = Boolean(options?.appendStores && options.appendStores.length > 0);
  state.appendMarkedElements.clear();

  state.errorDedup.clear();
  emitLog(state, {
    type: "render",
    message: "render:start",
    timestamp: Date.now()
  });

  renderParsedSubtree(state.parsed, state, [], changes);
  cleanupRequestTargets(state.parsed.requestTargets);

  emitLog(state, {
    type: "render",
    message: "render:complete",
    timestamp: Date.now()
  });
  emitRenderComplete(state);
  const reason = state.pluginsInitialized ? "update" : "init";
  runPluginRender(state, reason, changes);
  state.pluginsInitialized = true;
  applyHyCloak(state);
  clearAppendMarkers(state);
  state.appendStores = null;
  state.appendLogOnlyNew = false;
}

function renderForTemplate(template: ParsedForTemplate, state: RuntimeState, scope: ScopeStack): void {
  if (!template.marker.isConnected) {
    return;
  }
  const markerId = template.marker.getAttribute("id") ?? "";
  const select =
    template.template.tagName === "OPTION" && template.marker.parentNode instanceof HTMLSelectElement
      ? template.marker.parentNode
      : null;
  const selectionSnapshot = select ? captureSelectSelection(select) : null;
  const items = evaluateExpression(template.selectorExpression ?? template.selector, scope, state);
  const appendMode = state.appendStores?.has(template.selector) ?? false;
  const appendCount = Array.isArray(items) ? Math.max(0, items.length - template.rendered.length) : 0;
  const logValue = appendMode ? undefined : items;
  emitLog(state, {
    type: "render",
    message: "for:before",
    detail: appendMode
      ? { selector: template.selector, appended: appendCount }
      : { selector: template.selector, value: logValue },
    timestamp: Date.now()
  });
  if (!Array.isArray(items)) {
    for (const node of template.rendered) {
      node.parentNode?.removeChild(node);
    }
    template.rendered = [];
    emitLog(state, {
      type: "render",
      message: "for:after",
      detail: { selector: template.selector, rendered: 0 },
      timestamp: Date.now()
    });
    if (select && selectionSnapshot) {
      restoreSelectSelection(select, selectionSnapshot);
    }
    return;
  }

  if (appendMode && items.length >= template.rendered.length) {
    let insertAfter: Node = template.rendered[template.rendered.length - 1] ?? template.marker;
    for (let index = template.rendered.length; index < items.length; index += 1) {
      const item = items[index];
      const clone = template.template.cloneNode(true) as Element;
      if (markerId) {
        clone.setAttribute("data-hy-for", markerId);
      }
      clone.setAttribute(APPEND_MARK_ATTR, "true");
      state.appendMarkedElements.add(clone);
      const nextScope = [...scope, { [template.varName]: item }];
      const parsedClone = state.parser.parseSubtree(clone);
      renderParsedSubtree(parsedClone, state, nextScope);

      template.marker.parentNode?.insertBefore(clone, insertAfter.nextSibling);
      template.rendered.push(clone);
      insertAfter = clone;
    }
    emitLog(state, {
      type: "render",
      message: "for:append",
      detail: { selector: template.selector, rendered: template.rendered.length },
      timestamp: Date.now()
    });
    return;
  }

  for (const node of template.rendered) {
    node.parentNode?.removeChild(node);
  }
  template.rendered = [];

  let insertAfter: Node = template.marker;
  for (const item of items) {
    const clone = template.template.cloneNode(true) as Element;
    if (markerId) {
      clone.setAttribute("data-hy-for", markerId);
    }
    const nextScope = [...scope, { [template.varName]: item }];
    const parsedClone = state.parser.parseSubtree(clone);
    renderParsedSubtree(parsedClone, state, nextScope);

    template.marker.parentNode?.insertBefore(clone, insertAfter.nextSibling);
    template.rendered.push(clone);
    insertAfter = clone;
  }
  emitLog(state, {
    type: "render",
    message: "for:after",
    detail: { selector: template.selector, rendered: template.rendered.length },
    timestamp: Date.now()
  });
  if (select && selectionSnapshot) {
    restoreSelectSelection(select, selectionSnapshot);
  }
}

type SelectSelectionSnapshot = { multiple: true; values: string[] } | { multiple: false; value: string };

function captureSelectSelection(select: HTMLSelectElement): SelectSelectionSnapshot {
  if (select.multiple) {
    return {
      multiple: true,
      values: Array.from(select.selectedOptions).map((option) => option.value)
    };
  }
  return { multiple: false, value: select.value };
}

function restoreSelectSelection(select: HTMLSelectElement, snapshot: SelectSelectionSnapshot): void {
  if (snapshot.multiple) {
    const values = new Set(snapshot.values);
    for (const option of Array.from(select.options)) {
      option.selected = values.has(option.value);
    }
    return;
  }
  if (snapshot.value === "") {
    return;
  }
  const exists = Array.from(select.options).some((option) => option.value === snapshot.value);
  if (exists) {
    select.value = snapshot.value;
  }
}

export function buildScopeStack(element: Element, state: RuntimeState): ScopeStack {
  void state;
  const scopes: ScopeStack = [];
  // Loop scopes created via templates are injected during render and not stored on DOM.
  return scopes;
}

function renderParsedSubtree(
  parsed: ParsedSubtree,
  state: RuntimeState,
  scope: ScopeStack,
  changes?: PluginChange[]
): void {
  removeDummyNodes(parsed.dummyElements);

  processIfChains(parsed.ifChains, state, scope);
  for (const template of parsed.forTemplates) {
    if (shouldRenderForTemplate(template, changes)) {
      renderForTemplate(template, state, scope);
    }
  }
  processBindings(parsed, state, scope);
  setupFillActionHandlers(state, parsed.fillActions);
  applyFillTargets(parsed.fillTargets, state, scope);
}

function shouldRenderForTemplate(template: ParsedForTemplate, changes?: PluginChange[]): boolean {
  if (!changes || changes.length === 0) {
    return true;
  }
  if (changes.some((change) => change.type === "dom")) {
    return true;
  }
  return changes.some((change) => {
    if (change.type !== "store") {
      return false;
    }
    if (change.selector === template.selector) {
      return true;
    }
    return template.selector.startsWith(`${change.selector}.`);
  });
}

function processIfChains(chains: ParsedIfChain[], state: RuntimeState, scope: ScopeStack): void {
  for (const chain of chains) {
    const parent = chain.anchor.parentNode;
    if (!parent) {
      continue;
    }

    let kept: ParsedIfChainNode | null = null;
    for (const entry of chain.nodes) {
      let condition = true;
      if (entry.kind === "if" || entry.kind === "else-if") {
        condition = Boolean(evaluateExpression(entry.expression ?? "", scope, state));
      }

      if (!kept && condition) {
        kept = entry;
      }
    }

    for (const entry of chain.nodes) {
      const node = entry.node;
      if (kept && node === kept.node) {
        if (node.parentNode !== parent || node.previousSibling !== chain.anchor) {
          parent.insertBefore(node, chain.anchor.nextSibling);
        }
        if (node.hasAttribute("hidden")) {
          const hidden = node.getAttribute("hidden");
          if (hidden === "" || hidden === "hy-ignore") {
            node.removeAttribute("hidden");
          }
        }
      } else if (node.isConnected) {
        node.remove();
      }
    }
  }
}

function processBindings(parsed: ParsedSubtree, state: RuntimeState, scope: ScopeStack): void {
  for (const binding of parsed.textBindings) {
    const value = evaluateExpression(binding.expression, scope, state);
    if (state.appendLogOnlyNew) {
      const inAppend = hasAppendMarkerAncestor(binding.element);
      if (!inAppend) {
        binding.element.textContent = value == null ? "" : String(value);
        continue;
      }
    }
    binding.element.textContent = value == null ? "" : String(value);
    emitLog(state, {
      type: "render",
      message: "hy:text",
      detail: { expression: expressionLabel(binding.expression), value },
      timestamp: Date.now()
    });
    binding.element.removeAttribute("hy");
  }

  for (const binding of parsed.attrBindings) {
    const shouldUseNav = binding.target === "href" && binding.element instanceof HTMLAnchorElement;
    const interpolated = shouldUseNav
      ? resolveUrlTemplate(binding.template, scope, state, {
        urlEncodeTokens: true,
        context: "nav"
      })
      : interpolateTemplate(binding.template, scope, state, {
        urlEncodeTokens: binding.target === "href"
      });

    if (interpolated.isSingleToken && interpolated.tokenValue == null) {
      binding.element.removeAttribute(binding.target);
    } else {
      binding.element.setAttribute(binding.target, interpolated.value);
    }
    if (shouldUseNav) {
      if (state.pathMeta.mode === "hash" && interpolated.navFallback) {
        binding.element.setAttribute(NAV_FALLBACK_ATTR, interpolated.navFallback);
      } else {
        binding.element.removeAttribute(NAV_FALLBACK_ATTR);
      }
    }
    if (binding.attr.startsWith("hy-")) {
      binding.element.removeAttribute(binding.attr);
    }
  }
}

function hasAppendMarkerAncestor(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute(APPEND_MARK_ATTR)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function expressionLabel(expression: ExpressionInput): string {
  return typeof expression === "string" ? expression : expression.selector;
}
