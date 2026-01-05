import type { RuntimeState } from "../state";

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

  for (const element of elements) {
    if (!element.isConnected) {
      continue;
    }
    if (!(element instanceof HTMLElement)) {
      element.removeAttribute("hy-cloak");
      continue;
    }
    element.style.removeProperty("display");
    if (!element.style.transition) {
      element.style.transition = "opacity 160ms ease";
    }
    element.style.opacity = "0";
    element.removeAttribute("hy-cloak");
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
  const elements = Array.from(state.doc.querySelectorAll(`[${APPEND_MARK_ATTR}]`));
  for (const element of elements) {
    element.removeAttribute(APPEND_MARK_ATTR);
  }
}
