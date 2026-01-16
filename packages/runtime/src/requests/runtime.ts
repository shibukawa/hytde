import {
  buildFormData,
  buildUrlSearchParams,
  collectFormValues,
  entryHasFile,
  formEntriesToLogPayload,
  formEntriesToPayload,
  maskEntriesForLog
} from "../forms/values.js";
import { createHyError, pushError, setErrors } from "../errors/ui.js";
import { resolvePath } from "../utils/path.js";
import { parseSelectorTokens } from "../utils/selectors.js";
import { cleanupRequestTarget } from "../render/cleanup.js";
import { getStreamKeyCache, resolveStreamKey } from "./stream-cache.js";
import { createStreamGate } from "./stream-gate.js";
import type { StreamGate } from "./stream-gate.js";
import { parseJsonLines } from "./stream-parser.js";
import type { AfterSubmitAction, RuntimeState } from "../state.js";
import type { HyError, HyGlobals, ParsedRequestTarget, PluginChange } from "../types.js";
import { emitLog } from "../utils/logging.js";
import { resolveUrlTemplate, type InterpolationResult, type ScopeStack } from "../state/expression.js";
import { buildScopeStack, renderDocument } from "../render/index.js";
import { applyControlValue, fillForm } from "../form/form-fill.js";
import { handleCascadeStoreUpdate, markCascadeRequestPending } from "../action/cascade.js";
import { maybeRedirectAfterSubmit } from "../action/navigation.js";
import { maybeUpdateHistoryOnSubmit } from "../history/runtime.js";
import { clearFormStateOnRequest, disableFormControls, restoreFormControls } from "../form/form-state.js";
import { emitAsyncUploadError } from "../uploader/async-upload-errors.js";
import { prepareAsyncUploadSubmission, scheduleClearAfterSubmit } from "../uploader/async-upload.js";

export function resolveRequestUrl(target: ParsedRequestTarget, state: RuntimeState): InterpolationResult {
  const scope = buildRequestScope(target, state);
  let template = target.urlTemplate;
  if (
    target.element instanceof HTMLInputElement ||
    target.element instanceof HTMLSelectElement ||
    target.element instanceof HTMLTextAreaElement
  ) {
    const encoded = encodeURIComponent(target.element.value ?? "");
    template = template.replace(/\[value\]/g, encoded);
  }
  return resolveUrlTemplate(template, scope, state, {
    urlEncodeTokens: true,
    context: "request"
  });
}

function buildRequestScope(target: ParsedRequestTarget, state: RuntimeState): ScopeStack {
  const scope = buildScopeStack(target.element, state);
  const element = target.element;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const name = element.name?.trim();
    if (name) {
      const value = element instanceof HTMLInputElement ? readInputValue(element) : element.value;
      scope.push({ [name]: value });
    }
  }
  return scope;
}

export async function handleActionRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<boolean> {
  if (!target.element.isConnected) {
    return false;
  }

  if (target.form && target.element instanceof HTMLButtonElement) {
    clearFormStateOnRequest(target, state);
  }

  if (target.element instanceof HTMLButtonElement && target.method === "GET") {
    const cached = getPrefetchCacheEntry(target, state);
    if (cached) {
      applyRequestPayload(target, cached.payload, state);
      dispatchCommandIfNeeded(target, state);
      emitLog(state, {
        type: "info",
        message: "prefetch:hit",
        detail: { url: resolveRequestUrl(target, state).value },
        timestamp: Date.now()
      });
      return true;
    }
  }

  let previousValue: unknown = null;
  const isOptimisticInput = target.element instanceof HTMLInputElement && target.method !== "GET";
  if (isOptimisticInput) {
    const input = target.element as HTMLInputElement;
    previousValue = getOptimisticInputValue(input, state);
    state.optimisticInputValues.set(input, readInputValue(input));
  }

  const success = await handleRequest(target, state);
  if (!success && isOptimisticInput && target.element instanceof HTMLInputElement) {
    applyControlValue(target.element, previousValue);
    state.optimisticInputValues.set(target.element, previousValue);
    return false;
  }

  if (success) {
    dispatchCommandIfNeeded(target, state);
  }

  return success;
}

