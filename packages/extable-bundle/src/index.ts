import { ExtableCore } from "@extable/core";

const scope = typeof globalThis !== "undefined" ? globalThis : undefined;
if (scope) {
  (scope as typeof globalThis & { ExtableCore?: typeof ExtableCore }).ExtableCore = ExtableCore;
}

export { ExtableCore };
