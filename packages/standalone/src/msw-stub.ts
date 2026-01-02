export function installMockServiceWorkerStub(scope: typeof globalThis): void {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }
  const hy = scope.hy as unknown as { mockServiceWorker?: () => void } & Record<string, unknown>;
  hy.__hytdeMockDisabled = true;
  if (typeof hy.mockServiceWorker === "function") {
    return;
  }
  hy.mockServiceWorker = () => {
    if (typeof console !== "undefined") {
      console.warn("Mocking is disabled in production.");
    }
  };
}
