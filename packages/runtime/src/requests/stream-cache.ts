import type { RuntimeState } from "../state.js";
import { resolvePath } from "../utils/path.js";
import { parseSelectorTokens } from "../utils/selectors.js";

export function getStreamKeyCache(store: string, state: RuntimeState, keySelector: string): Set<string> {
  const existing = state.streamKeyCache.get(store);
  if (existing) {
    return existing;
  }
  const cache = new Set<string>();
  const current = state.globals.hyState[store];
  if (Array.isArray(current)) {
    for (const item of current) {
      const key = resolveStreamKey(item, keySelector);
      if (key != null) {
        cache.add(key);
      }
    }
  }
  state.streamKeyCache.set(store, cache);
  return cache;
}

export function resolveStreamKey(item: unknown, keySelector: string): string | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const tokens = parseSelectorTokens(keySelector);
  const value = resolvePath(item, tokens);
  if (value == null) {
    return null;
  }
  return String(value);
}
