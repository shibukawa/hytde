import type { ErrorUiState, RuntimeState } from "../state";
import type { HyError } from "../types";

export function createHyError(type: HyError["type"], message: string, detail?: HyError["detail"]): HyError {
  return {
    type,
    message,
    detail,
    timestamp: Date.now()
  };
}

export function setErrors(state: RuntimeState, errors: HyError[]): void {
  state.globals.hy.errors = errors;
  dispatchErrors(state, errors);
}

export function pushError(state: RuntimeState, error: HyError): void {
  const key = `${error.type}:${error.message}:${JSON.stringify(error.detail ?? {})}`;
  if (state.errorDedup.has(key)) {
    return;
  }
  state.errorDedup.add(key);
  const next = [...state.globals.hy.errors, error];
  state.globals.hy.errors = next;
  dispatchErrors(state, next);
}

function dispatchErrors(state: RuntimeState, errors: HyError[]): void {
  const onError = state.globals.hy.onError;
  if (typeof onError === "function") {
    onError(errors);
    return;
  }

  if (errors.length === 0) {
    if (state.errorUi) {
      updateErrorUi(state.errorUi, errors);
    }
    return;
  }

  const popover = state.parsed.hasErrorPopover ? state.doc.getElementById("hy-error") : null;
  if (errors.length > 0 && popover && "showPopover" in popover && typeof popover.showPopover === "function") {
    popover.showPopover();
    return;
  }

  if (state.parsed.handlesErrors) {
    return;
  }

  const ui = ensureErrorUi(state);
  updateErrorUi(ui, errors);
}

function ensureErrorUi(state: RuntimeState): ErrorUiState {
  if (state.errorUi) {
    return state.errorUi;
  }

  const doc = state.doc;
  const toast = doc.createElement("div");
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "polite");
  toast.style.position = "fixed";
  toast.style.bottom = "1rem";
  toast.style.right = "1rem";
  toast.style.background = "#1f2937";
  toast.style.color = "#f9fafb";
  toast.style.padding = "0.75rem 0.9rem";
  toast.style.borderRadius = "0.75rem";
  toast.style.boxShadow = "0 10px 24px rgba(0,0,0,0.2)";
  toast.style.display = "none";
  toast.style.fontFamily = "system-ui, sans-serif";
  toast.style.fontSize = "0.875rem";
  toast.style.alignItems = "center";
  toast.style.gap = "0.5rem";
  toast.style.cursor = "pointer";
  toast.style.zIndex = "2147483647";

  const toastText = doc.createElement("span");
  toastText.textContent = "Error occurred";
  const toastCount = doc.createElement("span");
  toastCount.style.marginLeft = "0.5rem";
  toastCount.style.fontWeight = "600";

  const toastClose = doc.createElement("button");
  toastClose.type = "button";
  toastClose.textContent = "x";
  toastClose.style.marginLeft = "0.75rem";
  toastClose.style.background = "transparent";
  toastClose.style.border = "none";
  toastClose.style.color = "inherit";
  toastClose.style.cursor = "pointer";
  toastClose.addEventListener("click", (event) => {
    event.stopPropagation();
    toast.style.display = "none";
  });

  toast.append("!", " ", toastText, toastCount, toastClose);

  const dialog = doc.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.style.position = "fixed";
  dialog.style.inset = "0";
  dialog.style.display = "none";
  dialog.style.alignItems = "center";
  dialog.style.justifyContent = "center";
  dialog.style.background = "rgba(15, 23, 42, 0.45)";
  dialog.style.zIndex = "2147483647";

  const panel = doc.createElement("div");
  panel.style.background = "#fff";
  panel.style.borderRadius = "0.75rem";
  panel.style.padding = "1.25rem";
  panel.style.width = "min(640px, 90vw)";
  panel.style.maxHeight = "70vh";
  panel.style.overflow = "auto";
  panel.style.fontFamily = "system-ui, sans-serif";

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.marginBottom = "1rem";

  const title = doc.createElement("h2");
  title.textContent = "HyTDE Errors";
  title.style.fontSize = "1.1rem";
  title.style.fontWeight = "600";
  title.style.margin = "0";

  const controls = doc.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "0.5rem";

  const clearButton = doc.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  clearButton.style.border = "1px solid #e5e7eb";
  clearButton.style.borderRadius = "0.5rem";
  clearButton.style.padding = "0.35rem 0.75rem";
  clearButton.style.background = "#f3f4f6";
  clearButton.style.cursor = "pointer";

  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.style.border = "1px solid #e5e7eb";
  closeButton.style.borderRadius = "0.5rem";
  closeButton.style.padding = "0.35rem 0.75rem";
  closeButton.style.background = "#fff";
  closeButton.style.cursor = "pointer";

  controls.append(clearButton, closeButton);
  header.append(title, controls);

  const list = doc.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "0.75rem";

  panel.append(header, list);
  dialog.append(panel);
  doc.body.append(toast, dialog);

  const ui: ErrorUiState = {
    toast,
    toastCount,
    dialog,
    list,
    clearButton,
    closeButton
  };

  toast.addEventListener("click", () => {
    dialog.style.display = "flex";
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.style.display = "none";
    }
  });
  closeButton.addEventListener("click", () => {
    dialog.style.display = "none";
  });
  clearButton.addEventListener("click", () => {
    setErrors(state, []);
    dialog.style.display = "none";
  });

  state.errorUi = ui;
  return ui;
}

function updateErrorUi(ui: ErrorUiState, errors: HyError[]): void {
  if (errors.length === 0) {
    ui.toast.style.display = "none";
    ui.dialog.style.display = "none";
    return;
  }

  ui.toast.style.display = "flex";
  ui.toastCount.textContent = errors.length > 1 ? `(${errors.length})` : "";

  while (ui.list.firstChild) {
    ui.list.removeChild(ui.list.firstChild);
  }

  for (const error of [...errors].reverse()) {
    const item = ui.list.ownerDocument.createElement("div");
    item.style.border = "1px solid #e5e7eb";
    item.style.borderRadius = "0.5rem";
    item.style.padding = "0.75rem";
    item.style.display = "flex";
    item.style.flexDirection = "column";
    item.style.gap = "0.35rem";

    const title = ui.list.ownerDocument.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = `${error.type}: ${error.message}`;

    const time = ui.list.ownerDocument.createElement("div");
    time.style.fontSize = "0.8rem";
    time.style.opacity = "0.7";
    time.textContent = new Date(error.timestamp).toLocaleString();

    const detail = ui.list.ownerDocument.createElement("div");
    detail.style.fontSize = "0.8rem";
    detail.style.color = "#374151";
    if (error.detail) {
      detail.textContent = Object.entries(error.detail)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(" | ");
    }

    item.append(title, time);
    if (error.detail) {
      item.append(detail);
    }
    ui.list.append(item);
  }
}
