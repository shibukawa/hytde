export type LifecycleCallbacks = {
  onMount: Array<() => void>;
  onUnmount: Array<() => void>;
};

const STORE_KEY = "__hytdeSpaLifecycle";

export function ensureLifecycleStore(doc: Document): LifecycleCallbacks {
  const view = doc.defaultView;
  if (!view) {
    return { onMount: [], onUnmount: [] };
  }
  const record = view as unknown as Record<string, unknown>;
  const existing = record[STORE_KEY];
  if (existing && typeof existing === "object") {
    return existing as LifecycleCallbacks;
  }
  const created: LifecycleCallbacks = { onMount: [], onUnmount: [] };
  record[STORE_KEY] = created;
  return created;
}

export function initSpaLifecycle(doc: Document): void {
  const view = doc.defaultView;
  if (!view) {
    return;
  }
  const hy = (view.hy ?? (view.hy = { loading: false, errors: [] })) as unknown as Record<string, unknown>;
  const store = ensureLifecycleStore(doc);
  if (!hy.onMount) {
    hy.onMount = (callback: () => void) => {
      store.onMount.push(callback);
    };
  }
  if (!hy.onUnmount) {
    hy.onUnmount = (callback: () => void) => {
      store.onUnmount.push(callback);
    };
  }
}

export function runUnmountCallbacks(doc: Document): void {
  const store = ensureLifecycleStore(doc);
  const callbacks = store.onUnmount.splice(0, store.onUnmount.length);
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      console.error("[hytde] onUnmount callback error", error);
    }
  }
}

export function runMountCallbacks(doc: Document): void {
  const store = ensureLifecycleStore(doc);
  const callbacks = store.onMount.splice(0, store.onMount.length);
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      console.error("[hytde] onMount callback error", error);
    }
  }
}
