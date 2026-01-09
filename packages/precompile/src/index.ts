import { createRuntime, type Runtime, initHyPathParams } from "@hytde/runtime";
import {
  parseDocumentToIr,
  parseSubtree
} from "@hytde/parser";

export interface PrecompileRuntime {
  init(root?: Document | HTMLElement): void;
  runtime: Runtime;
}

export function initPrecompile(root?: Document | HTMLElement): PrecompileRuntime {
  const runtime = createRuntime({ parseDocument: () => {
    throw new Error("parseDocument is not available in IR runtime.");
  }, parseSubtree });
  const doc = resolveDocument(root);
  if (doc) {
    initHyPathParams(doc);
    runtime.init(doc, parseDocumentToIr(doc));
  }

  return {
    init(target?: Document | HTMLElement) {
      const targetDoc = resolveDocument(target);
      if (targetDoc) {
        initHyPathParams(targetDoc);
        runtime.init(targetDoc, parseDocumentToIr(targetDoc));
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
