import { emitLog } from "../utils/logging";
import { handleRequest } from "../requests/runtime";
import { isFormControl } from "./form-controls";
import type { AutoSubmitState, RuntimeState } from "../state";

export function setupAutoSubmitHandlers(state: RuntimeState): void {
  const configs = state.parsed.autoSubmitForms;
  for (const config of configs) {
    const form = config.form;
    if (state.autoSubmitListeners.has(form)) {
      continue;
    }
    const submitEvents = config.events;
    if (submitEvents.length === 0) {
      continue;
    }

    state.autoSubmitListeners.add(form);
    const autoState = getAutoSubmitState(form, state);

    const handleSubmitEvent = (event: Event) => {
      if (!isFormControl(event.target)) {
        return;
      }
      if (autoState.composing) {
        autoState.pendingComposition = true;
        emitLog(state, {
          type: "info",
          message: "auto-submit:skip",
          detail: { reason: "composition", formId: form.id || undefined },
          timestamp: Date.now()
        });
        return;
      }
      scheduleAutoSubmit(form, state, event.type);
    };

    for (const eventName of submitEvents) {
      form.addEventListener(eventName, handleSubmitEvent);
    }

    form.addEventListener("compositionstart", (event) => {
      if (!isFormControl(event.target)) {
        return;
      }
      autoState.composing = true;
    });

    form.addEventListener("compositionend", (event) => {
      if (!isFormControl(event.target)) {
        return;
      }
      autoState.composing = false;
      if (config.composeMode === "end" && autoState.pendingComposition) {
        autoState.pendingComposition = false;
        scheduleAutoSubmit(form, state, "compositionend");
      }
    });

    form.addEventListener("focusout", (event) => {
      if (!isFormControl(event.target)) {
        return;
      }
      if (config.composeMode === "blur" && autoState.pendingComposition && !autoState.composing) {
        autoState.pendingComposition = false;
        scheduleAutoSubmit(form, state, "compositionblur");
      }
    });
  }
}

function getAutoSubmitState(form: HTMLFormElement, state: RuntimeState): AutoSubmitState {
  const existing = state.autoSubmitState.get(form);
  if (existing) {
    return existing;
  }
  const created: AutoSubmitState = { timer: null, composing: false, pendingComposition: false };
  state.autoSubmitState.set(form, created);
  return created;
}

function scheduleAutoSubmit(form: HTMLFormElement, state: RuntimeState, reason: string): void {
  if (state.inFlightForms.has(form)) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "in-flight", formId: form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }
  if (!form.checkValidity()) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "invalid", formId: form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }
  const target = state.formTargets.get(form) ?? null;
  if (!target) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "no-target", formId: form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }
  const autoState = getAutoSubmitState(form, state);
  const debounceMs = getAutoSubmitDebounce(form, state);
  if (autoState.timer) {
    clearTimeout(autoState.timer);
    emitLog(state, {
      type: "info",
      message: "auto-submit:debounce",
      detail: { reason, formId: form.id || undefined, debounceMs },
      timestamp: Date.now()
    });
  }
  const view = state.doc.defaultView;
  autoState.timer = view ? view.setTimeout(() => {
    autoState.timer = null;
    emitLog(state, {
      type: "info",
      message: "auto-submit:trigger",
      detail: { reason, formId: form.id || undefined },
      timestamp: Date.now()
    });
    void handleRequest(target, state);
  }, debounceMs) : null;
}

function getAutoSubmitDebounce(form: HTMLFormElement, state: RuntimeState): number {
  const config = state.parsed.autoSubmitForms.find((entry) => entry.form === form);
  return config?.debounceMs ?? 200;
}
