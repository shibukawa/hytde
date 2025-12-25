# Dynamic Tables (extable integration) (Draft)

This document defines how HyTDE templates can progressively enhance an HTML `<table>` into a high-performance dynamic table powered by `@extable/core`.

Rationale:
- Business apps often need large grids (10k+ rows), fast scrolling, column filtering, conditional formatting, and Excel-like editing.
- The initial page must be valid HTML (SSR/static), but the enhanced table may use JavaScript after render.

## 1. High-level model

- Author writes a normal HTML table for static/SSR layout and accessibility.
- Author opts-in to enhancement by adding `hy-table-data="<table-key>"` on the table element.
- Table schema/options are declared in HTML attributes so the template remains self-contained.
- When HyTDE runs (`hy-mode != disable`), it replaces the table with an extable-powered canvas/grid.

## 2. Activation & modes

HyTDE enhances tables only when executing:
- `hy-mode=production` (default): enhance
- `hy-mode=mock`: enhance (data may be mocked per `design/fetching.md`)
- `hy-mode=disable`: do not enhance (leave plain HTML as-is)

## 3. Markup

### 3.1 Basic usage

```html
<table hy-table-data="users" hy-data="current.users" hy-edit-mode="readonly" hy-option="lang: ja en">
  <thead>
    <tr>
      <th hy-column="key: id; type: number" style="width: 80px">ID</th>
      <th hy-column="key: name; type: string">Name</th>
      <th hy-column="key: email; type: string">Email</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>100</td><td>Alice</td><td>alice@example.com</td></tr>
  </tbody>
</table>
```

`hy-table-data` identifies a table instance on the page. The instance is configured by `hy-data`, `hy-edit-mode`, `hy-option`, and `hy-column`.

Uniqueness:
- `hy-table-data` MUST be unique within a document. If multiple tables share the same value, HyTDE MUST treat it as an error (the change set and event routing would be ambiguous).
- The value may be a human-chosen key (e.g. `users`) or a data-source-like string, as long as it is unique.

### 3.2 Linking to a form (changes + validity)

If a table is editable and its changes must be submitted with a form, link the form by adding a hidden control:

```html
<form id="user-form" hy-post="/api/users/batch">
  <input type="hidden" hy-table-data="users" />
  <button type="submit">Save</button>
</form>

<table hy-table-data="users" hy-data="current.users" hy-edit-mode="commit"></table>
```

Runtime contract:
- The hidden input declares that the form wants to include the table change set for the table instance `"users"`.
- When the table becomes invalid, HyTDE disables submit controls within that form.
- On submit, HyTDE serializes the table delta and adds it to the request payload (see below).

#### Optional: submit full data (`hy-table-submit="all"`) (proposal)

In some workflows, sending only a delta is not sufficient (e.g. server APIs that expect “replace the full list” semantics).

If the hidden input has `hy-table-submit="all"`, HyTDE MUST include the full current table data instead of a delta.

Example:
```html
<form hy-post="/api/departments/save">
  <input type="hidden" hy-table-data="departments" hy-table-submit="all" />
  <button type="submit">Save</button>
</form>
```

Rules (v1 proposal):
- Default is delta submission (diff) when `hy-table-submit` is omitted.
- `hy-table-submit` values:
  - `diff` (default): submit the delta (`inserted`/`updated`/`deleted`) as specified below.
  - `all`: submit the full current rows array.

Suggested JSON envelope for `all`:
```json
{
  "hyTables": {
    "departments": {
      "mode": "all",
      "rows": []
    }
  }
}
```

Notes:
- `rows` is the “current view of data” at submit time (after applying edits).
- For `all`, delta fields may be omitted or empty; consumers should prefer `rows` when present.

Single-table convenience:
- If the document contains exactly one table with `hy-table-data`, the hidden input MAY omit the key: `<input type="hidden" hy-table-data />`.
- If multiple tables exist, omitting the key MUST be treated as an error.

## 4. Table definition via attributes (v1)

### 4.1 `hy-data` (rows source)

`hy-data="<path>"` points to an array of row objects in the HyTDE data model.

Examples:
- `hy-data="current.users"`
- `hy-data="hyState.current.users"`

The exact resolution rules follow HyTDE selector/path rules (see `design/template-language.md`), but `hy-data` SHOULD be a simple path (no `|>` transforms) in v1.

### 4.2 `hy-option` (extable options)

`hy-option="..."` configures extable options using a CSS-like declaration list so it is familiar and has well-known escaping rules.

Format:
- Parsed like an inline `style=""` attribute: a declaration list of `key: value;` pairs.
- Values may contain spaces.
- For list-like values, use space-separated tokens (e.g. `lang: ja en`).
- Escaping/quoting follows CSS conventions:
  - Use quotes to include special characters safely: `title: "a; b";`
  - Backslash escapes follow CSS rules (same as `style=""` parsing).

Examples:
- `hy-option="lang: ja en"`
- `hy-option="filter: true; virtual-scroll: true"`

### 4.3 `hy-column` (column definition on `<th>`)

Each visible column is defined on its header cell:

```html
<th hy-column="key: createdAt; type: date; format: yyyy-MM-dd" style="width: 140px">
  Created
</th>
```

