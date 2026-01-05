import type { RuntimeState } from "../state";

export function getHistoryForms(state: RuntimeState): HTMLFormElement[] {
  return Array.from(state.doc.querySelectorAll<HTMLFormElement>("form[hy-history]"));
}

export function getHistoryMode(form: HTMLFormElement): "sync" | "sync-push" | "sync-replace" | null {
  const raw = form.getAttribute("hy-history")?.trim();
  if (!raw) {
    return null;
  }
  if (raw === "sync" || raw === "sync-push" || raw === "sync-replace") {
    return raw;
  }
  if (raw === "push") {
    return "sync-push";
  }
  if (raw === "replace") {
    return "sync-replace";
  }
  return null;
}

export function getHistoryParamSource(form: HTMLFormElement): "search" | "hash" {
  return form.getAttribute("hy-history-params") === "hash" ? "hash" : "search";
}

export function getHistoryParams(form: HTMLFormElement, state: RuntimeState): URLSearchParams {
  const view = state.doc.defaultView;
  if (!view) {
    return new URLSearchParams();
  }
  const source = getHistoryParamSource(form);
  if (source === "hash") {
    return new URLSearchParams(view.location.hash.replace(/^#/, ""));
  }
  return new URLSearchParams(view.location.search.replace(/^\?/, ""));
}

export function getHistoryFieldNames(form: HTMLFormElement): Set<string> | null {
  const raw = form.getAttribute("hy-history-fields");
  if (!raw) {
    return null;
  }
  const names = raw.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

export function hasHistoryParams(form: HTMLFormElement, params: URLSearchParams): boolean {
  const fieldNames = getHistoryFieldNames(form);
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

export function applyHistoryParamsToForm(form: HTMLFormElement, params: URLSearchParams): boolean {
  const controls = getHistoryControls(form);
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
  form: HTMLFormElement
): Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> {
  const fieldNames = getHistoryFieldNames(form);
  const controls = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input[name], select[name], textarea[name]"
    )
  );
  if (!fieldNames) {
    return controls;
  }
  return controls.filter((control) => fieldNames.has(control.name));
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
