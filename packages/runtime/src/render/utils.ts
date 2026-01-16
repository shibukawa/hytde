import type { RuntimeState } from "../state.js";

export const APPEND_MARK_ATTR = "data-hy-append";

export function removeDummyNodes(nodes: Element[]): void {
  for (const node of nodes) {
    node.remove();
  }
}

export function applyHyCloak(state: RuntimeState): void {
  if (state.cloakApplied) {
    return;
  }
  const elements = state.parsed.cloakElements;
  if (!elements || elements.length === 0) {
    state.cloakApplied = true;
    return;
  }
  const canAnimate = typeof requestAnimationFrame === "function";

  for (const element of elements) {
    if (!element.isConnected) {
      continue;
    }
    if (!(element instanceof HTMLElement)) {
      element.removeAttribute("hy-cloak");
      continue;
    }
    element.style.removeProperty("display");
    element.removeAttribute("hy-cloak");
    if (!canAnimate) {
      continue;
    }
    if (!element.style.transition) {
      element.style.transition = "opacity 160ms ease";
    }
    element.style.opacity = "0";
    requestAnimationFrame(() => {
      element.style.opacity = "1";
    });
  }

  state.cloakApplied = true;
}

export function clearAppendMarkers(state: RuntimeState): void {
  if (!state.appendLogOnlyNew) {
    return;
  }
  for (const element of state.appendMarkedElements) {
    element.removeAttribute(APPEND_MARK_ATTR);
  }
  state.appendMarkedElements.clear();
}
