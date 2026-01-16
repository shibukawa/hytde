import { collectFormValues, formEntriesToPayload } from "../forms/values.js";
import type { FormEntry } from "../forms/values.js";
import { createHyError, pushError } from "../errors/ui.js";
import { emitLog } from "../utils/logging.js";
import { isFormControl } from "./form-controls.js";
import { fillForm } from "./form-fill.js";
import type { ParsedRequestTarget } from "../types.js";
import type {
  FormDisableSnapshot,
  FormStateContext,
  FormStateDeclaration,
  FormStateMode,
  RuntimeState
} from "../state.js";

const DEFAULT_AUTOSAVE_DELAY_MS = 500;

export function setupFormStateHandlers(state: RuntimeState): void {
  const forms = Array.from(state.doc.forms);
  for (const form of forms) {
    if (state.formStateContexts.has(form)) {
      continue;
    }
    const ownerResult = resolveFormStateOwner(form, state);
    if (!ownerResult) {
      continue;
    }
    let { owner, declaration } = ownerResult;
    let mode: FormStateMode = declaration.mode;
    if (mode === "off") {
      continue;
    }
    if (!formHasSubmitTarget(form, state)) {
      emitFormStateError(state, "hy-form-state requires a form submit request (hy-get/hy-post/etc).", {
        formId: form.id || undefined,
        ownerId: owner.id || undefined
      });
      continue;
    }
    if (hasActionInputRequest(form, state)) {
      emitFormStateError(state, "hy-form-state cannot be used with action-triggered input requests.", {
        formId: form.id || undefined,
        ownerId: owner.id || undefined
      });
      continue;
    }

    let autosaveEnabled = mode === "autosave" || mode === "autosave-guard";
    const ownerId = owner.id?.trim() ? owner.id.trim() : null;
    if (autosaveEnabled && !ownerId) {
      emitFormStateError(state, "hy-form-state autosave requires an id on the owner element.", {
        formId: form.id || undefined
      });
      autosaveEnabled = false;
      if (mode === "autosave-guard") {
        mode = "guard";
      } else if (mode === "autosave") {
        continue;
      }
    }

    if (autosaveEnabled && !getFormStateStorage(state, form)) {
      emitFormStateError(state, "hy-form-state autosave requires localStorage access.", {
        formId: form.id || undefined,
        ownerId: ownerId || undefined
      });
      autosaveEnabled = false;
      if (mode === "autosave-guard") {
        mode = "guard";
      } else if (mode === "autosave") {
        continue;
      }
    }

    const context: FormStateContext = {
      form,
      owner,
      ownerId,
      mode,
      autosaveDelayMs: autosaveEnabled ? declaration.durationMs : 0,
      autosaveEnabled,
      dirty: false,
      hasDraft: false,
      lastCommittedJson: null,
      autosaveTimer: null,
      fileWarningEmitted: false
    };

    state.formStateContexts.set(form, context);
    if (!state.formStateListeners.has(form)) {
      state.formStateListeners.add(form);
      form.addEventListener("input", (event) => handleFormStateInput(event, context, state));
      form.addEventListener("change", (event) => handleFormStateInput(event, context, state));
    }
    initializeFormStateContext(context, state);
  }

  setupFormStateNavigationHandlers(state);
}

export function clearFormStateOnRequest(target: ParsedRequestTarget, state: RuntimeState): void {
  const form = target.form;
  if (!form) {
    return;
  }
  const context = state.formStateContexts.get(form);
  if (!context) {
    return;
  }
  const view = state.doc.defaultView;
  if (context.autosaveTimer && view) {
    view.clearTimeout(context.autosaveTimer);
    context.autosaveTimer = null;
  }
  const snapshot = buildFormStateSnapshot(context, state);
  if (snapshot) {
    context.lastCommittedJson = snapshot.json;
  }
  context.dirty = false;

  if (!context.autosaveEnabled || !context.ownerId) {
    return;
  }
  const storage = getFormStateStorage(state, form);
  if (!storage) {
    return;
  }
  const key = getFormStateStorageKey(context, state);
  storage.removeItem(key);
  context.hasDraft = false;
  emitLog(state, {
    type: "info",
    message: "form-state:clear",
    detail: { key },
    timestamp: Date.now()
  });
}

export function disableFormControls(form: HTMLFormElement, state: RuntimeState): void {
  if (state.formDisableSnapshots.has(form)) {
    return;
  }
  const controls = Array.from(form.elements).filter(isFormDisableControl);
  const snapshot: FormDisableSnapshot = {
    controls: controls.map((element) => ({
      element,
      wasDisabled: (element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement | HTMLFieldSetElement)
        .disabled
    }))
  };
  state.formDisableSnapshots.set(form, snapshot);
  for (const control of controls) {
    if ("disabled" in control) {
      (control as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement | HTMLFieldSetElement).disabled = true;
    }
  }
}

