type FormValue = string | number | boolean | null | File;
export type FormEntry = { name: string; value: FormValue | FormValue[] };
type LogFileValue = {
  filename: string;
  contentType: string;
  size: number;
  content: "(dummy)";
};
type LogFormValue = string | number | boolean | null | LogFileValue;
type LogFormEntry = { name: string; value: LogFormValue | LogFormValue[] };

export function collectFormValues(form: HTMLFormElement): FormEntry[] {
  const controls = Array.from(form.elements).filter(isFormValueControlElement);
  const entries: FormEntry[] = [];

  for (const control of controls) {
    if (control.disabled || !control.name) {
      continue;
    }
    if (control instanceof HTMLInputElement) {
      const type = control.type;
      switch (type) {
        case "submit":
        case "button":
        case "reset":
          continue;
        case "file": {
          const files = Array.from(control.files ?? []);
          if (files.length === 0) {
            continue;
          }
          entries.push({ name: control.name, value: control.multiple ? files : files[0] });
          continue;
        }
        case "checkbox": {
          const hasValue = control.hasAttribute("value");
          if (hasValue) {
            if (!control.checked) {
              continue;
            }
            entries.push({ name: control.name, value: control.value });
          } else {
            entries.push({ name: control.name, value: control.checked });
          }
          continue;
        }
        case "radio":
          if (!control.checked) {
            continue;
          }
          entries.push({ name: control.name, value: control.value });
          continue;
        case "number":
          if (control.value === "") {
            entries.push({ name: control.name, value: null });
          } else if (Number.isNaN(control.valueAsNumber)) {
            entries.push({ name: control.name, value: null });
          } else {
            entries.push({ name: control.name, value: control.valueAsNumber });
          }
          continue;
        default:
          break;
      }
    }

    if (control instanceof HTMLSelectElement && control.multiple) {
      const values = Array.from(control.selectedOptions).map((option) => option.value);
      entries.push({ name: control.name, value: values });
      continue;
    }

    entries.push({ name: control.name, value: control.value });
  }

  return entries;
}

export function collectFormValuesWithoutFiles(form: HTMLFormElement): FormEntry[] {
  const controls = Array.from(form.elements).filter(isFormValueControlElement);
  const entries: FormEntry[] = [];

  for (const control of controls) {
    if (control.disabled || !control.name) {
      continue;
    }
    if (control instanceof HTMLInputElement) {
      const type = control.type;
      switch (type) {
        case "submit":
        case "button":
        case "reset":
          continue;
        case "file":
          continue;
        case "checkbox": {
          const hasValue = control.hasAttribute("value");
          if (hasValue) {
            if (!control.checked) {
              continue;
            }
            entries.push({ name: control.name, value: control.value });
          } else {
            entries.push({ name: control.name, value: control.checked });
          }
          continue;
        }
        case "radio":
          if (!control.checked) {
            continue;
          }
          entries.push({ name: control.name, value: control.value });
          continue;
        case "number":
          if (control.value === "") {
            entries.push({ name: control.name, value: null });
          } else {
            entries.push({ name: control.name, value: control.valueAsNumber });
          }
          continue;
        default:
          break;
      }
    }

    if (control instanceof HTMLSelectElement && control.multiple) {
      const values = Array.from(control.selectedOptions).map((option) => option.value);
      entries.push({ name: control.name, value: values });
      continue;
    }

    entries.push({ name: control.name, value: control.value });
  }

  return entries;
}

function isFormValueControlElement(
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

export function formEntriesToPayload(entries: FormEntry[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const entry of entries) {
    const value = normalizeEntryValue(entry.value);
    if (Object.prototype.hasOwnProperty.call(data, entry.name)) {
      const existing = data[entry.name];
      if (Array.isArray(existing)) {
        data[entry.name] = existing.concat(value);
      } else {
        data[entry.name] = Array.isArray(value) ? [existing as FormValue, ...value] : [existing as FormValue, value];
      }
    } else {
      data[entry.name] = value;
    }
  }
  return data;
}

export function buildUrlSearchParams(entries: FormEntry[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const entry of entries) {
    const value = entry.value;
    if (value == null) {
      params.append(entry.name, "");
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(entry.name, stringifyFormValue(item));
      }
      continue;
    }
    params.append(entry.name, stringifyFormValue(value));
  }
  return params;
}

export function buildFormData(entries: FormEntry[]): FormData {
  const formData = new FormData();
  for (const entry of entries) {
    const value = entry.value;
    if (value == null) {
      formData.append(entry.name, "");
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        formData.append(entry.name, item instanceof File ? item : stringifyFormValue(item));
      }
      continue;
    }
    formData.append(entry.name, value instanceof File ? value : stringifyFormValue(value));
  }
  return formData;
}

function normalizeEntryValue(value: FormValue | FormValue[]): FormValue | FormValue[] {
  if (Array.isArray(value)) {
    return value.map((item) => (item instanceof File ? item.name : item));
  }
  if (value instanceof File) {
    return value.name;
  }
  return value;
}

function stringifyFormValue(value: FormValue): string {
  if (value == null) {
    return "";
  }
  return String(value);
}

export function entryHasFile(value: FormValue | FormValue[]): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => item instanceof File);
  }
  return value instanceof File;
}

export function maskEntriesForLog(entries: FormEntry[]): LogFormEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    value: maskEntryValue(entry.value)
  }));
}

function maskEntryValue(value: FormValue | FormValue[]): LogFormValue | LogFormValue[] {
  if (Array.isArray(value)) {
    return value.map((item) => (item instanceof File ? fileToLogObject(item) : item));
  }
  if (value instanceof File) {
    return fileToLogObject(value);
  }
  return value;
}

function fileToLogObject(file: File): LogFileValue {
  return {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    content: "(dummy)"
  };
}

export function formEntriesToLogPayload(entries: LogFormEntry[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const entry of entries) {
    const value = entry.value;
    if (Object.prototype.hasOwnProperty.call(data, entry.name)) {
      const existing = data[entry.name];
      if (Array.isArray(existing)) {
        data[entry.name] = existing.concat(value);
      } else {
        data[entry.name] = Array.isArray(value)
          ? [existing as LogFormValue, ...value]
          : [existing as LogFormValue, value];
      }
    } else {
      data[entry.name] = value;
    }
  }
  return data;
}