function getOptimisticInputValue(input: HTMLInputElement, state: RuntimeState): unknown {
  if (state.optimisticInputValues.has(input)) {
    return state.optimisticInputValues.get(input);
  }
  const initial = readInitialInputValue(input);
  state.optimisticInputValues.set(input, initial);
  return initial;
}

function readInitialInputValue(input: HTMLInputElement): unknown {
  if (input.type === "checkbox") {
    return input.defaultChecked;
  }
  if (input.type === "radio") {
    return input.defaultChecked ? input.value : "";
  }
  return input.defaultValue;
}

function readInputValue(input: HTMLInputElement): unknown {
  if (input.type === "checkbox") {
    return input.checked;
  }
  if (input.type === "radio") {
    return input.checked ? input.value : "";
  }
  return input.value;
}

function dispatchCommandIfNeeded(target: ParsedRequestTarget, state: RuntimeState): void {
  const element = target.element;
  const command = element.getAttribute("command");
  const commandFor = element.getAttribute("commandfor");
  if (!command && !commandFor) {
    return;
  }
  if (!(element instanceof HTMLElement)) {
    return;
  }
  state.actionCommandSkip.add(element);
  try {
    element.click();
  } finally {
    state.actionCommandSkip.delete(element);
  }
}

function applyRequestPayload(
  target: ParsedRequestTarget,
  payload: unknown,
  state: RuntimeState,
  options: { skipRedirect?: boolean } = {}
): void {
  applyStore(target, payload, state);
  if (target.fillIntoForms.length > 0) {
    applyFillInto(target.fillIntoForms, payload, state);
  }
  if (!options.skipRedirect) {
    maybeRedirectAfterSubmit(target, payload, state);
  }
  cleanupRequestTarget(target);
  if (target.store) {
    const cascadedStores = handleCascadeStoreUpdate(target.store, state);
    if (!state.bootstrapPending) {
      const selectors = [target.store, ...cascadedStores];
      const changes: PluginChange[] = selectors.map((selector) => ({ type: "store", selector }));
      renderDocument(state, changes);
    }
  }
}

function getPrefetchCacheEntry(
  target: ParsedRequestTarget,
  state: RuntimeState
): { timestamp: number; payload: unknown } | null {
  const resolved = resolveRequestUrl(target, state);
  const cached = state.actionPrefetchCache.get(resolved.value);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.timestamp > 10_000) {
    state.actionPrefetchCache.delete(resolved.value);
    return null;
  }
  return cached;
}

