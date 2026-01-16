import type {
  HytdePlugin,
  PluginChange,
  PluginRenderContext
} from "../types.js";
import type { PluginRegistration, RuntimeState } from "../state.js";
import { getFormStateLeaveMessage, shouldPromptLeave } from "../form/form-state.js";

export function setupPlugins(state: RuntimeState): void {
  const hy = state.globals.hy as unknown as Record<string, unknown> & { plugins?: HytdePlugin[] };
  const list = Array.isArray(hy.plugins) ? hy.plugins : [];
  if (!Array.isArray(hy.plugins)) {
    hy.plugins = list;
  }

  const registerPluginInternal = (plugin: HytdePlugin): void => {
    if (!plugin || typeof plugin.name !== "string") {
      return;
    }
    if (state.plugins.some((entry) => entry.plugin === plugin || entry.plugin.name === plugin.name)) {
      return;
    }
    const parseResult = plugin.onParse ? plugin.onParse({ doc: state.doc, parsed: state.parsed }) : undefined;
    const watches = parseResult?.watches ?? [];
    const pluginState = parseResult?.state ?? null;
    state.plugins.push({ plugin, state: pluginState, watches });
  };

  hy.registerPlugin = (plugin: HytdePlugin) => {
    if (!list.includes(plugin)) {
      list.push(plugin);
    }
    registerPluginInternal(plugin);
  };

  for (const plugin of list) {
    registerPluginInternal(plugin);
  }

  if (!state.unloadListenerAttached) {
    const scope = state.doc.defaultView ?? globalThis;
    scope.addEventListener("beforeunload", (event) => {
      const message = collectBeforeUnloadMessage(state);
      if (message) {
        event.preventDefault();
        event.returnValue = message;
        return message;
      }
      return undefined;
    });
    scope.addEventListener("pagehide", () => {
      disposePlugins(state);
    });
    state.unloadListenerAttached = true;
  }
}

export function runPluginRender(state: RuntimeState, reason: "init" | "update", changes?: PluginChange[]): void {
  const context = buildPluginContext(state, reason, changes);
  for (const registration of state.plugins) {
    if (reason === "update" && !shouldRunPlugin(registration, changes)) {
      continue;
    }
    registration.plugin.onRender?.(context, registration.state);
  }
}

export function collectBeforeUnloadMessage(state: RuntimeState): string | null {
  if (shouldPromptLeave(state)) {
    return getFormStateLeaveMessage();
  }
  if (state.plugins.length === 0) {
    return null;
  }
  const context = buildPluginContext(state, "update");
  for (const registration of state.plugins) {
    const message = registration.plugin.onBeforeUnload?.(context, registration.state);
    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }
  return null;
}

export function disposePlugins(state: RuntimeState): void {
  if (state.disposed) {
    return;
  }
  state.disposed = true;
  const context = buildPluginContext(state, "update");
  for (const registration of state.plugins) {
    registration.plugin.onDispose?.(context, registration.state);
  }
  for (const source of state.sseSources.values()) {
    source.close();
  }
  state.sseSources.clear();
  for (const timer of state.pollingTimers.values()) {
    window.clearInterval(timer);
  }
  state.pollingTimers.clear();
}

function buildPluginContext(
  state: RuntimeState,
  reason: "init" | "update",
  changes?: PluginChange[]
): PluginRenderContext {
  return {
    doc: state.doc,
    parsed: state.parsed,
    reason,
    changes
  };
}

function shouldRunPlugin(registration: PluginRegistration, changes?: PluginChange[]): boolean {
  if (registration.watches.length === 0) {
    return true;
  }
  if (registration.watches.some((watch) => watch.type === "dom")) {
    return true;
  }
  if (!changes || changes.length === 0) {
    return false;
  }
  return registration.watches.some((watch) => {
    if (watch.type !== "store") {
      return false;
    }
    return changes.some((change) => change.type === "store" && change.selector === watch.selector);
  });
}
