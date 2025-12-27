# Plugin Mechanism

## Goals
- Allow feature extensions (ex: table editing) without bloating the core runtime.
- Keep templates HTML-first; plugins react to parsed directives and store changes.
- Support registration before the standalone/runtime script is loaded.
- SSR implementations can ignore plugins and leave plugin-specific attributes/tags untouched.

## Registration
Plugins are registered via a runtime API or a pre-init global list.

```ts
export interface HytdePlugin {
  name: string;
  onParse?(context: PluginParseContext): PluginParseResult | void;
  onRender?(context: PluginRenderContext, state: PluginState): void;
  onBeforeUnload?(context: PluginRenderContext, state: PluginState): string | void;
  onDispose?(context: PluginRenderContext, state: PluginState): void;
}
```

Runtime API:
```ts
hy.registerPlugin(plugin);
```

Pre-init registration (for script tags loaded before the runtime):
```html
<script src="/vendor/hytde-plugin-extable.js"></script>
<script src="/dist/production-auto/index.js"></script>
```

```js
if (!window.hy) {
  window.hy = { plugins: [] };
}
if (!Array.isArray(window.hy.plugins)) {
  window.hy.plugins = [];
}
window.hy.plugins.push(myPlugin);
```

The runtime should consume `hy.plugins` during initialization and register them in-order.

### Sample HTML
```html
<script src="/plugins/hytde-plugin-extable.js"></script>
<script src="/dist/production-auto/index.js"></script>
```

## Lifecycle Hooks

### onParse
- Timing: after `parseDocument` (or `parseSubtree`) completes, before render.
- Purpose: inspect parsed directives and declare what to watch.
- Returns: `PluginParseResult` with watch targets and per-document plugin state.

```ts
export type PluginParseContext = {
  doc: Document;
  parsed: ParsedDocument;
};

export type PluginParseResult = {
  state?: PluginState;
  watches?: Array<PluginWatchTarget>;
};

export type PluginWatchTarget =
  | { type: "store"; selector: string }
  | { type: "dom"; selector: string };
```

### onRender
- Timing: render phase (initial render and subsequent updates).
- Called for:
  - Initial initialization.
  - Any change that matches declared watch targets.
- `context.reason` indicates whether this is the first run or a subsequent update.

```ts
export type PluginRenderContext = {
  doc: Document;
  parsed: ParsedDocument;
  reason: "init" | "update";
  changes?: PluginChange[];
};

export type PluginChange =
  | { type: "store"; selector: string }
  | { type: "dom"; selector: string };
```

### onBeforeUnload
- Timing: before navigation/unload.
- If a non-empty string is returned, block navigation and show a confirmation prompt.
- Return `void` to allow navigation.

### onDispose
- Timing: after navigation/unload is confirmed or when the runtime is disposed.
- Use for cleanup (event listeners, timers, observers).

## Runtime Notes
- Plugins are resolved from `hy.plugins` and `hy.registerPlugin`.
- Plugins can store per-document state (returned in `onParse`), passed back to later hooks.
- Table integration should be implemented as a plugin, not in core runtime.
- SSR behavior: plugins are no-op; servers may skip plugin processing entirely.

## Example (Table Plugin)
1. Plugin registers watchers for `hy-table-data` store paths.
2. `onRender` initializes table instances on first render.
3. `onRender` updates rows when watched store data changes.
4. `onBeforeUnload` returns a message if there are pending edits.
5. `onDispose` tears down listeners.
