import type { ParsedRequestTarget, RuntimeState } from "@hytde/runtime";
import { resolveRequestUrl } from "@hytde/runtime";
import type { PrefetchEntry } from "./types.js";

const DEFAULT_TIMEOUT_MS = 5000;

export async function executePrefetch(
  targets: ParsedRequestTarget[],
  state: RuntimeState,
  options: {
    apiBaseUrl?: string;
    timeoutMs?: number;
    getAuthHeaders?: (request: Request) => Promise<Record<string, string>> | Record<string, string>;
    request: Request;
  }
): Promise<{ prefetched: PrefetchEntry[]; errors: string[] }> {
  const eligible = targets.filter((target) => {
    if (target.kind !== "fetch") {
      return false;
    }
    if (target.trigger !== "startup") {
      return false;
    }
    if (target.method !== "GET" && target.method !== "POST") {
      return false;
    }
    return true;
  });

  const prefetched: PrefetchEntry[] = [];
  const errors: string[] = [];

  for (const target of eligible) {
    const resolved = resolveRequestUrl(target, state);
    const requestUrl = resolved.value;
    const fetchUrl = resolveRequestUrlWithBase(requestUrl, options.apiBaseUrl);
    const headers: Record<string, string> = {};
    if (options.getAuthHeaders) {
      const auth = await options.getAuthHeaders(options.request);
      Object.assign(headers, auth);
    }
    const controller = new AbortController();
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(fetchUrl, {
        method: target.method,
        headers,
        signal: controller.signal
      });
      clearTimeout(timer);

      const payload = await parseResponsePayload(response);
      const storePayload = applyStorePayload(target, payload, state);
      prefetched.push({
        path: requestUrl,
        method: target.method,
        status: response.status,
        headers: collectHeaders(response),
        payload: storePayload,
        store: target.store,
        unwrap: target.unwrap,
        ok: response.ok
      });
      if (!response.ok) {
        errors.push(`Request failed: ${target.method} ${fetchUrl} (${response.status})`);
      }
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      prefetched.push({
        path: requestUrl,
        method: target.method,
        status: null,
        headers: {},
        payload: null,
        store: target.store,
        unwrap: target.unwrap,
        ok: false,
        error: message
      });
      errors.push(`Request failed: ${target.method} ${fetchUrl} (${message})`);
    }
  }

  return { prefetched, errors };
}

function resolveRequestUrlWithBase(path: string, apiBaseUrl?: string): string {
  if (!apiBaseUrl) {
    return path;
  }
  try {
    return new URL(path, apiBaseUrl).toString();
  } catch {
    return path;
  }
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    return await response.text();
  } catch {
    return null;
  }
}

function collectHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function applyStorePayload(target: ParsedRequestTarget, payload: unknown, state: RuntimeState): unknown {
  const storePayload = target.unwrap ? resolvePath(payload, parseSelectorTokens(target.unwrap)) : payload;
  const store = target.store;
  if (store) {
    state.globals.hyState[store] = storePayload;
  }
  return storePayload;
}

function resolvePath(value: unknown, tokens: Array<string | number>): unknown {
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

function parseSelectorTokens(selector: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let cursor = 0;
  const length = selector.length;

  const readIdentifier = (): string | null => {
    const match = selector.slice(cursor).match(/^([A-Za-z_$][\\w$]*)/);
    if (!match) {
      return null;
    }
    cursor += match[1].length;
    return match[1];
  };

  const first = readIdentifier();
  if (!first) {
    return tokens;
  }
  tokens.push(first);

  while (cursor < length) {
    const char = selector[cursor];
    if (char === ".") {
      cursor += 1;
      const ident = readIdentifier();
      if (!ident) {
        break;
      }
      tokens.push(ident);
      continue;
    }

    if (char === "[") {
      cursor += 1;
      while (selector[cursor] === " ") {
        cursor += 1;
      }
      const quote = selector[cursor];
      if (quote === "'" || quote === "\"") {
        cursor += 1;
        let value = "";
        while (cursor < length) {
          if (selector[cursor] === "\\" && cursor + 1 < length) {
            value += selector[cursor + 1];
            cursor += 2;
            continue;
          }
          if (selector[cursor] === quote) {
            break;
          }
          value += selector[cursor];
          cursor += 1;
        }
        cursor += 1;
        tokens.push(value);
      } else {
        const end = selector.indexOf("]", cursor);
        const raw = selector.slice(cursor, end === -1 ? length : end).trim();
        const num = Number(raw);
        tokens.push(Number.isNaN(num) ? raw : num);
        cursor = end === -1 ? length : end;
      }

      while (cursor < length && selector[cursor] !== "]") {
        cursor += 1;
      }
      cursor += 1;
      continue;
    }

    break;
  }

  return tokens;
}
