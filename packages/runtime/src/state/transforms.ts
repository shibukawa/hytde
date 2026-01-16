import type { JsonScalar, JsonScalarType, HyGlobals } from "../types.js";

const TRANSFORM_REGISTRY_KEY = "__hytdeTransforms";
const TRANSFORM_TYPES: JsonScalarType[] = ["string", "number", "boolean", "null"];

type TransformDefinition = {
  inputType: JsonScalarType;
  fn: (input: JsonScalar, ...args: unknown[]) => JsonScalar;
};

export function installTransformApi(scope: typeof globalThis): void {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }

  const hy = scope.hy as HyGlobals & Record<string, unknown>;
  if (typeof hy.registerTransform === "function") {
    return;
  }

  hy.registerTransform = (name: string, inputType: JsonScalarType, fn: (input: JsonScalar, ...args: unknown[]) => JsonScalar) => {
    if (!name || typeof name !== "string") {
      logTransformRegistrationError(`Transform name must be a non-empty string.`);
      return;
    }
    if (!TRANSFORM_TYPES.includes(inputType)) {
      logTransformRegistrationError(`Transform inputType must be one of ${TRANSFORM_TYPES.join(", ")}.`);
      return;
    }
    if (typeof fn !== "function") {
      logTransformRegistrationError(`Transform fn must be a function.`);
      return;
    }

    const registry = getTransformRegistry(hy);
    if (registry.has(name)) {
      logTransformRegistrationError(`Transform "${name}" is already registered.`);
      return;
    }

    registry.set(name, { inputType, fn });
  };
}

export function ensureDefaultTransforms(hy: HyGlobals & Record<string, unknown>): void {
  const registry = getTransformRegistry(hy);
  if (!registry.has("date")) {
    registry.set("date", {
      inputType: "string",
      fn: (input: JsonScalar, ...args: unknown[]) => formatDateTransform(String(input), args)
    });
  }
}

function formatDateTransform(input: string, args: unknown[]): JsonScalar {
  const format = typeof args[0] === "string" ? args[0] : "yyyy-MM-dd";
  const result = formatDateValue(input, format);
  if (!result.valid) {
    console.warn(`[hytde] date transform failed for "${input}".`);
    return "";
  }
  return result.value;
}

function formatDateValue(input: string, format: string): { value: string; valid: boolean } {
  if (!input) {
    return { value: "", valid: false };
  }
  const isDigits = /^[0-9]+$/.test(input);
  const date = isDigits ? new Date(Number(input)) : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return { value: "", valid: false };
  }

  const pad2 = (value: number) => String(value).padStart(2, "0");
  const pad4 = (value: number) => String(value).padStart(4, "0");
  const replacements: Record<string, string> = {
    yyyy: pad4(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    dd: pad2(date.getDate()),
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds())
  };

  const value = format.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => replacements[token] ?? token);
  return { value, valid: true };
}

function logTransformRegistrationError(message: string): void {
  console.error(`[hytde] ${message}`);
}

export function getTransformRegistry(hy: Record<string, unknown>): Map<string, TransformDefinition> {
  const existing = hy[TRANSFORM_REGISTRY_KEY];
  if (existing instanceof Map) {
    return existing;
  }
  const registry = new Map<string, TransformDefinition>();
  hy[TRANSFORM_REGISTRY_KEY] = registry;
  return registry;
}

export function parseTransform(transform: string): { name: string; args: unknown[] } {
  const match = transform.match(/^([A-Za-z_$][\w$]*)(?:\((.*)\))?$/);
  if (!match) {
    return { name: transform, args: [] };
  }

  const name = match[1];
  const args = match[2] ? parseLiteralArgs(match[2]) : [];
  return { name, args };
}

export function parseLiteralArgs(text: string): unknown[] {
  const args: unknown[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    while (text[cursor] === " " || text[cursor] === "\n" || text[cursor] === "\t" || text[cursor] === ",") {
      cursor += 1;
    }
    if (cursor >= text.length) {
      break;
    }

    const char = text[cursor];
    if (char === "'" || char === "\"") {
      const quote = char;
      let end = cursor + 1;
      let value = "";
      while (end < text.length) {
        if (text[end] === "\\" && end + 1 < text.length) {
          value += text[end + 1];
          end += 2;
          continue;
        }
        if (text[end] === quote) {
          break;
        }
        value += text[end];
        end += 1;
      }
      args.push(value);
      cursor = end + 1;
      continue;
    }

    const nextComma = text.indexOf(",", cursor);
    const token = (nextComma === -1 ? text.slice(cursor) : text.slice(cursor, nextComma)).trim();
    args.push(parsePrimitive(token));
    cursor = nextComma === -1 ? text.length : nextComma + 1;
  }

  return args;
}

export function parsePrimitive(token: string): unknown {
  if (token === "true") {
    return true;
  }
  if (token === "false") {
    return false;
  }
  if (token === "null") {
    return null;
  }
  const num = Number(token);
  if (!Number.isNaN(num)) {
    return num;
  }
  return token;
}

export function isJsonScalar(value: unknown): value is JsonScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function matchesInputType(value: unknown, inputType: JsonScalarType): value is JsonScalar {
  if (inputType === "null") {
    return value === null;
  }
  return typeof value === inputType;
}