export async function prefetchActionRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  if (target.method !== "GET") {
    return;
  }
  const resolved = resolveRequestUrl(target, state);
  if (state.actionPrefetchCache.has(resolved.value)) {
    return;
  }
  const existing = state.actionPrefetchInFlight.get(resolved.value);
  if (existing) {
    return;
  }
  const { finalUrl, init } = buildRequestInit(target, resolved.value, state.doc);
  const promise = fetchRequest(finalUrl, init, state)
    .then((response) => {
      if (!response.ok) {
        return;
      }
      state.actionPrefetchCache.set(resolved.value, {
        timestamp: Date.now(),
        payload: response.data
      });
      emitLog(state, {
        type: "info",
        message: "prefetch:store",
        detail: { url: resolved.value },
        timestamp: Date.now()
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      emitLog(state, {
        type: "error",
        message: "prefetch:error",
        detail: { url: resolved.value, method: target.method, error: message },
        timestamp: Date.now()
      });
    })
    .finally(() => {
      state.actionPrefetchInFlight.delete(resolved.value);
    });
  state.actionPrefetchInFlight.set(resolved.value, promise);
  await promise;
}

type RequestOverrideOptions = {
  overridePayload?: Record<string, unknown>;
  overrideUrl?: string;
  skipAsyncGate?: boolean;
};

export async function handleRequest(
  target: ParsedRequestTarget,
  state: RuntimeState,
  options: RequestOverrideOptions = {}
): Promise<boolean> {
  const { element } = target;
  if (!element.isConnected) {
    return false;
  }
  if (target.kind === "stream") {
    await handleStreamRequest(target, state);
    return true;
  }
  if (target.kind === "sse") {
    await handleSseRequest(target, state);
    return true;
  }
  if (target.kind === "polling") {
    await handlePollingRequest(target, state);
    return true;
  }
  if (target.form && state.inFlightForms.has(target.form)) {
    emitLog(state, {
      type: "info",
      message: "auto-submit:skip",
      detail: { reason: "in-flight", formId: target.form.id || undefined },
      timestamp: Date.now()
    });
    return false;
  }

  const isSubmitTarget = target.trigger === "submit" && target.form;
  const session = target.form ? state.asyncUploads.get(target.form) ?? null : null;
  const redirectAttr = isSubmitTarget ? target.redirect : null;
  const afterSubmitAction: AfterSubmitAction = session?.config.afterSubmitAction ?? "keep";
  const afterSubmitActionPresent = session?.config.afterSubmitActionPresent ?? false;
  const redirectConflict = Boolean(session?.config.redirectConflict) || (Boolean(redirectAttr) && afterSubmitActionPresent);
  if (redirectConflict && target.form) {
    emitAsyncUploadError(state, "hy-redirect and hy-after-submit-action cannot be used together.", {
      formId: target.form.id || undefined
    });
  }
  const shouldDisableForRedirect = Boolean(isSubmitTarget && target.form && redirectAttr && !redirectConflict);
  let disabledForRedirect = false;

  let overridePayload = options.overridePayload;
  let overrideUrl = options.overrideUrl;
  if (!options.skipAsyncGate) {
    const gate = await prepareAsyncUploadSubmission(target, state);
    if (gate.blocked) {
      return false;
    }
    if (gate.overridePayload) {
      overridePayload = gate.overridePayload;
    }
    if (gate.overrideUrl) {
      overrideUrl = gate.overrideUrl;
    }
  }

  if (target.form && target.trigger === "submit") {
    clearFormStateOnRequest(target, state);
  }

  const resolvedUrl = resolveRequestUrl(target, state);
  const requestUrl = overrideUrl ?? resolvedUrl.value;

  maybeUpdateHistoryOnSubmit(target, state);

  const { finalUrl, init, logDetail } = buildRequestInit(target, requestUrl, state.doc, overridePayload);

  const method = target.method;
  const dedupeKey = method === "GET" ? finalUrl : null;
  const cached = dedupeKey ? state.requestCache.get(dedupeKey) : null;

  if (cached) {
    if (target.form) {
      state.inFlightForms.add(target.form);
    }
    await cached.promise.finally(() => {
      if (target.form) {
        state.inFlightForms.delete(target.form);
      }
    });
    if (cached.payloadSet) {
      applyRequestPayload(target, cached.payload, state);
    }
    return true;
  }

  if (target.kind === "fetch" && target.store) {
    markCascadeRequestPending(target, state);
  }
  if (shouldDisableForRedirect && target.form) {
    disableFormControls(target.form, state);
    disabledForRedirect = true;
  }

  const requestId = ++state.requestCounter;
  let clearPromise: Promise<void> | null = null;
  emitLog(state, {
    type: "request",
    message: `request:start(${requestId})`,
    detail: {
      url: finalUrl,
      method,
      ...(logDetail ?? {})
    },
    timestamp: Date.now()
  });

  if (target.form) {
    state.inFlightForms.add(target.form);
  }

  let succeeded = false;
  const requestPromise = fetchRequest(finalUrl, init, state)
    .then(async (response) => {
      emitLog(state, {
        type: "request",
        message: `request:complete(${requestId})`,
      detail: { url: finalUrl, method, status: response.status, mocked: response.mocked },
      timestamp: Date.now()
    });
    if (!response.ok) {
      recordError(
          state,
          new Error(`Request failed: ${response.status}`),
          finalUrl,
          method,
          response.status
        );
        return;
      }
      applyRequestPayload(target, response.data, state, { skipRedirect: redirectConflict });
      if (dedupeKey) {
        const entry = state.requestCache.get(dedupeKey);
        if (entry) {
          entry.payload = response.data;
          entry.payloadSet = true;
        }
      }
      if (isSubmitTarget && target.form && !redirectConflict && !redirectAttr && afterSubmitAction === "clear" && session) {
        clearPromise = scheduleClearAfterSubmit(target.form, session, state);
      }
      succeeded = true;
    })
    .catch((error: unknown) => {
      recordError(state, error, finalUrl, method);
    })
    .finally(() => {
      if (target.form) {
        state.inFlightForms.delete(target.form);
      }
      state.pendingRequests = Math.max(0, state.pendingRequests - 1);
      state.globals.hy.loading = state.pendingRequests > 0;
    });

  state.pendingRequests += 1;
  state.globals.hy.loading = true;
  setErrors(state, []);

  if (dedupeKey) {
    state.requestCache.set(dedupeKey, { promise: requestPromise, payload: undefined, payloadSet: false });
  }

  await requestPromise;
  if (!succeeded && disabledForRedirect && target.form) {
    restoreFormControls(target.form, state);
  }
  if (clearPromise) {
    await clearPromise;
  }
  return succeeded;
}

async function handleStreamRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  const { element, urlTemplate } = target;
  const scope = buildScopeStack(element, state);
  const resolvedUrl = resolveUrlTemplate(urlTemplate, scope, state, {
    urlEncodeTokens: true,
    context: "request"
  });
  const { finalUrl, init } = buildRequestInit(target, resolvedUrl.value, state.doc);
  const requestId = ++state.requestCounter;
  const gate = createStreamGate(target);

  emitLog(state, {
    type: "request",
    message: `stream:start(${requestId})`,
    detail: { url: finalUrl, method: target.method },
    timestamp: Date.now()
  });

  state.pendingRequests += 1;
  state.globals.hy.loading = true;
  setErrors(state, []);

  try {
    void consumeStream(finalUrl, init, target, state, gate).catch((error) => {
      recordError(state, error, finalUrl, target.method);
      gate.resolve();
    });
    await gate.promise;
    emitLog(state, {
      type: "request",
      message: `stream:complete(${requestId})`,
      detail: { url: finalUrl, method: target.method },
      timestamp: Date.now()
    });
    cleanupRequestTarget(target);
  } catch (error) {
    recordError(state, error, finalUrl, target.method);
  } finally {
    state.pendingRequests = Math.max(0, state.pendingRequests - 1);
    state.globals.hy.loading = state.pendingRequests > 0;
  }
}

