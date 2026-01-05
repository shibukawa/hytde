export function resolvePath(value: unknown, tokens: Array<string | number>): unknown {
  let current = value as unknown;
  for (const token of tokens) {
    if (current == null) {
      return null;
    }
    if (typeof token === "number") {
      current = (current as unknown[])[token];
    } else {
      if (token === "last" && Array.isArray(current)) {
        current = current.length > 0 ? current[current.length - 1] : null;
        continue;
      }
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current ?? null;
}
