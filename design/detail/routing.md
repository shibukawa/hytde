# HyTDE Routing & Navigation (Draft)

HyTDE templates are plain `.html` files. This document defines:
- route templates and path parameters,
- link navigation rules (including hash-mode fallback),
- and form navigation vs fetch-only requests.

## 1. Route Template Syntax

A **route template** is a path that may include parameter segments written as `[paramName]`.

Examples:
- `/users/[userId]/show.html`
- `/orgs/[orgId]/users/index.html`

The characters `[` and `]` are file-system friendly on common environments, allowing the template files/directories to exist as-is on a static server.

## 2. Declaring the Current Page Route

The current page SHOULD declare its route template:

```html
<meta name="hy-path" content="/users/[userId]/show.html">
```

This is used to extract path parameters when the page is accessed via a canonical URL (e.g. `/users/100/show.html`).

## 3. Path Mode Selection

Path mode is a single page-level flag:

```html
<meta name="hy-path-mode" content="path">
```

or

```html
<meta name="hy-path-mode" content="hash">
```

Defaults:
- If omitted, `hash` is assumed.
- No pattern or rules list is used.

`hash` mode only affects **global navigation** (`<a>` and `hy-redirect`).
It does not change request URLs (`hy-get`/`hy-post` etc.), which always resolve to canonical paths.

## 4. Extracting `hyParams`

`hyParams` is a global variable available to selectors.

Extraction rules:
1. Start with `{}`.
2. If `<meta name="hy-path" ...>` exists, match `location.pathname` to it and extract `[param]` segments.
3. Merge `location.search` query params (override previous keys).
4. Only if `location.pathname` matches the declared `hy-path` template exactly, merge `location.hash` params (`#k=v&k2=v2`) as an override.

This prevents hash params from leaking into unrelated pages.
All extracted values are URL-decoded (UTF-8).

Diagnostics:
- If both path and hash supply a value, the hash value wins.
- Missing placeholders emit a `path:param-missing` diagnostic and keep the placeholder intact.

## 5. Link Generation & Navigation

### 5.1 Baseline (plain HTML)

`<a href="...">` navigates to the target URL as normal HTML.
This remains the baseline for static design and SSR.

### 5.2 Template links with hash payload

In templates, write links using a route template and a hash payload:

```html
<a hy-href="/users/[userId]/show.html#userId={user.id}">Profile</a>
```

At render time, HyTDE resolves the placeholder and **generates canonical HTML**:
- Input: `/users/[userId]/show.html#userId=100`
- Output HTML: `/users/100/show.html`

This happens for `hy-href` and `hy-redirect`.

### 5.3 Navigation handling (hash mode)

In `hash` mode, HyTDE intercepts link clicks and performs a fetch-based probe:
1. Attempt `HEAD` or `OPTIONS` to `/users/100/show.html`.
2. If the response is 404, fall back to `/users/[userId]/show.html#userId=100`.
3. Otherwise, navigate to `/users/100/show.html`.

This provides static-friendly fallback while still preferring canonical paths.

### 5.4 Navigation handling (path mode)

In `path` mode, navigation always targets the canonical path:
`/users/100/show.html`.

## 6. Forms and Fetch-only Requests

### 6.1 Baseline navigation (plain HTML)

If a form has only standard HTML attributes:
- `method="get"` + `action="..."` navigates to the action URL and encodes fields into the query string.
- `method="post"` + `action="..."` submits and navigates to the response (server-defined).

### 6.2 HyTDE request directives (fetch-only by default)

If a form has any of these attributes:
- `hy-get`, `hy-post`, `hy-put`, `hy-patch`, `hy-delete`

HyTDE treats submission as **fetch-only**:
- It performs a fetch to the directive URL.
- It does **not** navigate by default.
- The intended pattern is “store response via `hy-store`, then rerender consumers”.

### 6.3 Optional navigation after fetch (`hy-redirect`)

Some flows want “submit via fetch, then move to another page” (e.g. create → show).

```html
<form
  hy-post="/api/users"
  hy-redirect="/users/[userId]/show.html#userId={current.createdUserId}"
>
  ...
</form>
```

Behavior:
- After a successful response (2xx), HyTDE navigates to the resolved `hy-redirect` URL.
- Redirects are resolved relative to the current document and blocked for cross-origin URLs.

Navigation method:
- In `hash` mode, the runtime intercepts and applies the same probe + fallback as links.
- In `path` mode, the runtime uses `location.assign(...)`.

## 7. Optional: Route Fallback HTTP Server (Proposal)

Static file servers cannot serve canonical paths like `/users/100/show.html` if the on-disk template is `/users/[userId]/show.html`. A small dedicated HTTP server can provide a “route fallback” behavior:
- keep authored templates on disk using `[param]` route-template filenames, and
- allow requesting canonical paths in the browser by mapping them to the template file at serve time.

This can be useful for:
- local development without a full backend router,
- CDN-like deployments that still allow a small edge/server component,
- production environments that want canonical URLs without SSR.

### 7.1 Serving behavior (recommended)

For an incoming request path `P`:
1. If a file exists at `P`, serve it.
2. Otherwise, attempt route-template fallback:
   - Find candidate template files whose path matches `P` when `[param]` segments are treated as wildcards for a single path segment.
   - Prefer the “most specific” match (fewest `[param]` segments; tie-breaker: deterministic, e.g. lexicographic).
   - Serve that template file’s content with the response URL unchanged (the browser address stays canonical).

Example:
- Request: `/users/100/show.html`
- Fallback template: `/users/[userId]/show.html`
- Served content: the bytes of `/users/[userId]/show.html` (URL remains `/users/100/show.html`)

Index handling (recommended):
- If the request is a directory path (e.g. `/users/100`), the server MAY attempt `/users/100/index.html` first, then apply the same fallback logic (`/users/[userId]/index.html`).