`hy-column` uses the same CSS-like declaration list format as `hy-option` (parsed like `style=""`).

Keys (v1):
- `key`: property name in the row object (required)
- `type`: `string|number|date|boolean` (optional; default `string`)
- `format`: formatting hint (optional; `date` type commonly uses it)

Width:
- Prefer standard HTML/CSS (`style="width: ..."` or classes). HyTDE reads computed/declared width as a hint for extable column sizing.

Notes:
- Loading `@extable/core` is the application’s responsibility (bundled or via import maps/CDN).
- HyTDE’s responsibility is wiring: discover enhanced tables (`hy-table-data`), parse attributes, mount extable, and integrate with HyTDE’s data + forms.

### 4.4 `hy-edit-mode` (edit behavior)

`hy-edit-mode` controls how edits are handled.

Values (v1):
- `direct` (default): apply edits immediately and emit change events for each edit.
- `readonly`: disable editing (view-only).
- `commit`: collect edits as a change set (delta) and commit them when the user submits a linked form (recommended for batch edit screens).

Notes:
- `commit` mode is intended to be used with `<input type="hidden" hy-table-data="...">` inside a form.
- Even in `direct` mode, the table may still maintain a change set for diagnostics, but submission behavior is application-defined.

## 4.4 Future: advanced extable schema

For advanced extable features that do not map cleanly to HTML attributes, a future version may add optional JavaScript registration for table schemas/options. v1 focuses on attribute-based configuration.

## 5. Replacement behavior

When HyTDE enhances a table:
- The original `<table>` element is replaced by an extable host element (implementation-defined) and/or a canvas-based grid.
- The original table MAY be kept offscreen for accessibility fallback, but it should not be visible by default.

Note for prototyping:
- Because the whole table is replaced when enhanced, placeholder `<tr>` rows do not need `hy-dummy`.

## 6. Editing, validation, and submit integration

### 6.1 Capturing changes

The enhanced table maintains an internal change set (delta):
- inserted rows
- updated cells/rows
- deleted rows

### 6.2 Submitting with a form

If the form contains `<input type="hidden" hy-table-data="<table-key>">` (or the single-table shorthand `hy-table-data` with no value):
- On form `submit`, HyTDE MUST serialize the table’s pending change set and include it in the outgoing request body.
- For JSON submission (the default when no `enctype` and no file inputs), HyTDE SHOULD merge a table payload into the form JSON under a stable key.
- For non-JSON submissions, HyTDE MAY set the hidden input value to a JSON string before the form is submitted (implementation-defined).

Default JSON envelope (proposal):

```json
{
  "hyTables": {
    "users": {
      "inserted": [],
      "updated": [],
      "deleted": []
    }
  }
}
```

Open question: allow customizing the envelope key and per-table payload shape.

### 6.3 Disabling submit when invalid

The table may have validation rules (cell constraints). If a linked form is present:
- When the table is invalid, HyTDE SHOULD prevent form submission and disable submit controls.
- When the table becomes valid, HyTDE SHOULD re-enable submission.

Default behavior (proposal):
- Disable all `button[type="submit"]` and `input[type="submit"]` within the linked form while invalid.

## 8. Direct mode server sync (proposal)

In `hy-edit-mode="direct"`, edits should be observable so the app can sync changes to the server without waiting for an explicit submit.

Two non-exclusive approaches:

### 8.1 Subscribe API (recommended)

HyTDE emits a table edit event on every edit (or after internal debouncing):
- payload includes `tableKey` (the `hy-table-data` value), `rowKey`, changed cells, and a normalized delta.

The app subscribes in JS and performs network calls as needed (debounce/batch optional).

Recommended: expose both a DOM event and a JS subscription helper:
- DOM event: `hy:table-edit` dispatched on the table host element
- Helper: `hy.on("table-edit", tableKey?, handler)`

`tableKey`:
- Uses the `hy-table-data="<table-key>"` value from the `<table>`.
- If `tableKey` is omitted, the handler receives events for **all** tables on the page (useful when there is only one table).

Optional full-data variant (proposal):
- DOM event: `hy:table-edit-all`
- Helper: `hy.on("table-edit-all", tableKey?, handler)`

`table-edit-all` is intended for consumers that prefer receiving the complete current dataset after each edit, rather than a delta.

### 8.2 Declarative handler id (optional)

For more declarative wiring, the table can reference a registered handler:

```html
<table hy-table-data="users" hy-edit-mode="direct" hy-table-sync="usersSync"></table>
```

And the app registers:
```js
hy.tableSync("usersSync", (event) => { /* send to server */ })
```

Open question: pick one API for v1 (subscribe vs handler id), or support both.

## 7. Filtering/sorting/pagination requests

For large datasets, the table will typically request data as the user scrolls or applies filters.

Requirements:
- debounce/filter input events where appropriate,
- cancel stale requests,
- avoid duplicated identical requests (dedupe per `design/fetching.md`),
- keep UI responsive with loading indicators.

## Open Questions

1. Do we standardize the table definition schema (JSON) so servers can also validate it?
2. Do we require a server contract for delta submission (insert/update/delete) or allow custom serializers?
3. How do we expose table validation in a consistent way across different table implementations?
