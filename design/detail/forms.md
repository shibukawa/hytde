# Forms: Navigation, Fetch, and Data Updates (Draft)

This document defines how HyTDE handles forms in both:
- plain HTML (no HyTDE runtime), and
- HyTDE execution modes (progressive enhancement).

The key goal is to support common business workflows such as:
- “search form → update results table”
- “search form → fill another form”
- “submit form → update parts of the page (no navigation)”
- optional URL/history updates for shareable/searchable URLs

## 1. Baseline (Plain HTML)

Without HyTDE, templates must behave as normal HTML:
- `<form method="get" action="...">` navigates and encodes fields into the query string.
- `<form method="post" action="...">` submits using standard encodings.

This remains the recommended baseline for SSR/MPA behavior and for static prototyping.

## 2. HyTDE-enhanced submission

HyTDE enhances forms only when executing:
- `hy-mode=production` (default)
- `hy-mode=mock`

When `hy-mode=disable`, HyTDE MUST NOT intercept form submits.

See `design/detail/routing.md` for a summary of baseline navigation vs fetch-only behavior, plus the `hy-redirect` proposal.
See `design/fetching.md` for the shared `hy.loading`/`hy.errors` globals and default error UI behavior.

### 2.1 Opting into fetch-only (no navigation)

If a form has a HyTDE request attribute, HyTDE intercepts submit and performs a fetch instead of navigation:
- `hy-get`, `hy-post`, `hy-put`, `hy-patch`, `hy-delete`

The attribute value is the endpoint URL.
If absent, HyTDE falls back to normal HTML navigation/submission.

Example:
```html
<form hy-get="/api/users/search" hy-history="push" hy-store="current" hy-unwrap="data">
  <input name="q" />
  <button type="submit">Search</button>
</form>
```

Store-first pattern:
- Use `hy-store` (and optionally `hy-unwrap`) to place responses into a named namespace and rerender consumers.
See `design/data-store.md`.

### 2.2 Request construction from form controls

HyTDE serializes form controls similarly to `FormData`:
- excludes disabled controls
- respects `name` attributes
- supports multiple values for repeated names

For `hy-get`:
- HyTDE builds the request URL by adding a query string derived from the form controls.

For non-GET (`hy-post`/`hy-put`/`hy-patch`/`hy-delete`):
- If the form has **no** `enctype` attribute and no file inputs, HyTDE sends `application/json` with a JSON body.
- If the form has file inputs, HyTDE uses `multipart/form-data` (regardless of `enctype`).
- If `enctype="application/x-www-form-urlencoded"` is explicitly set, HyTDE sends URL-encoded form data.
- If `enctype="multipart/form-data"` is explicitly set, HyTDE sends multipart form data.

Type handling (JSON default):
- `input[type="number"]`: parsed as number (floats allowed); empty/invalid → `null`.
- `input[type="checkbox"]` with a `value` attribute: checked → string value; unchecked → omitted.
- `input[type="checkbox"]` without a `value` attribute: boolean `true/false`.
- `input[type="radio"]`: checked → string value; unchecked → omitted.
- `input[type="datetime-local"]`, `input[type="tel"]`, text/select/textarea: strings.

For non-JSON encodings (`multipart/form-data`, `application/x-www-form-urlencoded`), values are stringified before submission.

## 3. Response → Store → Rerender

The intended pattern is “fetch JSON, store it, then re-run directives”.

### 3.1 Storage

Fetch-only forms should store responses explicitly:
- `hy-store="<namespace>"` stores the response into `hyState.<namespace>` and exposes `<namespace>` as a selector alias.
- `hy-unwrap="<key>"` can unwrap a top-level field before storing (e.g. unwrap `data` from `{ data: ... }`).

Store namespaces are global (no lexical scope). A search form and a distant table can share the same `hy-store` namespace even if they are not siblings in the DOM. Scoped behaviors remain on request directives (e.g., `<hy-get>` islands), but once data is written to `hyState.<namespace>`, any consumer can read it.

See `design/data-store.md`.

### 3.2 Rerender

After updating the store namespace, HyTDE re-evaluates directives that depend on the changed data:
- structural directives: `hy-if`, `hy-for`, `hy-dummy`
- bindings: `hy`, `hy-attr-*`

Before the first request runs, a bound namespace may be `undefined`. `hy-for` MUST treat `undefined`/`null` as an empty collection so templates like a search table render zero rows until results arrive.

This store-first pattern enables partial updates across distant regions: a search form can live in one section, write to `hyState.searchresult`, and a table elsewhere will rerender when that namespace updates.

This is how a search form can update a list/table without replacing the entire page.

### 3.3 Tables and other watchers

