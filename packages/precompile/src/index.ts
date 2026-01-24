import type { IrDocument as RuntimeIrDocument } from "@hytde/runtime";
import { createRuntime, type Runtime, initHyPathParams } from "@hytde/runtime";
import { compactIrDocument, expandIrDocument, parseSubtree, type IrDocument as ParserIrDocument } from "@hytde/parser";

export interface PrecompileRuntime {
  init(root?: Document | HTMLElement): void;
  runtime: Runtime;
}

const PARSER_SNAPSHOT_ID = "hy-precompile-parser";

export function init(root?: Document | HTMLElement): void {
  initPrecompile(root);
}

export function initPrecompile(root?: Document | HTMLElement): PrecompileRuntime {
  const runtime = createRuntime({
    parseDocument: () => {
      throw new Error("parseDocument is not available in IR runtime.");
    },
    parseSubtree
  });

  const initWithDocument = (doc: Document): void => {
    const snapshot = readParserSnapshot(doc);
    const normalized = normalizeIrSnapshot(snapshot);
    if (!normalized) {
      return;
    }
    const { compact: runtimeIr, verbose: ir } = normalized;
    initHyPathParams(doc);
    runtime.init(doc, runtimeIr);
  };

  const doc = resolveDocument(root);
  if (doc) {
    initWithDocument(doc);
  }

  return {
    init(target?: Document | HTMLElement) {
      const targetDoc = resolveDocument(target);
      if (targetDoc) {
        initWithDocument(targetDoc);
      }
    },
    runtime
  };
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

function initOnReady(action: () => void): void {
  if (typeof document === "undefined") {
    return;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => action(), { once: true });
  } else {
    action();
  }
}

initOnReady(() => {
  initPrecompile();
});
