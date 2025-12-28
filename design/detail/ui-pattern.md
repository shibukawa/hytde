# UI Patterns Mapping (Draft)

This document maps common enterprise AJAX UI patterns to HyTDE capabilities.
Each item lists relevant HyTDE features and current support status.

## 1. Search form (GET + query sync + table)
- Use: `<form hy-get>`, `hy-history` (URL<->form sync), `hy-table-data` (table rendering), `hy-store`, `hy-for`.
- Status: Supported (existing runtime features).

## 2. Edit form update (PUT + redirect)
- Use: `<form hy-put>`, `hy-redirect`, `hy-store`, `hy-fill`.
- Status: Supported (existing form handling).

## 3. Prefix match combo box (debounced query + popover)
- Use: `<input hy-get="... [value]" hy-debounce>`, `hy-store`, `hy-for`, popover via `command/commandfor`.
- Status: Supported (action-triggered requests + command sequencing).

## 4. Drill-down select boxes (cascading clears + reload)
- Use: `hy-get` for each level, `hy-store`, `hy-for`, `hy-if`, `hy-on`/dynamic behaviors for clearing.
- Status: Partially supported; cascading reset logic needs a defined pattern or dynamic behavior hook.

## 5. Optimistic UI updates
- Use: action-triggered `<input hy-post>` with optimistic update + rollback on error, `hy.errors`.
- Status: Supported for action-triggered inputs; broader mutation rollback remains out of scope.

## 6. Notification presence (SSE/polling/stream)
- Use: `<hy-sse>`, `<hy-get-polling>`, `<hy-get-stream>`, `hy-store`, `hy-if`.
- Status: Supported (stream/SSE/polling directives).

## 7. Notification list popover (click -> fetch -> show)
- Use: `<button hy-get ... command=... commandfor=...>`, `hy-store`, `hy-for`, popover element.
- Status: Supported (action-triggered fetch + command sequencing).

## 8. Autosave (debounced write + status log)
- Use: `hy-debounce`, `<form hy-post>` or `<input hy-post>`, `hy-store`, status region bound to `hyState`.
- Status: Partially supported; autosave timing and success log patterns need a defined recipe.

## 9. Locking via stream
- Use: `<hy-get-stream>` or `<hy-sse>` for lock state, `hy-store`.
- Status: Not implemented; lock acquisition/release and stream lifecycle rules are not specified.

## 10. Short-lived async task requests
- Use: `<form hy-post>`, `<hy-get-stream>`/`<hy-sse>` for progress, `hy-store`.
- Status: Not implemented; task ID lifecycle and local persistence are not specified.

## 11. Async upload (S3 multipart / tus)
- Use: dynamic behavior component (custom JS island) integrated with `hy.on(...)`.
- Status: Not implemented; upload queueing, chunking, and storage are outside current runtime spec.
