export type InitFn = () => void | Promise<void>;

export function initOnReady(init: InitFn): void {
  const run = () => {
    void init();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    return;
  }
  run();
}

export function registerGlobalInit(init: InitFn): void {
  const scope = globalThis as typeof globalThis & { hyInit?: InitFn };
  scope.hyInit = init;
}
