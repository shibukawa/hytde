import type { RuntimeState } from "../state";
import type { ParsedFillTarget } from "../types";

export function applyFillTargets(targets: ParsedFillTarget[], state: RuntimeState, scope: Array<Record<string, unknown>>): void {
  if (targets.length === 0) {
    return;
  }
  for (const target of targets) {
    const source = evaluateExpression(target.selector, scope, state);
    if (!source || typeof source !== "object") {
      continue;
    }
    fillForm(target.form, source as Record<string, unknown>);
  }
}

export function fillForm(form: HTMLFormElement, source: Record<string, unknown>): void {
  const controls = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name], select[name], textarea[name]")
  );

  for (const control of controls) {
    const name = control.name;
    if (!name) {
      continue;
    }
    const resolved = resolveFormValue(source, name);
    if (!resolved.found || resolved.value == null) {
      continue;
    }
    applyControlValue(control, resolved.value);
  }
}

export function resolveFormValue(
  source: Record<string, unknown>,
  name: string
): { found: boolean; value: unknown } {
  const tokens = name.split(".").filter(Boolean);
  let current: unknown = source;

  for (const token of tokens) {
    if (!current || typeof current !== "object") {
      return { found: false, value: null };
    }
    if (!Object.prototype.hasOwnProperty.call(current, token)) {
      return { found: false, value: null };
    }
    current = (current as Record<string, unknown>)[token];
  }

  if (current === undefined) {
    return { found: false, value: null };
  }
  return { found: true, value: current };
}

export function applyControlValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: unknown
): void {
  if (control instanceof HTMLInputElement) {
    if (control.type === "file") {
      return;
    }
    if (control.type === "checkbox") {
      if (typeof value === "boolean") {
        control.checked = value;
      } else if (Array.isArray(value)) {
        control.checked = value.map(String).includes(control.value);
      } else {
        control.checked = String(value) === control.value;
      }
      return;
    }
    if (control.type === "radio") {
      control.checked = String(value) === control.value;
      return;
    }
    control.value = String(value);
    return;
  }

  if (control instanceof HTMLSelectElement) {
    if (control.multiple && Array.isArray(value)) {
      const values = value.map(String);
      for (const option of Array.from(control.options)) {
        option.selected = values.includes(option.value);
      }
      return;
    }
    control.value = String(value);
    return;
  }

  control.value = String(value);
}

function evaluateExpression(expression: string, scope: Array<Record<string, unknown>>, state: RuntimeState): unknown {
  void state;
  void expression;
  void scope;
  return null;
}