export function restoreFormControls(form: HTMLFormElement, state: RuntimeState): void {
  const snapshot = state.formDisableSnapshots.get(form);
  if (!snapshot) {
    return;
  }
  for (const entry of snapshot.controls) {
    if (!entry.element.isConnected) {
      continue;
    }
    if ("disabled" in entry.element) {
      (entry.element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement | HTMLFieldSetElement).disabled =
        entry.wasDisabled;
    }
  }
  state.formDisableSnapshots.delete(form);
}

export function shouldPromptLeave(state: RuntimeState): boolean {
  for (const context of state.formStateContexts.values()) {
    if ((context.mode === "guard" || context.mode === "autosave-guard") && context.dirty) {
      return true;
    }
  }
  return false;
}

export function getFormStateLeaveMessage(): string {
  return "入力内容が未送信です。移動しますか？";
}

function resolveFormStateOwner(
  form: HTMLFormElement,
  state: RuntimeState
): { owner: HTMLElement; declaration: FormStateDeclaration } | null {
  const candidates = state.parsed.formStateCandidates.filter((candidate) => candidate.form === form);
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length > 1) {
    emitFormStateError(state, "Multiple submit action elements define hy-form-state; choose one owner.", {
      formId: form.id || undefined,
      ownerIds: candidates.map((candidate) => candidate.owner.id).filter(Boolean)
    });
    return null;
  }

  const candidate = candidates[0];
  const owner = candidate.owner;
  const declaration = parseFormStateDeclaration(candidate.raw, owner, state);
  if (!declaration) {
    return null;
  }
  return { owner, declaration };
}

function parseFormStateDeclaration(raw: string, element: Element, state: RuntimeState): FormStateDeclaration | null {
  if (raw.trim() === "") {
    emitFormStateError(state, "hy-form-state requires a declaration string.", {
      elementId: (element as HTMLElement).id || undefined
    });
    return { mode: "off", durationMs: DEFAULT_AUTOSAVE_DELAY_MS, raw };
  }

  let mode: FormStateMode | null = null;
  let durationMs = DEFAULT_AUTOSAVE_DELAY_MS;
  const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);

  for (const part of parts) {
    const splitIndex = part.indexOf(":");
    if (splitIndex === -1) {
      emitFormStateError(state, "hy-form-state entries must be in `key: value` form.", {
        elementId: (element as HTMLElement).id || undefined,
        entry: part
      });
      continue;
    }
    const key = part.slice(0, splitIndex).trim().toLowerCase();
    const value = part.slice(splitIndex + 1).trim();
    if (key === "mode") {
      if (value === "autosave-guard" || value === "autosave" || value === "guard" || value === "off") {
        mode = value;
      } else {
        emitFormStateError(state, "hy-form-state mode must be autosave-guard/autosave/guard/off.", {
          elementId: (element as HTMLElement).id || undefined,
          value
        });
        mode = "off";
      }
      continue;
    }
    if (key === "duration") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        emitFormStateError(state, "hy-form-state duration must be a non-negative number.", {
          elementId: (element as HTMLElement).id || undefined,
          value
        });
      } else {
        durationMs = parsed;
      }
      continue;
    }
    emitFormStateError(state, "hy-form-state contains an unknown key.", {
      elementId: (element as HTMLElement).id || undefined,
      key
    });
  }

  if (!mode) {
    emitFormStateError(state, "hy-form-state requires a mode key.", {
      elementId: (element as HTMLElement).id || undefined
    });
    mode = "off";
  }

  return { mode, durationMs, raw };
}

function formHasSubmitTarget(form: HTMLFormElement, state: RuntimeState): boolean {
  return state.parsed.requestTargets.some((target) => target.trigger === "submit" && target.form === form);
}

function hasActionInputRequest(form: HTMLFormElement, state: RuntimeState): boolean {
  return state.parsed.requestTargets.some(
    (target) =>
      target.trigger === "action" &&
      target.form === form &&
      (target.element instanceof HTMLInputElement ||
        target.element instanceof HTMLSelectElement ||
        target.element instanceof HTMLTextAreaElement)
  );
}

function handleFormStateInput(event: Event, context: FormStateContext, state: RuntimeState): void {
  if (!isFormControl(event.target)) {
    return;
  }
  context.dirty = true;
  scheduleFormStateSnapshot(context, state);
}

function scheduleFormStateSnapshot(context: FormStateContext, state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  if (context.autosaveTimer) {
    view.clearTimeout(context.autosaveTimer);
    context.autosaveTimer = null;
  }
  const delay = context.autosaveEnabled ? context.autosaveDelayMs : 0;
  if (delay === 0) {
    applyFormStateSnapshot(context, state);
    return;
  }
  context.autosaveTimer = view.setTimeout(() => {
    context.autosaveTimer = null;
    applyFormStateSnapshot(context, state);
  }, delay);
}

function applyFormStateSnapshot(context: FormStateContext, state: RuntimeState): void {
  const snapshot = buildFormStateSnapshot(context, state);
  if (!snapshot) {
    return;
  }
  context.dirty = context.lastCommittedJson ? snapshot.json !== context.lastCommittedJson : true;
  if (context.autosaveEnabled) {
    if (!context.ownerId) {
      return;
    }
    const storage = getFormStateStorage(state, context.form);
    if (!storage) {
      return;
    }
    const payload = JSON.stringify({ savedAt: new Date().toISOString(), data: snapshot.data });
    storage.setItem(getFormStateStorageKey(context, state), payload);
    context.hasDraft = true;
    emitLog(state, {
      type: "info",
      message: "form-state:autosave",
      detail: { key: getFormStateStorageKey(context, state), size: payload.length },
      timestamp: Date.now()
    });
  }
}

