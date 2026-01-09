import type { RuntimeState } from "../state";
import { emitLog } from "../utils/logging";
import { resolveUrlTemplate } from "../state/expression";
import { buildScopeStack } from "../render";
import { NAV_FALLBACK_ATTR } from "../state/constants";

export function setupNavigationHandlers(state: RuntimeState): void {
  const view = state.doc.defaultView;
  if (!view || state.navListenerAttached) {
    return;
  }
  state.navListenerAttached = true;
  state.doc.addEventListener("click", (event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    if (state.pathMeta.mode !== "hash") {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const anchor = findClosestAnchor(target);
    if (!anchor) {
      return;
    }
    if (anchor.hasAttribute("download")) {
      return;
    }
    if (anchor.target && anchor.target !== "_self") {
      return;
    }
    const fallback = anchor.getAttribute(NAV_FALLBACK_ATTR);
    const href = anchor.getAttribute("href");
    if (!fallback || !href) {
      return;
    }
    const canonicalUrl = resolveNavigationUrl(href, state.doc);
    const fallbackUrl = resolveNavigationUrl(fallback, state.doc);
    if (!canonicalUrl || !fallbackUrl) {
      return;
    }
    if (canonicalUrl.origin !== view.location.origin || fallbackUrl.origin !== view.location.origin) {
      return;
    }
    event.preventDefault();
    void navigateWithHashFallback(canonicalUrl.toString(), fallbackUrl.toString(), view);
  });
}

function findClosestAnchor(element: Element | null): HTMLAnchorElement | null {
  let current: Element | null = element;
  while (current) {
    if (current instanceof HTMLAnchorElement && current.hasAttribute("href")) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function resolveNavigationUrl(urlString: string, doc: Document): URL | null {
  const base = doc.baseURI ?? doc.defaultView?.location?.href ?? "";
  try {
    return new URL(urlString, base);
  } catch (error) {
    return null;
  }
}

export async function navigateWithHashFallback(canonicalUrl: string, fallbackUrl: string, view: Window): Promise<void> {
  const shouldUseFallback = !(await probeCanonicalUrl(canonicalUrl));
  view.location.assign(shouldUseFallback ? fallbackUrl : canonicalUrl);
}

async function probeCanonicalUrl(url: string): Promise<boolean> {
  try {
    const options = await fetch(url, { method: "OPTIONS" });
    if (options.status === 404) {
      return false;
    }
    if (options.status !== 405 && options.status !== 501) {
      const allow = options.headers.get("allow") ?? options.headers.get("access-control-allow-methods");
      const allowed = allow ? allow.split(",").map((method) => method.trim().toUpperCase()) : [];
      if (allowed.includes("HEAD")) {
        const head = await fetch(url, { method: "HEAD" });
        return head.status !== 404;
      }
      if (allowed.includes("GET")) {
        const get = await fetch(url, { method: "GET" });
        return get.status !== 404;
      }
      return true;
    }
    const response = await fetch(url, { method: "HEAD" });
    if (response.status !== 405 && response.status !== 501) {
      return response.status !== 404;
    }
    const get = await fetch(url, { method: "GET" });
    return get.status !== 404;
  } catch (error) {
    return false;
  }
}

export function maybeRedirectAfterSubmit(target: import("../types").ParsedRequestTarget, _payload: unknown, state: RuntimeState): void {
  if (target.method === "GET") {
    return;
  }
  const redirectAttr = target.redirect;
  if (!redirectAttr) {
    return;
  }
  const scope = buildScopeStack(target.element, state);
  const resolved = resolveUrlTemplate(redirectAttr, scope, state, { urlEncodeTokens: true, context: "nav" });
  if (!resolved.value) {
    return;
  }
  const view = state.doc.defaultView;
  if (!view) {
    return;
  }
  const canonicalUrl = resolveNavigationUrl(resolved.value, state.doc);
  if (!canonicalUrl) {
    recordRedirectError(state, resolved.value, "Invalid redirect URL.");
    return;
  }
  if (canonicalUrl.origin !== view.location.origin) {
    recordRedirectError(state, canonicalUrl.toString(), "Cross-origin redirect is blocked.");
    return;
  }
  const fallbackUrl = resolved.navFallback ? resolveNavigationUrl(resolved.navFallback, state.doc) : null;
  if (fallbackUrl && fallbackUrl.origin !== view.location.origin) {
    recordRedirectError(state, fallbackUrl.toString(), "Cross-origin redirect is blocked.");
    return;
  }

  emitLog(state, {
    type: "info",
    message: "redirect:navigate",
    detail: { url: canonicalUrl.toString(), formId: target.form?.id || undefined },
    timestamp: Date.now()
  });
  if (state.pathMeta.mode === "hash" && fallbackUrl) {
    void navigateWithHashFallback(canonicalUrl.toString(), fallbackUrl.toString(), view);
    return;
  }
  view.location.assign(canonicalUrl.toString());
}

function recordRedirectError(state: RuntimeState, url: string, message: string): void {
  emitLog(state, {
    type: "error",
    message: "redirect:error",
    detail: { url, message },
    timestamp: Date.now()
  });
}
