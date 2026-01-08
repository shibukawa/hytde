import { emitLog } from "../utils/logging";
import { isFormControl } from "../form/form-controls";
import type { ParsedFillAction, ParsedRequestTarget } from "../types";
import type { RuntimeState } from "../state";
import {
  applyFillActionFromElement,
  applyFillActionIfNeeded,
  getFillSelectorFromElement,
  getFillSelectorFromTarget
} from "./fill-actions";

export function setupActionHandlers(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }

  for (const target of state.parsed.requestTargets) {
    if (target.trigger !== "action") {
      continue;
    }
    const element = target.element;
    if (state.actionListeners.has(element)) {
      continue;
    }
    state.actionListeners.add(element);

    if (element instanceof HTMLButtonElement) {
      element.addEventListener("click", (event) => {
        if (state.actionCommandSkip.has(element)) {
          return;
        }
        const selector = getFillSelectorFromTarget(target);
        if (selector) {
          emitLog(state, {
            type: "info",
            message: "fill:trigger",
            detail: { selector, elementId: element.id || undefined },
            timestamp: Date.now()
          });
        }
        applyFillActionIfNeeded(target, state);
        event.preventDefault();
        event.stopPropagation();
        void state.actionHandlers.handleActionRequest(target, state);
      });

      if (target.method === "GET") {
        element.addEventListener("pointerenter", () => {
          void state.actionHandlers.prefetchActionRequest(target, state);
        });
      }
      continue;
    }

    if (element instanceof HTMLInputElement) {
      element.addEventListener("input", () => {
        scheduleActionRequest(target, state);
      });
      element.addEventListener("change", () => {
        applyFillActionIfNeeded(target, state);
      });
      continue;
    }

    if (element instanceof HTMLTextAreaElement) {
      element.addEventListener("input", () => {
        scheduleActionRequest(target, state);
      });
      element.addEventListener("change", () => {
        applyFillActionIfNeeded(target, state);
      });
      continue;
    }

    if (element instanceof HTMLSelectElement) {
      element.addEventListener("change", () => {
        applyFillActionIfNeeded(target, state);
        if (state.cascade.actionSkip.has(element)) {
          state.cascade.actionSkip.delete(element);
          return;
        }
        scheduleActionRequest(target, state);
      });
    }
  }
}

export function setupFillActionHandlers(state: RuntimeState, actions: ParsedFillAction[]): void {
  for (const action of actions) {
    const element = action.element as HTMLElement;
    if (state.actionListeners.has(element)) {
      continue;
    }
    if (state.fillActionListeners.has(element)) {
      continue;
    }
    state.fillActionListeners.add(element);
    state.fillActionData.set(element, action);
    element.addEventListener("click", (event) => {
      if (state.actionCommandSkip.has(element)) {
        return;
      }
      const selector = getFillSelectorFromElement(element, state);
      emitLog(state, {
        type: "info",
        message: "fill:trigger",
        detail: { selector: selector ?? undefined, elementId: element.id || undefined },
        timestamp: Date.now()
      });
      applyFillActionFromElement(element, state);
      event.preventDefault();
      event.stopPropagation();
    });
  }
}

function scheduleActionRequest(target: ParsedRequestTarget, state: RuntimeState): void {
  const element = target.element;
  const debounceMs = getDebounceMsForElement(element);
  if (!debounceMs) {
    void state.actionHandlers.handleActionRequest(target, state);
    return;
  }
  const view = state.doc.defaultView;
  if (!view) {
    void state.actionHandlers.handleActionRequest(target, state);
    return;
  }
  const existing = state.actionDebounceTimers.get(element);
  if (existing) {
    view.clearTimeout(existing);
  }
  const timer = view.setTimeout(() => {
    state.actionDebounceTimers.delete(element);
    void state.actionHandlers.handleActionRequest(target, state);
  }, debounceMs);
  state.actionDebounceTimers.set(element, timer);
}

function getDebounceMsForElement(element: Element): number | null {
  const raw = element.getAttribute("hy-debounce");
  if (raw === null) {
    return null;
  }
  if (raw.trim() === "") {
    return 200;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 200;
  }
  return parsed;
}