function buildFormStateSnapshot(
  context: FormStateContext,
  state: RuntimeState
): { data: Record<string, unknown>; json: string } | null {
  const entries = collectFormValues(context.form);
  const filtered: FormEntry[] = [];
  let hasFile = false;
  for (const entry of entries) {
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    const containsFile = values.some((value) => value instanceof File);
    if (containsFile) {
      hasFile = true;
      continue;
    }
    filtered.push(entry);
  }

  if (hasFile && !context.fileWarningEmitted) {
    context.fileWarningEmitted = true;
    emitFormStateError(state, "File inputs are excluded from hy-form-state autosave.", {
      formId: context.form.id || undefined,
      ownerId: context.ownerId || undefined
    });
  }

  const data = formEntriesToPayload(filtered);
  try {
    const json = JSON.stringify(data);
    return { data, json };
  } catch (error) {
    emitFormStateError(state, "Failed to serialize form state for autosave.", {
      formId: context.form.id || undefined
    });
    return null;
  }
}

function initializeFormStateContext(context: FormStateContext, state: RuntimeState): void {
  const initialSnapshot = buildFormStateSnapshot(context, state);
  context.lastCommittedJson = initialSnapshot ? initialSnapshot.json : null;
  context.dirty = false;

  if (!context.autosaveEnabled || !context.ownerId) {
    return;
  }
  const storage = getFormStateStorage(state, context.form);
  if (!storage) {
    return;
  }
  const key = getFormStateStorageKey(context, state);
  const raw = storage.getItem(key);
  if (!raw) {
    return;
  }
  context.hasDraft = true;
  const parsed = safeParseFormStateDraft(raw, context, state);
  if (!parsed) {
    return;
  }
  const label = formatLocalTimestamp(parsed.savedAt);
  const message = `${label} に送信せずに入力された値があります。復元しますか？`;
  const view = state.doc.defaultView;
  const confirmed = view ? view.confirm(message) : false;
  emitLog(state, {
    type: "info",
    message: "form-state:restore",
    detail: { key, accepted: confirmed },
    timestamp: Date.now()
  });
  if (!confirmed) {
    return;
  }
  fillForm(context.form, parsed.data);
  const restoredSnapshot = buildFormStateSnapshot(context, state);
  context.lastCommittedJson = restoredSnapshot ? restoredSnapshot.json : context.lastCommittedJson;
  context.dirty = false;
}

function safeParseFormStateDraft(
  raw: string,
  context: FormStateContext,
  state: RuntimeState
): { savedAt: string; data: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(raw) as { savedAt?: string; data?: unknown };
    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid");
    }
    if (typeof parsed.savedAt !== "string" || !parsed.data || typeof parsed.data !== "object") {
      throw new Error("invalid");
    }
    return { savedAt: parsed.savedAt, data: parsed.data as Record<string, unknown> };
  } catch (error) {
    emitFormStateError(state, "Invalid autosave draft payload.", {
      formId: context.form.id || undefined,
      ownerId: context.ownerId || undefined
    });
    return null;
  }
}

function formatLocalTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "????-??-?? ??:??";
  }
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function getFormStateStorageKey(context: FormStateContext, state: RuntimeState): string {
  const pathname = state.doc.defaultView?.location?.pathname ?? "";
  return `${pathname}:${context.ownerId ?? ""}`;
}

function getFormStateStorage(state: RuntimeState, form: HTMLFormElement): Storage | null {
  try {
    return state.doc.defaultView?.localStorage ?? null;
  } catch (error) {
    emitFormStateError(state, "localStorage access failed for hy-form-state.", {
      formId: form.id || undefined
    });
    return null;
  }
}

function setupFormStateNavigationHandlers(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view || state.formStateNavListenerAttached) {
    return;
  }
  state.formStateNavListenerAttached = true;
  state.doc.addEventListener("click", (event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const anchor = findClosestAnchor(target);
    if (!anchor) {
      return;
    }
    if (anchor.hasAttribute("download")) {
      return;
    }
    if (anchor.target && anchor.target !== "_self") {
      return;
    }
    if (!shouldPromptLeave(state)) {
      return;
    }
    const message = getFormStateLeaveMessage();
    const confirmed = view.confirm(message);
    if (!confirmed) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

function emitFormStateError(state: RuntimeState, message: string, detail?: Record<string, unknown>): void {
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("syntax", message, detail));
  console.error("[hytde] form-state error", message, detail);
}

function isFormDisableControl(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLFieldSetElement
  );
}

function findClosestAnchor(element: Element | null): HTMLAnchorElement | null {
  let current: Element | null = element;
  while (current) {
    if (current instanceof HTMLAnchorElement && current.hasAttribute("href")) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}
