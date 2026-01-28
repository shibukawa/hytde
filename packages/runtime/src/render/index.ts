import { APPEND_MARK_ATTR, applyHyCloak, clearAppendMarkers, removeDummyNodes } from "./utils.js";
import type {
  ExpressionInput,
  ParsedAttrBinding,
  ParsedFillTarget,
  ParsedForTemplate,
  ParsedIfChain,
  ParsedIfChainNode,
  ParsedHeadBinding,
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
  const itemIdPrefix = markerId ? `${markerId}-item-` : "";
  const select =
    template.template.tagName === "OPTION" && template.marker.parentNode instanceof HTMLSelectElement
      ? template.marker.parentNode
      : null;
  const selectionSnapshot = select ? captureSelectSelection(select) : null;
  if (!template.selectorExpression) {
    return;
  }
  const items = evaluateExpression(template.selectorExpression, scope, state);
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
      if (itemIdPrefix) {
        clone.setAttribute("id", `${itemIdPrefix}${index.toString(36)}`);
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
  let index = 0;
  for (const item of items) {
    const clone = template.template.cloneNode(true) as Element;
    if (itemIdPrefix) {
      clone.setAttribute("id", `${itemIdPrefix}${index.toString(36)}`);
    }
    const nextScope = [...scope, { [template.varName]: item }];
    const parsedClone = state.parser.parseSubtree(clone);
    renderParsedSubtree(parsedClone, state, nextScope);

    template.marker.parentNode?.insertBefore(clone, insertAfter.nextSibling);
    template.rendered.push(clone);
    insertAfter = clone;
    index += 1;
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
  processHeadBindings(parsed.headBindings, state, scope);
  processBindings(parsed, state, scope);
  setupFillActionHandlers(state, parsed.fillActions);
  applyFillTargets(parsed.fillTargets, state, scope);
}

function processHeadBindings(
  bindings: ParsedHeadBinding[],
  state: RuntimeState,
  scope: ScopeStack
): void {
  if (bindings.length === 0) {
    return;
  }

  for (const binding of bindings) {
    const element = binding.element;
    if (state.headBindingFrozen.has(element)) {
      continue;
    }
    if (binding.target === "text") {
      if (!binding.expression) {
        continue;
      }
      const value = evaluateExpression(binding.expression, scope, state);
      if (value == null) {
        warnHeadBindingOnce(binding, state);
        element.remove();
        state.headBindingFrozen.add(element);
        continue;
      }
      element.textContent = String(value);
      state.headBindingFrozen.add(element);
      element.removeAttribute(binding.sourceAttr);
      continue;
    }

    if (!binding.template) {
      continue;
    }
    const interpolated = interpolateTemplate(binding.templateTokens ?? binding.template, scope, state, {
      urlEncodeTokens: false
    });
    if (interpolated.isSingleToken && interpolated.tokenValue == null) {
      warnHeadBindingOnce(binding, state);
      element.remove();
      state.headBindingFrozen.add(element);
      continue;
    }
    const target = binding.attr ?? (binding.kind === "link" ? "href" : "content");
    element.setAttribute(target, interpolated.value);
    state.headBindingFrozen.add(element);
    element.removeAttribute(binding.sourceAttr);
  }
}

function warnHeadBindingOnce(binding: ParsedHeadBinding, state: RuntimeState): void {
  const element = binding.element;
  if (state.headBindingWarned.has(element)) {
    return;
  }
  state.headBindingWarned.add(element);
  console.warn("[hytde] head binding did not resolve; keeping literal.", {
    kind: binding.kind,
    sourceAttr: binding.sourceAttr
  });
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
    const evaluations: Array<{
      kind: ParsedIfChainNode["kind"];
      expression: string | null;
      value: unknown;
      condition: boolean;
      node: string;
    }> = [];
    for (const entry of chain.nodes) {
      let condition = true;
      let value: unknown = null;
      if (entry.kind === "if" || entry.kind === "else-if") {
        if (!entry.expression) {
          condition = false;
        } else {
          value = evaluateExpression(entry.expression, scope, state);
          condition = Boolean(value);
        }
      }
      evaluations.push({
        kind: entry.kind,
        expression: entry.expression ? expressionLabel(entry.expression) : null,
        value,
        condition,
        node: entry.node.tagName.toLowerCase()
      });

      if (!kept && condition) {
        kept = entry;
      }
    }
    const keptIndex = kept ? chain.nodes.indexOf(kept) : -1;
    for (const [index, evaluation] of evaluations.entries()) {
      emitLog(state, {
        type: "render",
        message: "if:eval",
        detail: {
          index,
          keptIndex,
          kept: keptIndex === index,
          kind: evaluation.kind,
          expression: evaluation.expression,
          value: evaluation.value,
          condition: evaluation.condition,
          node: evaluation.node
        },
        timestamp: Date.now()
      });
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
      } else if (node.parentNode) {
        node.parentNode.removeChild(node);
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
  }

  for (const binding of parsed.attrBindings) {
    const shouldUseNav = binding.target === "href" && binding.element instanceof HTMLAnchorElement;
    const interpolated = shouldUseNav
      ? resolveUrlTemplate(binding.template, scope, state, {
        urlEncodeTokens: true,
        context: "nav"
      }, binding.templateTokens)
      : interpolateTemplate(binding.templateTokens ?? binding.template, scope, state, {
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
