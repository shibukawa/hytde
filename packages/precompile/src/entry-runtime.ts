import type { IrDocument as RuntimeIrDocument } from "@hytde/runtime";
import { createRuntime, initHyPathParams } from "@hytde/runtime";
import { compactIrDocument, expandIrDocument, parseSubtree, type IrDocument as ParserIrDocument } from "@hytde/parser";
import extableCssUrl from "./extable.css?url";

const PARSER_SNAPSHOT_ID = "hy-precompile-parser";
const MSW_STATE_KEY = "__hytdeMswState";
const EXTABLE_STYLE_MARKER = "data-hytde-extable-style";
const INIT_DONE_KEY = "__hytdeInitDone";

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
  __hytdeInitDone?: boolean;
  mockServiceWorker?: (...args: unknown[]) => void | Promise<void>;
};

export async function init(root?: Document | HTMLElement): Promise<void> {
  const doc = resolveDocument(root);
  if (!doc) {
    return;
  }

  const scope = doc.defaultView ?? globalThis;
  (scope as typeof globalThis & {
    __hytdeSpaRuntime?: {
      createRuntime: typeof createRuntime;
      initHyPathParams: typeof initHyPathParams;
      parseSubtree: typeof parseSubtree;
    };
  }).__hytdeSpaRuntime = { createRuntime, initHyPathParams, parseSubtree };

  initHyPathParams(doc);
  const runtime = createRuntime({
    parseDocument: () => {
      throw new Error("parseDocument is not available in IR runtime.");
    },
    parseSubtree
  });

  const snapshot = readParserSnapshot(doc);
  const normalized = normalizeIrSnapshot(snapshot);
  if (!normalized) {
    return;
  }
  const { compact: runtimeIr, verbose: ir } = normalized;
  const parseErrors = Array.isArray(ir.parseErrors) ? (ir.parseErrors as ParseError[]) : [];
  const tables = Array.isArray(ir.tables) ? ir.tables : [];
  const executionMode = ir.executionMode ?? "production";
  const mockRules = Array.isArray(ir.mockRules) ? ir.mockRules : [];

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

  if (executionMode !== "disable" && tables.length > 0) {
    ensureExtableStylesheet(doc);
  }

  await registerMetaMockHandlers(doc, { executionMode, mockRules });
  await startMockServiceWorkerIfNeeded(doc, executionMode);
  runtime.init(doc, runtimeIr);
  const hy = ensureHy(doc.defaultView ?? globalThis);
  hy[INIT_DONE_KEY] = true;
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

function readParserSnapshot(doc: Document): unknown | null {
  const script = doc.getElementById(PARSER_SNAPSHOT_ID);
  if (!script) {
    return null;
  }
  const payload = script.textContent?.trim();
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload);
  } catch (error) {
    void error;
    return null;
  }
}

function normalizeIrSnapshot(
  snapshot: unknown
): { compact: RuntimeIrDocument; verbose: RuntimeIrDocument } | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const record = snapshot as Record<string, unknown>;
  const isCompact = "m" in record || "tb" in record || "rt" in record || "ic" in record;
  if (isCompact) {
    return {
      compact: snapshot as RuntimeIrDocument,
      verbose: expandIrDocument(snapshot) as RuntimeIrDocument
    };
  }
  const verbose = snapshot as ParserIrDocument;
  return {
    compact: compactIrDocument(verbose) as RuntimeIrDocument,
    verbose: verbose as RuntimeIrDocument
  };
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
