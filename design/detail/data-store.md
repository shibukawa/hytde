# Data Store & Response Mapping (Draft)

This document defines how HyTDE stores server responses into a **named namespace** so templates can consume data explicitly (no implicit DOM-based namespaces).

## 1. Data store concept

HyTDE maintains an in-memory data store with named namespaces:
- `hyState.<namespace>`

Optionally, when a namespace is written, HyTDE exposes a top-level alias variable of the same name for selectors:
- `current.users` is an alias for `hyState.current.users`

This is intended for convenience in templates, but projects should choose namespace names carefully to avoid collisions.

## 2. Writing to a namespace (`hy-store`)

Any HyTDE request directive (`hy-get`, `hy-post`, `hy-put`, `hy-patch`, `hy-delete`) MAY specify a storage namespace:

```html
<form hy-get="/api/users/search" hy-store="current">...</form>
```

Behavior:
- HyTDE stores the response payload into `hyState.current`.
- HyTDE triggers a rerender pass so bindings that reference `current`/`hyState.current` update.
- Store updates are **replacement** by default: writing to a namespace replaces the previous value entirely.

Reserved namespace names:
- Implementations MUST reserve names used for globals and runtime state and reject using them as `hy-store` targets.
- In particular, any namespace that starts with `hy` is reserved (e.g. `hy`, `hyState`, `hyParams`, `hyAuth`).
  - Rationale: HyTDE uses the `hy*` prefix for its own globals and internal state; allowing `hy-store="hy..."` would create confusing collisions.

## 3. Unwrapping responses (`hy-unwrap`)

Many APIs wrap responses (e.g. `{ "data": {...} }`). To avoid `data` noise in templates, requests may unwrap a top-level field before storing:

```html
<form
  hy-get="/api/users/search"
  hy-store="current"
  hy-unwrap="data"
>
  ...
</form>
```

Rules:
- `hy-unwrap="<key>"` extracts `response[key]`.
- If the key does not exist, the unwrapped payload becomes `{}` (object) for store purposes.
- `hy-unwrap` is applied before any other processing (like schema validation, if present).

## 4. Rerender trigger

When a namespace is updated:
- HyTDE MUST update bindings and structural directives (`hy-if`, `hy-for`, etc.) that depend on the new data.
- Implementations MAY rerender the whole document for simplicity, or perform dependency-based rerenders.

Dependency tracking (implementation note):
- Implementations may build an internal observer list that maps “data paths read by directives/components” to affected DOM regions.
- Examples of consumers:
  - `hy-if` / `hy-for` selectors (e.g. `current.users`)
  - tables via `hy-data` (e.g. `hy-data="current.users"`)
  - other dynamic components that bind to store paths

## 5. Example

Response:
```json
{ "data": { "users": [{ "id": 1, "name": "Alice" }] } }
```

Markup:
```html
<form hy-get="/api/users/search" hy-store="current" hy-unwrap="data">
  <input name="q" />
  <button type="submit">Search</button>
</form>

<section>
  <p hy-if="current.users">Results</p>
  <p hy-else>No results</p>

  <ul>
    <li hy-for="u of current.users">
      <span hy="u.name"></span>
    </li>
  </ul>
</section>
```

## Open Questions

1. Should `hy-store` allow dotted namespaces (e.g. `hy-store="page.search"`), or only single identifiers?
2. Should we support deeper extraction than `hy-unwrap` (e.g. `hy-extract="data.users"`)?
