import { parseHashParams } from "../parse/params";
import { parseSelectorTokensStrict } from "../utils/selectors";
import { createHyError, pushError } from "../errors/ui";
import type { RuntimeGlobals, ExpressionInput, ParsedExpression } from "../types";
import type { RuntimeState } from "../state";
import type { JsonScalar } from "../types";
import { emitLog, emitExpressionError, emitTransformError } from "../utils/logging";
import {
  getTransformRegistry,
  isJsonScalar,
  matchesInputType,
  parseTransform
} from "./transforms";

export type ScopeStack = Array<Record<string, unknown>>;

export interface InterpolationResult {
  value: string;
  isSingleToken: boolean;
  tokenValue: unknown;
  navFallback?: string | null;
}

type UrlInterpolationContext = "nav" | "request";

export function resolveUrlTemplate(
  template: string,
  scope: ScopeStack,
  state: RuntimeState,
  options: { urlEncodeTokens: boolean; context: UrlInterpolationContext }
): InterpolationResult {
  const resolved = interpolateTemplate(template, scope, state, {
    urlEncodeTokens: options.urlEncodeTokens
  });
  const navResult = applyPathParamsToUrl(resolved.value, template, scope, state, options.context);
  return { ...resolved, value: navResult.value, navFallback: navResult.fallback };
}

export function interpolateTemplate(
  template: string,
  scope: ScopeStack,
  state: RuntimeState,
  options: { urlEncodeTokens: boolean }
): InterpolationResult {
  const pieces: Array<{ type: "text"; value: string } | { type: "token"; value: string }> = [];
  let cursor = 0;

  while (cursor < template.length) {
    const char = template[cursor];
    const next = template[cursor + 1];

    if (char === "{" && next === "{") {
      pieces.push({ type: "text", value: "{" });
      cursor += 2;
      continue;
    }

    if (char === "}" && next === "}") {
      pieces.push({ type: "text", value: "}" });
      cursor += 2;
      continue;
    }

    if (char === "{") {
      const end = template.indexOf("}", cursor + 1);
      if (end === -1) {
        pieces.push({ type: "text", value: template.slice(cursor) });
        break;
      }
      const token = template.slice(cursor + 1, end).trim();
      pieces.push({ type: "token", value: token });
      cursor = end + 1;
      continue;
    }

    pieces.push({ type: "text", value: char });
    cursor += 1;
  }

  const isSingleToken = pieces.length === 1 && pieces[0].type === "token";
  let tokenValue: unknown = null;
  let value = "";

  for (const piece of pieces) {
    if (piece.type === "text") {
      value += piece.value;
    } else {
      const evaluated = evaluateExpression(piece.value, scope, state);
      tokenValue = evaluated;
      if (evaluated == null) {
        value += "";
      } else {
        const raw = String(evaluated);
        value += options.urlEncodeTokens ? encodeURIComponent(raw) : raw;
      }
    }
  }

  return { value, isSingleToken, tokenValue };
}

export function evaluateExpression(expression: ExpressionInput, scope: ScopeStack, state: RuntimeState): unknown {
  if (typeof expression !== "string") {
    return evaluateParsedExpression(expression, scope, state);
  }
  const parts = expression.split("|>").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  let value = evaluateSelector(parts[0], scope, state);
  for (let index = 1; index < parts.length; index += 1) {
    const transform = parseTransform(parts[index]);
    value = applyTransform(transform, value, state);
  }

  return value;
}

function evaluateParsedExpression(expression: ParsedExpression, scope: ScopeStack, state: RuntimeState): unknown {
  if (!expression.selectorTokens || expression.selectorTokens.length === 0) {
    return null;
  }
  let value = evaluateSelectorTokens(expression.selectorTokens, scope, state);
  for (const transform of expression.transforms) {
    value = applyTransform(transform, value, state);
  }
  return value;
}

