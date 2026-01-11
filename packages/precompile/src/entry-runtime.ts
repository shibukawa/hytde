import { createRuntime, initHyPathParams } from "@hytde/runtime";
import { parseSubtree } from "@hytde/parser";
import type { IrDocument } from "@hytde/runtime";
import extableCssUrl from "./extable.css?url";

const PARSER_SNAPSHOT_ID = "hy-precompile-parser";
const MSW_STATE_KEY = "__hytdeMswState";
const EXTABLE_STYLE_MARKER = "data-hytde-extable-style";

type HyError = {
  type: "request" | "transform" | "syntax" | "data";
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
};

type ParseError = {
  message: string;
  detail?: Record<string, unknown>;
};

type HyLogState = {
  [MSW_STATE_KEY]?: { start?: (mode: "production" | "mock" | "disable") => Promise<void> | void; started?: boolean };
  __hytdeRegisterMswMetaHandlers?: (rules: unknown[], doc: Document) => Promise<void>;
  mockServiceWorker?: (...args: unknown[]) => void | Promise<void>;
};

export async function init(root?: Document | HTMLElement): Promise<void> {
  const doc = resolveDocument(root);
  if (!doc) {
    return;
  }

  console.debug("[hytde] precompile:entry:init", { url: doc.URL });
  initHyPathParams(doc);
  const runtime = createRuntime({
    parseDocument: () => {
      throw new Error("parseDocument is not available in IR runtime.");
    },
    parseSubtree
  });

  const ir = readParserSnapshot(doc);
  if (!ir) {
    console.error("[hytde] precompile:parser snapshot missing.");
    return;
  }
  console.debug("[hytde] precompile:entry:ir", {
    executionMode: ir.executionMode,
    requestTargets: ir.requestTargets.length
  });

  const parseErrors = Array.isArray(ir.parseErrors) ? (ir.parseErrors as ParseError[]) : [];
  if (parseErrors.length > 0) {
    const hy = ensureHy(doc.defaultView ?? globalThis);
    const nextErrors: HyError[] = parseErrors.map((error) => ({
      type: "syntax",
      message: error.message,
      detail: error.detail,
      timestamp: Date.now()
    }));
    hy.errors = [...hy.errors, ...nextErrors];
    for (const error of parseErrors) {
      console.error("[hytde] parse error", error.message, error.detail);
    }
  }

  if (ir.executionMode !== "disable" && ir.tables.length > 0) {
    ensureExtableStylesheet(doc);
  }

  await registerMetaMockHandlers(doc, ir);
  await startMockServiceWorkerIfNeeded(doc, ir.executionMode);
  runtime.init(doc, ir);
  console.debug("[hytde] precompile:entry:done", { url: doc.URL });
}

export const hy = { init };

async function startMockServiceWorkerIfNeeded(
  doc: Document,
  executionMode: "production" | "mock" | "disable"
): Promise<void> {
  const scope = doc.defaultView ?? globalThis;
  const hy = ensureHy(scope) as HyLogState;
  const mswState = hy[MSW_STATE_KEY];
  const start = mswState?.start;
  const pendingStart =
    (mswState as { pendingStart?: boolean } | undefined)?.pendingStart ?? false;
  console.info("[hytde] runtime:msw:start", {
    hasState: !!mswState,
    hasStart: typeof start === "function",
    mode: executionMode,
    mswStarted: mswState?.started ?? false,
    pendingStart
  });
  if (typeof start === "function") {
    await start(executionMode);
  } else {
    console.info("[hytde] runtime:msw:start:skip", { reason: "no-start" });
  }
  if (executionMode === "mock" && !mswState?.started) {
    const error = {
      type: "request",
      message: "Mocking requires MSW, but the service worker did not start.",
      detail: { mode: executionMode },
      timestamp: Date.now()
    };
    const errorTarget = hy as HyLogState & { errors?: unknown[] };
    if (Array.isArray(errorTarget.errors)) {
      errorTarget.errors = [...errorTarget.errors, error];
    }
    console.error("[hytde] MSW failed to start; mocks are disabled.");
  }
}

async function registerMetaMockHandlers(doc: Document, ir: { executionMode: string; mockRules: unknown[] }): Promise<void> {
  if (ir.executionMode !== "mock") {
    console.debug("[hytde] runtime:msw:register:skip", { reason: "mode", mode: ir.executionMode });
    return;
  }
  const scope = doc.defaultView ?? globalThis;
  const hy = ensureHy(scope) as HyLogState & {
    __hytdeRegisterMswMetaHandlers?: (rules: unknown[], doc: Document) => Promise<void>;
  };
  const register = hy.__hytdeRegisterMswMetaHandlers;
  console.debug("[hytde] runtime:msw:register:start", {
    hasRegister: typeof register === "function",
    mockCount: ir.mockRules.length
  });
  if (typeof register === "function") {
    await register(ir.mockRules, doc);
    console.debug("[hytde] runtime:msw:register:complete", {
      handlerCount: ir.mockRules.length
    });
  }
}

function resolveDocument(root?: Document | HTMLElement): Document | null {
  if (!root) {
    return typeof document === "undefined" ? null : document;
  }

  if (root instanceof Document) {
    return root;
  }

  return root.ownerDocument;
}

function readParserSnapshot(doc: Document): IrDocument | null {
  const script = doc.getElementById(PARSER_SNAPSHOT_ID);
  if (!script) {
    return null;
  }
  const payload = script.textContent?.trim();
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as IrDocument;
  } catch (error) {
    console.error("[hytde] precompile:parser snapshot parse failed.", error);
    return null;
  }
}

function ensureHy(scope: typeof globalThis): HyLogState & { loading: boolean; errors: unknown[] } {
  if (!scope.hy) {
    scope.hy = { loading: false, errors: [] };
  }
  return scope.hy as HyLogState & { loading: boolean; errors: unknown[] };
}

function ensureExtableStylesheet(doc: Document): void {
  if (doc.querySelector(`link[${EXTABLE_STYLE_MARKER}]`)) {
    return;
  }
  if (doc.querySelector('link[rel="stylesheet"][href*="extable"]')) {
    return;
  }
  const head = doc.head ?? doc.querySelector("head");
  if (!head) {
    return;
  }
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = extableCssUrl;
  link.setAttribute(EXTABLE_STYLE_MARKER, "true");
  head.append(link);
}
