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
- Use: `hy-get` for each level, `hy-store`, `hy-for`, `hy-if`, `hy-attr-*`.
- Status: Partially supported; cascading reset needs a defined runtime rule. Template-only disable states are supported.

### 4.1 Pattern
- A selection in level A triggers a request that refreshes the option dataset for level B.
- The B request writes to its own namespace (replacement semantics).
- The B `<select>` renders its options from that namespace via `hy-for`.
- The same pattern is repeated for B -> C.

### 4.2 Required reset behavior (runtime)
When the option dataset for a select is replaced by a `hy-store` write, HyTDE MUST:
1. Reset the select’s value to the empty option (value `""`) if present; otherwise clear the selection.
2. Emit a `change` event after the reset so downstream action-triggered requests observe the new empty value.
3. Clear downstream option datasets that depend on the reset value by writing `[]` to their `hy-store` namespaces.
4. Disable dependent selects while their dataset request is in flight; re-enable after the store write completes.

Dependency inference (v1 rule):
- A select is considered a **dependency** if a request URL on that select or its associated request element interpolates the upstream value (e.g. `hy-get="/api/cities?bId={filters.b}"`).
- Downstream option datasets are those rendered from the `hy-store` namespace written by that dependent request.
- Cycles in the inferred dependency graph MUST be detected and reported as errors; cascade resets are suppressed for cycle members.

### 4.3 Disabled state (template pattern)
Templates can disable a select when its dataset is empty using `hy-if`/`hy-else`:

```html
<label>
  Category
  <select name="a" hy-get="/api/categories" hy-store="aOptions">
    <option value="">(select one)</option>
    <option hy-for="a of aOptions" hy-attr-value="{a.id}" hy="{a.name}"></option>
  </select>
</label>

<label hy-if="bOptions">
  Subcategory
  <select name="b" hy-get="/api/subcategories?catId={a}" hy-store="bOptions">
    <option value="">(select one)</option>
    <option hy-for="b of bOptions" hy-attr-value="{b.id}" hy="{b.name}"></option>
  </select>
</label>
<label hy-else>
  Subcategory
  <select name="b" disabled>
    <option value="">(select one)</option>
  </select>
</label>

<label hy-if="cOptions">
  Item
  <select name="c" hy-get="/api/items?subId={b}" hy-store="cOptions">
    <option value="">(select one)</option>
    <option hy-for="c of cOptions" hy-attr-value="{c.id}" hy="{c.name}"></option>
  </select>
</label>
<label hy-else>
  Item
  <select name="c" disabled>
    <option value="">(select one)</option>
  </select>
</label>
```

Notes:
- `hy-if` treats an empty array as false, so `bOptions`/`cOptions` can directly drive enable/disable without extra transforms.
- The empty option is required so reset can land on a stable, valid value across static HTML, runtime, build output, and SSR.

## 5. Optimistic UI updates
- Use: action-triggered `<input hy-post>` with optimistic update + rollback on error, `hy.errors`.
- Status: Supported for action-triggered inputs; broader mutation rollback remains out of scope.

## 6. Notification presence (SSE/polling/stream)
- Use: `<hy-sse>`, `<hy-get-polling>`, `<hy-get-stream>`, `hy-store`, `hy-if`.
- Status: Supported (stream/SSE/polling directives).

## 7. Notification list popover (click -> fetch -> show)
- Use: `<button hy-get ... command=... commandfor=...>`, `hy-store`, `hy-for`, popover element.
- Status: Supported (action-triggered fetch + command sequencing).

## 8. Form state (autosave + leave guard)
- Use: `hy-form-state="mode: autosave-guard; duration: 500"` on form/submit action, form request attribute (`hy-post` etc.), localStorage restore prompt, leave-guard dialog.
- Status: Supported (spec defined in `design/detail/forms.md`).

## 9. Locking via stream
- Use: `<hy-get-stream>` or `<hy-sse>` for lock state, `hy-store`.
- Status: Not implemented; lock acquisition/release and stream lifecycle rules are not specified.

## 10. Short-lived async task requests
- Use: `<form hy-post>`, `<hy-get-stream>`/`<hy-sse>` for progress, `hy-store`.
- Status: Not implemented; task ID lifecycle and local persistence are not specified.

## 11. Async upload (S3 multipart / simple)
- Use: `<form hy-async-upload="s3|simple">` (default simple when empty), `hy-file-chunksize` (S3 only), `hy.uploading`, IndexedDB + localStorage persistence (S3), JSON submit with finalized paths/IDs.
- Status: In progress per `design/detail/async-file-uploading.md`.