function evaluateSelectorTokens(tokens: Array<string | number>, scope: ScopeStack, state: RuntimeState): unknown {
  const first = tokens[0];
  if (typeof first !== "string") {
    return null;
  }

  let current = resolveRootValue(first, scope, state.globals);
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
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

export function evaluateSelector(selector: string, scope: ScopeStack, state: RuntimeState): unknown {
  const parsed = parseSelectorTokensStrict(selector);
  if (parsed.error) {
    emitExpressionError(state, "Expression selector is invalid.", {
      selector,
      reason: parsed.error
    });
    return null;
  }
  const tokens = parsed.tokens;
  if (tokens.length === 0) {
    return null;
  }

  const first = tokens[0];
  if (typeof first !== "string") {
    return null;
  }

  let current = resolveRootValue(first, scope, state.globals);
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
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

export function resolveRootValue(name: string, scope: ScopeStack, globals: RuntimeGlobals): unknown {
  for (let index = scope.length - 1; index >= 0; index -= 1) {
    const locals = scope[index];
    if (Object.prototype.hasOwnProperty.call(locals, name)) {
      return locals[name];
    }
  }

  if (Object.prototype.hasOwnProperty.call(globals.hyState, name)) {
    return globals.hyState[name];
  }

  if (name === "hy") {
    return globals.hy;
  }
  if (name === "hyState") {
    return globals.hyState;
  }
  if (name === "hyParams") {
    return globals.hyParams;
  }

  return null;
}

export function applyTransform(transform: { name: string; args: unknown[] }, value: unknown, state: RuntimeState): unknown {
  const registry = getTransformRegistry(state.globals.hy as unknown as Record<string, unknown>);
  const entry = registry.get(transform.name);
  if (!entry) {
    emitTransformError(state, `Transform "${transform.name}" is not registered.`, {
      transform: transform.name
    });
    return null;
  }

  if (transform.args.length > 3) {
    emitTransformError(state, `Transform "${transform.name}" supports up to 3 arguments.`, {
      transform: transform.name,
      args: transform.args.length
    });
    return null;
  }

  if (!matchesInputType(value, entry.inputType)) {
    emitTransformError(state, `Transform "${transform.name}" expected ${entry.inputType}.`, {
      transform: transform.name,
      inputType: entry.inputType,
      value
    });
    return null;
  }

  const output = entry.fn(value as JsonScalar, ...transform.args);
  if (!isJsonScalar(output)) {
    emitTransformError(state, `Transform "${transform.name}" returned non-scalar.`, {
      transform: transform.name,
      value: output
    });
    return null;
  }

  return output;
}

function applyPathParamsToUrl(
  urlString: string,
  template: string,
  scope: ScopeStack,
  state: RuntimeState,
  context: UrlInterpolationContext
): { value: string; fallback: string | null } {
  const tokens = collectPathTokens(template);
  if (tokens.length === 0) {
    return { value: urlString, fallback: null };
  }
  if (context === "nav") {
    return resolveNavUrl(urlString, template, tokens, scope, state);
  }
  return { value: replacePathTokens(urlString, tokens, scope, state), fallback: null };
}

function collectPathTokens(template: string): string[] {
  const tokens: string[] = [];
  const regex = /\[([A-Za-z0-9_$-]+)\]/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(template)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function resolveNavUrl(
  urlString: string,
  template: string,
  tokens: string[],
  scope: ScopeStack,
  state: RuntimeState
): { value: string; fallback: string | null } {
  const [base, hash = ""] = urlString.split("#");
  const hashParams = parseHashParams(hash);
  const resolved = replacePathTokensWithValues(base, tokens, hashParams, scope, state);
  const value = resolved.value;
  const fallback = hash ? urlString : null;
  return { value, fallback };
}

function replacePathTokens(urlString: string, tokens: string[], scope: ScopeStack, state: RuntimeState): string {
  return replacePathTokensWithValues(urlString, tokens, null, scope, state).value;
}

function replacePathTokensWithValues(
  urlString: string,
  tokens: string[],
  hashParams: Record<string, string> | null,
  scope: ScopeStack,
  state: RuntimeState
): { value: string } {
  let result = urlString;
  for (const token of tokens) {
    const value = hashParams?.[token] ?? resolvePathTokenValue(token, scope, state);
    if (value == null) {
      recordMissingPathParam(state, token, urlString);
      continue;
    }
    const encoded = encodeURIComponent(value);
    result = result.replace(new RegExp(`\\[${token}\\]`, "g"), encoded);
  }
  return { value: result };
}

function resolvePathTokenValue(token: string, scope: ScopeStack, state: RuntimeState): string | null {
  const evaluated = evaluateSelector(token, scope, state);
  if (isJsonScalar(evaluated) && evaluated != null) {
    return String(evaluated);
  }
  const params = state.globals.hyParams;
  if (Object.prototype.hasOwnProperty.call(params, token)) {
    return params[token];
  }
  return null;
}

function recordMissingPathParam(state: RuntimeState, token: string, template: string): void {
  const key = `${token}@${template}`;
  if (state.missingPathParams.has(key)) {
    return;
  }
  state.missingPathParams.add(key);
  const detail = { context: "path", param: token, template };
  emitLog(state, {
    type: "error",
    message: "path:param-missing",
    detail,
    timestamp: Date.now()
  });
  pushError(state, createHyError("data", "Missing path param", detail));
}