async function handleSseRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  const { element, urlTemplate } = target;
  const scope = buildScopeStack(element, state);
  const resolvedUrl = resolveUrlTemplate(urlTemplate, scope, state, {
    urlEncodeTokens: true,
    context: "request"
  });
  const gate = createStreamGate(target);

  const eventSource = new EventSource(resolvedUrl.value);
  state.sseSources.set(target, eventSource);
  const sseDelayMs = resolveMockStreamDelay(state, "sse");
  let sseDelayOffset = 0;
  let sseReceived = false;
  emitLog(state, {
    type: "request",
    message: "sse:start",
    detail: { url: resolvedUrl.value, method: "GET" },
    timestamp: Date.now()
  });

  eventSource.addEventListener("message", (event) => {
    sseReceived = true;
    const raw = (event as MessageEvent).data;
    const delay = sseDelayMs > 0 ? sseDelayOffset : 0;
    emitLog(state, {
      type: "request",
      message: "sse:receive",
      detail: { url: resolvedUrl.value, store: target.store ?? null, delayMs: delay },
      timestamp: Date.now()
    });
    const handleMessage = () => {
      try {
        const data = JSON.parse(raw);
        emitLog(state, {
          type: "request",
          message: "sse:apply",
          detail: { url: resolvedUrl.value, store: target.store ?? null },
          timestamp: Date.now()
        });
        const appended = appendStreamPayload(target, data, state);
        if (appended) {
          gate.increment();
        }
        if (target.store) {
          if (!state.bootstrapPending) {
            renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
          }
        }
      } catch (error) {
        recordStreamError(state, "SSE message parse error", resolvedUrl.value, "GET");
      }
    };
    if (sseDelayMs > 0) {
      sseDelayOffset += sseDelayMs;
      window.setTimeout(handleMessage, delay);
      return;
    }
    handleMessage();
  });

  eventSource.addEventListener("error", () => {
    if (eventSource.readyState === EventSource.CLOSED || sseReceived) {
      emitLog(state, {
        type: "info",
        message: "sse:close",
        detail: { url: resolvedUrl.value, method: "GET" },
        timestamp: Date.now()
      });
      gate.resolve();
      return;
    }
    recordStreamError(state, "SSE connection error", resolvedUrl.value, "GET");
    gate.resolve();
  });

  await gate.promise;
}

