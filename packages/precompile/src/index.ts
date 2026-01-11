import { createRuntime, type Runtime, initHyPathParams } from "@hytde/runtime";
import { parseSubtree } from "@hytde/parser";
import type { IrDocument } from "@hytde/runtime";

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
    console.debug("[hytde] precompile:init:start", { url: doc.URL });
    const ir = readParserSnapshot(doc);
    if (!ir) {
      console.error("[hytde] precompile:parser snapshot missing.");
      return;
    }
    console.debug("[hytde] precompile:init:ir", {
      executionMode: ir.executionMode,
      requestTargets: ir.requestTargets.length
    });
    initHyPathParams(doc);
    runtime.init(doc, ir);
    console.debug("[hytde] precompile:init:done", { url: doc.URL });
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
