export type InitFn = () => void | Promise<void>;

export function initOnReady(init: InitFn): void {
  let ran = false;
  const run = () => {
    if (ran) {
      return;
    }
    ran = true;
    void init();
  };
  if (document.readyState === "loading" || document.readyState === "interactive") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    window.addEventListener("pageshow", run, { once: true });
    return;
  }
  run();
}

export function registerGlobalInit(init: InitFn): void {
  const scope = globalThis as typeof globalThis & { hyInit?: InitFn };
  scope.hyInit = init;
}
