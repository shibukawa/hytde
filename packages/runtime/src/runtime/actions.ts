import { createHyError, pushError } from "../errors/ui";
import { emitLog } from "./logging";
import { isFormControl } from "./form-controls";
import type { ParsedFillAction, ParsedRequestTarget } from "../types";
import type { RuntimeState } from "../state";

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

function applyFillActionIfNeeded(target: ParsedRequestTarget, state: RuntimeState): void {
  const selectorRaw = target.fillTarget;
  if (selectorRaw === null) {
    return;
  }
  applyFillAction(
    selectorRaw,
    target.form ?? (target.element.closest("form") as HTMLFormElement | null),
    target.element,
    state,
    target.fillValue
  );
}

function applyFillActionFromElement(element: Element, state: RuntimeState): void {
  const data = state.fillActionData.get(element);
  const selectorRaw = data?.selector ?? element.getAttribute("hy-fill");
  if (selectorRaw === null || selectorRaw === undefined) {
    return;
  }
  applyFillAction(
    selectorRaw,
    data?.form ?? (element.closest("form") as HTMLFormElement | null),
    element,
    state,
    data?.value ?? element.getAttribute("hy-value")
  );
}

function applyFillAction(
  selectorRaw: string,
  form: HTMLFormElement | null,
  element: Element,
  state: RuntimeState,
  explicitValue: string | null
): void {
  const selector = selectorRaw.trim();
  if (!selector) {
    emitFillError(state, "hy-fill requires a non-empty selector.", {
      elementId: (element as HTMLElement).id || undefined
    });
    return;
  }
  const root: ParentNode = form ?? element.ownerDocument;
  let matches: Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  try {
    matches = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector));
  } catch (error) {
    emitFillError(state, "hy-fill selector is invalid.", {
      selector,
      formId: form?.id || undefined,
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
  if (matches.length === 0) {
    emitFillError(state, "hy-fill selector did not match any control.", {
      selector,
      formId: form?.id || undefined
    });
    return;
  }
  if (matches.length > 1) {
    emitFillError(state, "hy-fill selector matched multiple controls.", {
      selector,
      formId: form?.id || undefined
    });
    return;
  }
  const control = matches[0];
  if (!isFormControl(control)) {
    emitFillError(state, "hy-fill target is not a form control.", {
      selector,
      formId: form?.id || undefined
    });
    return;
  }
  const value = resolveFillValue(element, explicitValue);
  applyFillValue(control, value);
  emitLog(state, {
    type: "info",
    message: "fill:apply",
    detail: {
      selector,
      value,
      formId: form?.id || undefined,
      targetName: control.name || undefined
    },
    timestamp: Date.now()
  });
  triggerFillCommand(element, state);
}

function resolveFillValue(element: Element, explicitValue: string | null): string {
  if (explicitValue != null) {
    return explicitValue;
  }
  if (element instanceof HTMLInputElement) {
    return element.value ?? "";
  }
  return element.textContent?.trim() ?? "";
}

function applyFillValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string
): void {
  if (control instanceof HTMLInputElement) {
    const type = control.type;
    if (type === "checkbox") {
      control.checked = control.value === value;
      return;
    }
    if (type === "radio") {
      control.checked = control.value === value;
      return;
    }
    control.value = value;
    return;
  }
  if (control instanceof HTMLSelectElement) {
    const options = Array.from(control.options);
    const match = options.find((option) => option.value === value) ?? null;
    if (match) {
      control.value = match.value;
    } else {
      control.value = value;
    }
    return;
  }
  control.value = value;
}

function emitFillError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("syntax", message, detail));
  console.error("[hytde] fill error", message, detail);
}

function getFillSelectorFromElement(element: Element, state: RuntimeState): string | null {
  const data = state.fillActionData.get(element);
  const raw = data?.selector ?? element.getAttribute("hy-fill");
  if (raw === null || raw === undefined) {
    return null;
  }
  const selector = raw.trim();
  if (!selector) {
    return null;
  }
  return selector;
}

function getFillSelectorFromTarget(target: ParsedRequestTarget): string | null {
  const raw = target.fillTarget;
  if (raw === null) {
    return null;
  }
  const selector = raw.trim();
  if (!selector) {
    return null;
  }
  return selector;
}

function triggerFillCommand(element: Element, state: RuntimeState): void {
  const data = state.fillActionData.get(element);
  const command = data?.command ?? element.getAttribute("command");
  const commandFor = data?.commandFor ?? element.getAttribute("commandfor");
  if (!command || !commandFor) {
    return;
  }
  const doc = element.ownerDocument;
  if (!doc) {
    return;
  }
  const root = doc.body ?? doc.documentElement ?? element.parentNode;
  if (!root) {
    return;
  }
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("command", command);
  button.setAttribute("commandfor", commandFor);
  root.appendChild(button);
  button.click();
  button.remove();
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