Components that read data from HyTDE data (e.g. tables enhanced via `hy-table-data` and configured with `hy-data`) should update when the data they depend on changes:
- tables call `setData` (conceptually) with the new array
- submit enable/disable is recalculated for linked forms

See `design/table.md`.

## 4. History / URL updates (search forms)

Search forms often want shareable URLs and browser back/forward support.

`hy-history` controls history updates for fetch-only submissions:
- `none` (default)
- `push`
- `replace`
- `sync` (read URL → form)
- `sync-push` (sync + push)
- `sync-replace` (sync + replace)

When `hy-history` is enabled:
- For `hy-get`, HyTDE SHOULD update the current page URL by applying the form controls as query parameters (recommended).
- For other methods, HyTDE SHOULD default to `none` unless explicitly configured.

### 4.1 URL ↔ Form Sync (recommended for search)

To avoid manually wiring initial values and to support “load from query string, then run”, HyTDE supports sync modes that read URL parameters back into the form on page load and on back/forward navigation.

Use:
- `hy-history="sync"`: sync only (no URL rewrite on submit)
- `hy-history="sync-push"`: sync + push on submit
- `hy-history="sync-replace"`: sync + replace on submit

Behavior:
- On initialization, HyTDE reads URL parameters into matching form controls (by `name`).
- If any synced parameter is present (non-empty), HyTDE SHOULD auto-submit once on initialization.
- On `popstate` (back/forward), HyTDE re-applies URL parameters to the form and SHOULD auto-submit (so results follow history).

Submit behavior by mode:
- `sync`: no URL rewrite; proceed with fetch as-is.
- `sync-push`: update URL from current form controls via history push, then fetch.
- `sync-replace`: update URL from current form controls via history replace, then fetch.

When rewriting URLs:
- For `hy-get`, HyTDE SHOULD update the current page URL by applying the form controls as query/hash parameters.
- For other methods, HyTDE SHOULD default to no URL rewrite unless explicitly configured (v1: treat `sync-*` as meaningful primarily for `hy-get`).
- On initialization, HyTDE reads URL parameters into matching form controls (by `name`).
- If any synced parameter is present (non-empty), HyTDE SHOULD auto-submit once on initialization.
- On `popstate` (back/forward), HyTDE re-applies URL parameters to the form and SHOULD auto-submit (so results follow history).

Parameter source:
- Default: query string (`location.search`)
- Optional: `hy-history-params="hash"` to use `#k=v` style instead (static-friendly URLs).

Notes on `hy-history-params="hash"`:
- HyTDE MAY use `history.pushState()` / `history.replaceState()` with a URL that includes a `#...` fragment to update hash parameters without navigation.
- For reacting to changes, `popstate` covers back/forward for history entries; implementations MAY also listen to `hashchange` for cases where the hash changes without a history state update (e.g. manual edits, anchor navigation).

Optional scoping:
- `hy-history-fields="q status page"` limits which fields participate (defaults to all named, non-disabled controls).

## 4.1 Auto-submit (change/input without explicit confirm)

Some mobile and business UIs submit or refresh results as soon as the user edits a field (no explicit “Search”/“Apply”).

HyTDE supports this behavior for fetch-only forms (forms that have `hy-get`/`hy-post`/…).

### Markup

```html
<form
  hy-get="/api/users/search"
  hy-store="current"
  hy-unwrap="data"
  hy-history="replace"
  hy-submit-on="input"
  hy-debounce="250"
>
  <input name="q" />
</form>
```

Attributes:
- `hy-submit-on`: whitespace-separated events that trigger an automatic submit. Recommended values:
  - `change` (default): good for selects/checkboxes
  - `input`: live filtering as the user types (pair with debounce)
- `hy-debounce`: debounce in milliseconds for auto-submit triggers (default: 200)

Behavior:
- HyTDE listens for the specified events on the form controls and triggers the same fetch submission as a normal form submit.
- For search/live filtering, `hy-history="replace"` is recommended to avoid pushing a history entry for every keystroke.
- If the form is invalid according to native HTML constraint validation, HyTDE SHOULD skip auto-submission (to avoid spamming requests with invalid values).

IME handling:
- During IME composition, HyTDE MUST NOT auto-submit on intermediate `input` events.
- The “commit point” for auto-submit during/after composition is configurable:
  - Default: `compositionend` schedules an auto-submit (subject to debounce).
  - Optional: defer until `blur` (useful if you prefer to submit only after the user leaves the field).

Configuration:
- `hy-submit-compose="end|blur"`:
  - `end` (default): submit on `compositionend`
  - `blur`: submit on `blur` instead of `compositionend`

## 4.2 Form state (autosave + leave guard)

HyTDE supports autosave and leave-guard behavior via `hy-form-state`.

