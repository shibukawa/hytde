import { createRuntime, type Runtime, initHyPathParams } from "@hytde/runtime";
import {
  parseDocument,
  parseSubtree
} from "@hytde/parser";

export interface PrecompileRuntime {
  init(root?: Document | HTMLElement): void;
  runtime: Runtime;
}

export function initPrecompile(root?: Document | HTMLElement): PrecompileRuntime {
  const runtime = createRuntime({ parseDocument, parseSubtree });
  const doc = resolveDocument(root);
  if (doc) {
    initHyPathParams(doc);
    runtime.init(parseDocument(doc));
  }

  return {
    init(target?: Document | HTMLElement) {
      const targetDoc = resolveDocument(target);
      if (targetDoc) {
        initHyPathParams(targetDoc);
        runtime.init(parseDocument(targetDoc));
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
