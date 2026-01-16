import type { RuntimeState } from "../state.js";

export function getHistoryForms(state: RuntimeState): HTMLFormElement[] {
  return state.parsed.historyForms.map((entry) => entry.form);
}

export function getHistoryMode(form: HTMLFormElement, state: RuntimeState): "sync" | "sync-push" | "sync-replace" | null {
  return getHistoryConfig(form, state)?.mode ?? null;
}

export function getHistoryParamSource(form: HTMLFormElement, state: RuntimeState): "search" | "hash" {
  return getHistoryConfig(form, state)?.paramsSource ?? "search";
}

export function getHistoryParams(form: HTMLFormElement, state: RuntimeState): URLSearchParams {
  const view = state.doc.defaultView;
  if (!view) {
    return new URLSearchParams();
  }
  const source = getHistoryParamSource(form, state);
  if (source === "hash") {
    return new URLSearchParams(view.location.hash.replace(/^#/, ""));
  }
  return new URLSearchParams(view.location.search.replace(/^\?/, ""));
}

export function getHistoryFieldNames(form: HTMLFormElement, state: RuntimeState): Set<string> | null {
  const names = getHistoryConfig(form, state)?.fieldNames ?? null;
  return names ? new Set(names) : null;
}

export function hasHistoryParams(form: HTMLFormElement, params: URLSearchParams, state: RuntimeState): boolean {
  const fieldNames = getHistoryFieldNames(form, state);
  if (!fieldNames) {
    return params.toString().length > 0;
  }
  for (const name of fieldNames) {
    if (params.has(name)) {
      return true;
    }
  }
  return false;
}

export function applyHistoryParamsToForm(
  form: HTMLFormElement,
  params: URLSearchParams,
  state: RuntimeState
): boolean {
  const controls = getHistoryControls(form, state);
  let hasAny = false;

  for (const control of controls) {
    if (control.disabled || !control.name) {
      continue;
    }
    const values = params.getAll(control.name);
    if (values.length > 0) {
      hasAny = true;
    }
    applyHistoryValueToControl(control, values);
  }

  return hasAny;
}

export function getHistoryControls(
  form: HTMLFormElement,
  state: RuntimeState
): Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> {
  const fieldNames = getHistoryFieldNames(form, state);
  const controls = Array.from(form.elements).filter(isHistoryControlElement);
  if (!fieldNames) {
    return controls;
  }
  return controls.filter((control) => fieldNames.has(control.name));
}

function getHistoryConfig(form: HTMLFormElement, state: RuntimeState) {
  return state.parsed.historyForms.find((entry) => entry.form === form) ?? null;
}

function isHistoryControlElement(
  element: Element
): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (element instanceof HTMLInputElement) {
    return Boolean(element.name);
  }
  if (element instanceof HTMLSelectElement) {
    return Boolean(element.name);
  }
  if (element instanceof HTMLTextAreaElement) {
    return Boolean(element.name);
  }
  return false;
}

export function applyHistoryValueToControl(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  values: string[]
): void {
  if (control instanceof HTMLInputElement) {
    const type = control.type;
    if (type === "file") {
      return;
    }
    if (type === "checkbox") {
      const hasValue = control.hasAttribute("value");
      if (hasValue) {
        control.checked = values.includes(control.value);
      } else {
        const raw = values[0] ?? "";
        control.checked = raw !== "" && raw !== "false" && raw !== "0";
      }
      return;
    }
    if (type === "radio") {
      control.checked = values[0] === control.value;
      return;
    }
  }

  if (control instanceof HTMLSelectElement && control.multiple) {
    const set = new Set(values);
    for (const option of Array.from(control.options)) {
      option.selected = set.has(option.value);
    }
    return;
  }

  control.value = values[0] ?? "";
}