Declaration string:
```
hy-form-state="mode: autosave-guard; duration: 500"
```

Supported keys:
- `mode`: `autosave-guard`, `autosave`, `guard`, `off` (default).
- `duration`: debounce in milliseconds for autosave (default 500).

Eligibility:
- The owner is the form if it has `hy-form-state`; otherwise the single submit action element with `hy-form-state`.
- The form must also have a request trigger (`hy-get`/`hy-post`/`hy-put`/`hy-delete`) on the form or submit action element.

Exclusions:
- If an input-like control (`input`, `select`, `textarea`) inside the form has an action-triggered request (`hy-get`/`hy-post`/`hy-put`/`hy-delete`), HyTDE MUST emit an error and disable autosave/guard for that form (optimistic UI pattern).
- `<hy-get>` elements used for candidate/preset retrieval remain allowed.

Autosave:
- On control changes, HyTDE snapshots the form after the debounce window and stores to `localStorage`.
- Storage key: `{pathname}:{ownerId}` (query string excluded); missing `id` is an error and disables autosave.
- Draft payload includes `savedAt` (UTC ISO string) and `data` (JSON form snapshot); file inputs are excluded.
- When a request is triggered from the form or submit action, HyTDE clears the draft.

Restore:
- If a draft exists on load, HyTDE prompts: “YYYY-MM-DD HH:MM に送信せずに入力された値があります。復元しますか？”.
- Restore runs only on confirmation; decline keeps the draft until an explicit clear.

Leave guard:
- When `mode` includes guard and the form is dirty, HyTDE prompts on navigation.
- Canceling the prompt MUST prevent navigation.

## 5. Filling forms from data

Some flows fetch a record and populate a form. HyTDE should support a simple, form-level mechanism to fill descendant controls from a selected object.

### 5.1 `hy-fill` (recommended)

`hy-fill="<selector>"` may be placed on a `<form>` element. The selector must resolve to an object (the “fill source”).

Example:
```html
<form hy-fill="current.user">
  <label>
    Email
    <input name="email" type="email" />
  </label>
  <label>
    Role
    <select name="role">
      <option value="member">Member</option>
      <option value="staff">Staff</option>
      <option value="admin">Admin</option>
    </select>
  </label>
</form>
```

#### Mapping rule

For each descendant form-associated control that has a `name` attribute, HyTDE looks up a value from the fill source:
- If `name` contains dots (e.g. `profile.email`), treat it as a path in the fill source (object traversal).
- Otherwise, treat it as a top-level key.

If the key/path is missing or resolves to `null`, HyTDE MUST leave the control unchanged.

#### Control types

`<input>` / `<textarea>`:
- Set the control’s `.value` to the stringified fill value.

Checkbox:
- If the fill value is boolean, set `.checked` to that boolean.
- Otherwise, treat the fill value as a “selected value”:
  - if the fill value is an array, `.checked = array.includes(input.value)`
  - if scalar, `.checked = (String(fillValue) === input.value)`

Radio group:
- For radios sharing the same `name`, check the one whose `value` matches the fill value (string compare).

`<select>`:
- Single select: select the option whose `value` matches the fill value (string compare).
- Multiple select: if the fill value is an array, select options whose values are included.

#### When filling happens (proposal)

- On initialization (when HyTDE executes), HyTDE SHOULD apply `hy-fill` once.
- When the fill source changes (e.g. because `hy-store` updated), HyTDE MAY apply `hy-fill` again.

Open question (important):
- Should HyTDE skip filling controls that the user already edited (“dirty” controls) to avoid overwriting user input?

#### Server rendering compatibility

This must work in server rendering too by emitting equivalent HTML state:
- set `value="..."` for inputs/textareas (where appropriate)
- set/remove `checked` for checkbox/radio
- set/remove `selected` on `<option>`

## 6. Example: search → results list (no navigation)

```html
<form
  hy-get="/api/users/search"
  hy-history="sync-push"
  hy-store="current"
  hy-unwrap="data"
>
  <input name="q" placeholder="name/email" />
  <button type="submit">Search</button>
</form>

<section>
  <p hy-if="current.users">Results</p>
  <p hy-else>No results</p>
  <ul>
    <li hy-for="u of current.users">
      <a hy-attr-href="/users/[userId]/show.html#userId={u.id}">
        <span hy="u.name"></span>
      </a>
    </li>
  </ul>
</section>
```

Notes:
- The API returns `{ "data": { "users": [...] } }` and the form unwraps it into `current`.
- The subtree re-renders based on the stored response data.

## Open Questions

1. When writing to `hy-store`, should the namespace be replaced entirely or merged (shallow/deep)?
2. Should we support HTML fragment responses (`text/html`) as an alternative to JSON for some flows?
