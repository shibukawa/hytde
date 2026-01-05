import type { ParsedRequestTarget } from "../types";

export type StreamGate = {
  promise: Promise<void>;
  ready: boolean;
  increment: () => void;
  resolve: () => void;
};

export function createStreamGate(target: ParsedRequestTarget): StreamGate {
  const required = target.streamInitial;
  const timeoutMs = target.streamTimeoutMs;
  if (!required || required <= 0) {
    return {
      promise: Promise.resolve(),
      ready: true,
      increment: () => {
        return;
      },
      resolve: () => {
        return;
      }
    };
  }

  let current = 0;
  let resolveFn: () => void = () => {
    return;
  };
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  let timer: number | null = null;
  if (timeoutMs && timeoutMs > 0) {
    timer = window.setTimeout(() => {
      resolveFn();
    }, timeoutMs);
  }

  const gate: StreamGate = {
    promise,
    ready: false,
    increment: () => {
      current += 1;
      if (current >= required && !gate.ready) {
        gate.ready = true;
        if (timer != null) {
          window.clearTimeout(timer);
        }
        resolveFn();
      }
    },
    resolve: () => {
      if (!gate.ready) {
        gate.ready = true;
        if (timer != null) {
          window.clearTimeout(timer);
        }
        resolveFn();
      }
    }
  };

  return gate;
}
