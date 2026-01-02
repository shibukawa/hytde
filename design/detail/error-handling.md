# HyTDE Error Handling (Draft)

This document defines HyTDE's default error UX and how errors are recorded in `hy.errors`.

## Goals
- Make runtime errors visible without requiring template authors to build custom UI.
- Keep browser/runtime and SSR behavior aligned where possible.
- Avoid disrupting normal layout; default UI is small and dismissible.

## Non-goals
- A full logging/telemetry system (handled by platform/runtime).
- Arbitrary error recovery or automatic retries in v1.

## Error Sources (Initial Set)
HyTDE SHOULD emit errors for:
- **Network/request errors**: non-2xx responses, fetch failures.
- **Missing pipeline transform**: transform name not registered.
- **Invalid `hy-for` syntax**: cannot parse `x of y`.
- **Missing data path**: selector resolves to `null` because a property/key is absent.
- **Cascade dependency cycles**: inferred drill-down dependencies form a loop (e.g. A -> B -> A).

Notes:
- Missing data paths are not fatal; binding output is `""` or `null` per binding rules.
- Transform errors produce `null` for the transform result.

## Error Object Shape
Errors are recorded as objects in `hy.errors[]`:

```
{
  type: "request" | "transform" | "syntax" | "data",
  message: string,
  detail?: {
    url?: string,
    method?: string,
    status?: number,
    selector?: string,
    transform?: string,
    expression?: string,
    attribute?: string,
    context?: string
  },
  timestamp: number
}
```

Rules:
- `hy.errors` is an array. The runtime MAY replace or append depending on lifecycle (see below).
- The runtime SHOULD de-duplicate identical errors within a single render pass.
- `timestamp` is epoch milliseconds.

## Lifecycle
- On request start, `hy.errors` SHOULD be cleared.
- On request completion, errors encountered during rendering MAY be appended.
- For non-request errors (e.g., invalid `hy-for`), errors SHOULD be appended without clearing.

## Default Error UI
If the template does **not** render `hy.errors` itself, the runtime MUST show a default UI.

### Opt-out (Custom Error Handler)
Templates can explicitly disable the default error UI by registering a custom handler:

```
hy.onError((errors) => {
  // render your own UI
});
```

Rules:
- When `hy.onError(...)` is registered, the runtime MUST NOT render the default toast/dialog.
- This does **not** suppress `hy.errors` updates or logging.

### Detection
The runtime SHOULD treat the template as "handling errors" if any binding references `hy.errors`
(e.g. `hy="hy.errors[0].message"` or `{hy.errors.length}` in `hy-attr-*`).
If no references are found, the default UI is enabled.

### Toast Behavior
- A toast appears in the **bottom-right** corner when `hy.errors` becomes non-empty.
- The toast contains:
  - A warning icon (e.g. "!" or ⚠️)
  - A short label: "Error occurred" (i18n is runtime-defined)
  - A counter if multiple errors exist (e.g. "3")
- The toast is dismissible and does not block interaction.

### Dialog Behavior
- Clicking the toast opens a modal dialog.
- The dialog lists all errors (most recent first), showing:
  - `type`
  - `message`
  - `timestamp` (formatted)
  - `detail` in a compact key/value list
- The dialog can be closed via:
  - Close button
  - Esc key
  - Clicking the backdrop

### Accessibility
- Toast: `role="alert"`, `aria-live="polite"`.
- Dialog: `role="dialog"`, `aria-modal="true"`, focus trapped while open.

## Template-Provided Error UI
Templates may render `hy.errors` directly. If they do:
- Default UI MUST be suppressed.
- The runtime SHOULD still keep `hy.errors` updated.

## Server Rendering
Non-JS server rendering does not automatically emit a UI.
If servers wish to show errors, they should render `hy.errors` data explicitly in the template.
