import {
  applyHistoryParamsToForm,
  getHistoryControls,
  getHistoryForms,
  getHistoryMode,
  getHistoryParamSource,
  getHistoryParams,
  hasHistoryParams
} from "./helpers";
import type { ParsedRequestTarget } from "../types";
import type { RuntimeState } from "../state";
import { emitLog } from "../utils/logging";
import { refreshHyParams } from "../state/globals";
import { handleRequest } from "../requests/runtime";

export function setupHistoryHandlers(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view || state.historyListenerAttached) {
    return;
  }
  state.historyListenerAttached = true;
  view.addEventListener("popstate", () => {
    emitLog(state, {
      type: "info",
      message: "history:pop",
      timestamp: Date.now()
    });
    refreshHyParams(state);
    applyHistoryToForms(state, "popstate");
  });
}

export function hasHistoryAutoSubmit(state: RuntimeState): boolean {
  const forms = getHistoryForms(state);
  for (const form of forms) {
    const mode = getHistoryMode(form);
    if (!mode) {
      continue;
    }
    const params = getHistoryParams(form, state);
    if (hasHistoryParams(form, params)) {
      return true;
    }
  }
  return false;
}

export async function runHistoryAutoSubmits(state: RuntimeState): Promise<void> {
  refreshHyParams(state);
  const forms = getHistoryForms(state);
  const requests: Promise<unknown>[] = [];

  for (const form of forms) {
    const mode = getHistoryMode(form);
    if (!mode) {
      continue;
    }
    const params = getHistoryParams(form, state);
    const applied = applyHistoryParamsToForm(form, params);
    emitLog(state, {
      type: "info",
      message: "history:apply",
      detail: {
        mode,
        source: getHistoryParamSource(form),
        formId: form.id || undefined
      },
      timestamp: Date.now()
    });

    if (applied) {
      const target = state.formTargets.get(form) ?? null;
      if (!target) {
        emitLog(state, {
          type: "info",
          message: "auto-submit:skip",
          detail: { reason: "no-target", formId: form.id || undefined },
          timestamp: Date.now()
        });
        continue;
      }
      emitLog(state, {
        type: "info",
        message: "auto-submit:trigger",
        detail: { reason: "history", formId: form.id || undefined },
        timestamp: Date.now()
      });
      requests.push(handleRequest(target, state));
    }
  }

  await Promise.all(requests);
}

export function applyHistoryToForms(state: RuntimeState, reason: "popstate"): void {
  const forms = getHistoryForms(state);
  for (const form of forms) {
    const mode = getHistoryMode(form);
    if (!mode) {
      continue;
    }
    const params = getHistoryParams(form, state);
    const applied = applyHistoryParamsToForm(form, params);
    emitLog(state, {
      type: "info",
      message: "history:apply",
      detail: {
        mode,
        source: getHistoryParamSource(form),
        reason,
        formId: form.id || undefined
      },
      timestamp: Date.now()
    });
    if (!applied) {
      continue;
    }
    const target = state.formTargets.get(form) ?? null;
    if (!target) {
      emitLog(state, {
        type: "info",
        message: "auto-submit:skip",
        detail: { reason: "no-target", formId: form.id || undefined },
        timestamp: Date.now()
      });
      continue;
    }
    emitLog(state, {
      type: "info",
      message: "auto-submit:trigger",
      detail: { reason: "history", formId: form.id || undefined },
      timestamp: Date.now()
    });
    void handleRequest(target, state);
  }
}

export function maybeUpdateHistoryOnSubmit(target: ParsedRequestTarget, state: RuntimeState): void {
  if (!target.form) {
    return;
  }
  const mode = getHistoryMode(target.form);
  if (!mode || mode === "sync") {
    return;
  }
  if (target.method !== "GET") {
    emitLog(state, {
      type: "info",
      message: "history:skip",
      detail: { reason: "non-get", formId: target.form.id || undefined },
      timestamp: Date.now()
    });
    return;
  }

  updateHistoryFromForm(target.form, mode, state);
}

function updateHistoryFromForm(
  form: HTMLFormElement,
  mode: "sync-push" | "sync-replace",
  state: RuntimeState
): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  const params = buildHistoryParams(form);
  const url = new URL(view.location.href);
  const source = getHistoryParamSource(form);
  const serialized = params.toString();
  if (source === "hash") {
    url.hash = serialized;
  } else {
    url.search = serialized;
  }

  if (mode === "sync-push") {
    view.history.pushState({}, "", url.toString());
    emitLog(state, {
      type: "info",
      message: "history:push",
      detail: { source, url: url.toString(), formId: form.id || undefined },
      timestamp: Date.now()
    });
  } else {
    view.history.replaceState({}, "", url.toString());
    emitLog(state, {
      type: "info",
      message: "history:replace",
      detail: { source, url: url.toString(), formId: form.id || undefined },
      timestamp: Date.now()
    });
  }

  refreshHyParams(state);
}

function buildHistoryParams(form: HTMLFormElement): URLSearchParams {
  const params = new URLSearchParams();
  const controls = getHistoryControls(form);
  for (const control of controls) {
    if (control.disabled || !control.name) {
      continue;
    }
    if (control instanceof HTMLInputElement) {
      const type = control.type;
      if (type === "submit" || type === "button" || type === "reset" || type === "file") {
        continue;
      }
      if (type === "checkbox") {
        const hasValue = control.hasAttribute("value");
        if (hasValue) {
          if (control.checked) {
            params.append(control.name, control.value);
          }
        } else if (control.checked) {
          params.append(control.name, "true");
        }
        continue;
      }
      if (type === "radio") {
        if (control.checked) {
          params.append(control.name, control.value);
        }
        continue;
      }
    }

    if (control instanceof HTMLSelectElement && control.multiple) {
      const values = Array.from(control.selectedOptions).map((option) => option.value).filter(Boolean);
      for (const value of values) {
        params.append(control.name, value);
      }
      continue;
    }

    if (control.value !== "") {
      params.append(control.name, control.value);
    }
  }

  return params;
}
