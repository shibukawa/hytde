import vm from "node:vm";
import type { RuntimeGlobals } from "@hytde/runtime";

const TRANSFORM_REGISTRY_KEY = "__hytdeTransforms";

type TransformDefinition = {
  inputType: string;
  fn: (input: unknown, ...args: unknown[]) => unknown;
};

export function executeTransformScript(script: string, globals: RuntimeGlobals): void {
  if (!script.trim()) {
    return;
  }
  const hy = globals.hy as unknown as Record<string, unknown>;
  const registry =
    hy[TRANSFORM_REGISTRY_KEY] instanceof Map
      ? (hy[TRANSFORM_REGISTRY_KEY] as Map<string, TransformDefinition>)
      : new Map<string, TransformDefinition>();
  hy[TRANSFORM_REGISTRY_KEY] = registry;
  hy.registerTransform = (name: string, inputType: string, fn: TransformDefinition["fn"]) => {
    if (!name || typeof name !== "string") {
      return;
    }
    if (registry.has(name)) {
      return;
    }
    registry.set(name, { inputType, fn });
  };

  const sandbox: Record<string, unknown> = { hy, console };
  sandbox.globalThis = sandbox;
  try {
    const context = vm.createContext(sandbox);
    vm.runInContext(script, context, { timeout: 1000 });
  } catch (error) {
    console.error("[hytde] SSR transform execution failed.", error);
  }
}