async function handlePollingRequest(target: ParsedRequestTarget, state: RuntimeState): Promise<void> {
  const { element, urlTemplate } = target;
  if (!element.isConnected) {
    return;
  }
  const scope = buildScopeStack(element, state);
  const resolvedUrl = resolveUrlTemplate(urlTemplate, scope, state, {
    urlEncodeTokens: true,
    context: "request"
  });
  const { finalUrl, init } = buildRequestInit(target, resolvedUrl.value, state.doc);
  const intervalMs = Math.max(200, target.pollIntervalMs ?? 1000);

  const tick = async () => {
    if (!element.isConnected) {
      return;
    }
    await runPollingOnce(finalUrl, init, target, state);
  };

  await tick();
  const timer = window.setInterval(() => {
    void tick();
  }, intervalMs);
  state.pollingTimers.set(target, timer);
}

async function consumeStream(
  url: string,
  init: RequestInit,
  target: ParsedRequestTarget,
  state: RuntimeState,
  gate: StreamGate
): Promise<void> {
  const response = await fetch(url, init);
  emitLog(state, {
    type: "request",
    message: "stream:response",
    detail: { url, status: response.status, ok: response.ok, hasBody: Boolean(response.body) },
    timestamp: Date.now()
  });
  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.status}`);
  }
  const streamDelayMs = resolveMockStreamDelay(state, "stream");

  if (!response.body) {
    const payload = await safeJson(response);
    emitLog(state, {
      type: "request",
      message: "stream:receive",
      detail: { url, store: target.store ?? null, delayMs: streamDelayMs },
      timestamp: Date.now()
    });
    if (streamDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, streamDelayMs));
    }
    emitLog(state, {
      type: "request",
      message: "stream:apply",
      detail: { url, store: target.store ?? null },
      timestamp: Date.now()
    });
    appendStreamPayload(target, payload, state);
    gate.increment();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    emitLog(state, {
      type: "request",
      message: "stream:chunk",
      detail: { url, done, bytes: value ? value.byteLength : 0 },
      timestamp: Date.now()
    });
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseJsonLines(buffer);
    buffer = parsed.rest;
    for (const item of parsed.items) {
      emitLog(state, {
        type: "request",
        message: "stream:receive",
        detail: { url, store: target.store ?? null, delayMs: streamDelayMs },
        timestamp: Date.now()
      });
      if (streamDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, streamDelayMs));
      }
      emitLog(state, {
        type: "request",
        message: "stream:apply",
        detail: { url, store: target.store ?? null },
        timestamp: Date.now()
      });
      const appended = appendStreamPayload(target, item, state);
      if (appended) {
        gate.increment();
      }
      if (target.store) {
        if (!state.bootstrapPending) {
          renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
        }
      }
    }
  }

  buffer += decoder.decode();
  const remaining = buffer.trim();
  if (remaining) {
    try {
      const item = JSON.parse(remaining);
      emitLog(state, {
        type: "request",
        message: "stream:receive",
        detail: { url, store: target.store ?? null, delayMs: streamDelayMs },
        timestamp: Date.now()
      });
      if (streamDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, streamDelayMs));
      }
      emitLog(state, {
        type: "request",
        message: "stream:apply",
        detail: { url, store: target.store ?? null },
        timestamp: Date.now()
      });
      const appended = appendStreamPayload(target, item, state);
      if (appended) {
        gate.increment();
      }
      if (target.store && !state.bootstrapPending) {
        renderDocument(state, [{ type: "store", selector: target.store }], { appendStores: [target.store] });
      }
    } catch (error) {
      throw new Error("Stream chunk parsing failed.");
    }
  }

  gate.resolve();
}

function appendStreamPayload(target: ParsedRequestTarget, payload: unknown, state: RuntimeState): boolean {
  const unwrap = target.unwrap ? resolvePath(payload, parseSelectorTokens(target.unwrap)) : payload;
  const store = target.store;
  if (!store) {
    return false;
  }
  if (Array.isArray(unwrap)) {
    let appended = false;
    for (const item of unwrap) {
      appended = appendStoreItem(store, item, state, target.streamKey) || appended;
    }
    return appended;
  }
  return appendStoreItem(store, unwrap, state, target.streamKey);
}

function appendStoreItem(store: string, item: unknown, state: RuntimeState, keySelector: string | null): boolean {
  if (keySelector) {
    const key = resolveStreamKey(item, keySelector);
    if (key != null) {
      const cache = getStreamKeyCache(store, state, keySelector);
      if (cache.has(key)) {
        return false;
      }
      cache.add(key);
    }
  }
  const existing = state.globals.hyState[store];
  const next = Array.isArray(existing) ? [...existing, item] : [item];
  state.globals.hyState[store] = next;
  return true;
}

function resolveMockStreamDelay(state: RuntimeState, kind: "stream" | "sse"): number {
  const globals = state.globals.hy as HyGlobals & {
    mockStreamDelayMs?: number;
    mockSseDelayMs?: number;
  };
  const raw = kind === "stream" ? globals.mockStreamDelayMs : globals.mockSseDelayMs;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return raw;
}

async function runPollingOnce(
  url: string,
  init: RequestInit,
  target: ParsedRequestTarget,
  state: RuntimeState
): Promise<void> {
  try {
    state.pendingRequests += 1;
    state.globals.hy.loading = true;
    const response = await fetch(url, init);
    if (response.status === 204) {
      return;
    }
    const payload = await safeJson(response);
    if (payload == null) {
      return;
    }
    applyPollingStore(target, payload, state);
  } catch (error) {
    recordError(state, error, url, init.method ?? "GET");
  } finally {
    state.pendingRequests = Math.max(0, state.pendingRequests - 1);
    state.globals.hy.loading = state.pendingRequests > 0;
  }
}

function applyPollingStore(target: ParsedRequestTarget, payload: unknown, state: RuntimeState): void {
  const unwrap = target.unwrap ? resolvePath(payload, parseSelectorTokens(target.unwrap)) : payload;
  if (unwrap == null) {
    return;
  }
  const store = target.store;
  if (!store) {
    return;
  }
  state.globals.hyState[store] = unwrap;
  if (!state.bootstrapPending) {
    const cascadedStores = handleCascadeStoreUpdate(store, state);
    const selectors = [store, ...cascadedStores];
    const changes: PluginChange[] = selectors.map((selector) => ({ type: "store", selector }));
    renderDocument(state, changes);
  }
}

function buildRequestInit(
  target: ParsedRequestTarget,
  resolvedUrl: string,
  doc: Document,
  overridePayload?: Record<string, unknown>
): { finalUrl: string; init: RequestInit; logDetail?: Record<string, unknown> } {
  let finalUrl = resolvedUrl;
  const init: RequestInit = { method: target.method };
  let payload: Record<string, unknown> | undefined;
  let encoding: string | undefined;
  const form = target.form;
  let logDetail: Record<string, unknown> | undefined;

  if (form) {
    if (target.method === "GET") {
      finalUrl = appendFormParams(resolvedUrl, form, doc);
    } else if (overridePayload) {
      encoding = "application/json";
      payload = overridePayload;
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(payload);
    } else {
      const entries = collectFormValues(form);
      const hasFile = entries.some((entry) => entryHasFile(entry.value));
      const hasEnctype = form.hasAttribute("enctype");
      const enctype = form.enctype;

      if (hasFile && enctype !== "multipart/form-data") {
        encoding = "multipart/form-data";
        payload = formEntriesToLogPayload(maskEntriesForLog(entries));
        init.body = buildFormData(entries);
      } else if (hasEnctype && enctype === "application/x-www-form-urlencoded") {
        encoding = "application/x-www-form-urlencoded";
        init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
        payload = formEntriesToPayload(entries);
        init.body = buildUrlSearchParams(entries).toString();
      } else if (hasEnctype && enctype === "multipart/form-data") {
        encoding = "multipart/form-data";
        payload = formEntriesToLogPayload(maskEntriesForLog(entries));
        init.body = buildFormData(entries);
      } else if (hasEnctype) {
        encoding = enctype;
        init.headers = { "Content-Type": enctype };
        payload = formEntriesToPayload(entries);
        init.body = JSON.stringify(payload);
      } else {
        encoding = "application/json";
        payload = formEntriesToPayload(entries);
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(payload);
      }

    }
    if (target.method !== "GET") {
      logDetail = {
        contentType: (init.headers as Record<string, string> | undefined)?.["Content-Type"] ?? encoding,
        payload: payload ?? {}
      };
    }
  }

  return { finalUrl, init, logDetail };
}

function appendFormParams(urlString: string, form: HTMLFormElement, doc: Document): string {
  const fallbackBase = doc.defaultView?.location?.href ?? "";
  const url = new URL(urlString, doc.baseURI ?? fallbackBase);
  const formData = new FormData(form);
  formData.forEach((value, key) => {
    if (typeof value === "string") {
      url.searchParams.append(key, value);
    }
  });

  return url.toString();
}

interface FetchResult {
  data: unknown;
  status: number;
  mocked: boolean;
  ok: boolean;
}

async function fetchRequest(url: string, init: RequestInit, state: RuntimeState): Promise<FetchResult> {
  const method = (init.method ?? "GET").toUpperCase();
  const response = await fetch(url, init);
  return {
    data: await safeJson(response),
    status: response.status,
    mocked: false,
    ok: response.ok
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function applyStore(target: ParsedRequestTarget, response: unknown, state: RuntimeState): unknown {
  const unwrap = target.unwrap;
  const payload = unwrap ? resolvePath(response, parseSelectorTokens(unwrap)) : response;
  const store = target.store;
  if (store) {
    state.globals.hyState[store] = payload;
  }
  return payload;
}

function applyFillInto(forms: HTMLFormElement[], payload: unknown, state: RuntimeState): void {
  if (!payload || typeof payload !== "object") {
    return;
  }
  for (const form of forms) {
    fillForm(form, payload as Record<string, unknown>);
  }
}

function recordError(state: RuntimeState, error: unknown, url: string, method: string, status?: number): void {
  const message = error instanceof Error ? error.message : String(error);
  const detail: HyError["detail"] = { url, method };
  if (status != null) {
    detail.status = status;
  }
  setErrors(state, [createHyError("request", message, detail)]);
  state.globals.hy.loading = false;
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  console.error("[hytde] request error", error);
}

function recordStreamError(state: RuntimeState, message: string, url: string, method: string): void {
  const detail: HyError["detail"] = { url, method };
  emitLog(state, {
    type: "error",
    message,
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("request", message, detail));
  console.error("[hytde] stream error", message, detail);
  state.globals.hy.loading = state.pendingRequests > 0;
}
