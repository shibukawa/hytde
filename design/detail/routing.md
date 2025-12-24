# HyTDE Routing & Path Parameters (Draft)

HyTDE templates are plain `.html` files. This document defines a URL/file-friendly way to express path parameters so pages can work across:
- static file servers,
- browser-only runtimes (CDN),
- and server rendering (Go, etc.).

For a broader summary of link and form navigation behavior, see `design/navigation.md`.

## 1. Route Template Syntax (Next.js-like)

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

This is used to extract `hyParams` when the page is accessed via a canonical URL (e.g. `/users/100/show.html`).

## 3. Parameter Transport Strategies

HyTDE supports two equivalent ways to carry parameters:

### 3.1 Hash parameters (static-friendly)

This works on a simple static server because the request path points to a real template file:

`/users/[userId]/show.html#userId=100`

### 3.2 Canonical path parameters (backend-friendly)

In full server modes (or prebuilt output), links may be rewritten to canonical paths:

`/users/100/show.html`

The page can still extract `hyParams.userId` by matching `location.pathname` against the declared `hy-path` route template.

## 4. Extracting `hyParams`

`hyParams` is a global variable available to selectors.

Default extraction algorithm (recommended):
1. Start with `{}`.
2. If `<meta name="hy-path" ...>` exists, match `location.pathname` to it and extract `[param]` segments.
3. Merge `location.search` query params (override previous keys).
4. Merge `location.hash` params in `#k=v&k2=v2` form (override previous keys).

All extracted values are URL-decoded (UTF-8).

## 5. Generating Links in Templates

To keep templates valid HTML and support static servers, templates SHOULD generate links using a route template plus hash params:

```html
<a hy-attr-href="/users/[userId]/show.html#userId={user.id}">Profile</a>
```

In optimized/server modes, engines MAY rewrite this to the canonical path form:
- Input: `/users/[userId]/show.html#userId=100`
- Output: `/users/100/show.html`

## 6. Notes

- `{...}` interpolation uses HyTDE’s URL-encoding rules for URL-valued attributes.
- `[param]` placeholders are treated as literal text unless an engine explicitly rewrites them during build/server rendering.

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

### 7.2 `hyParams` extraction

This server does not need to inject parameters: the page already declares its route template via:
```html
<meta name="hy-path" content="/users/[userId]/show.html">
```

So when the browser loads `/users/100/show.html`, `hyParams.userId` can be extracted from `location.pathname` per this spec.

### 7.3 Relationship to link generation

With a route-fallback server, templates may use canonical paths directly in plain HTML:
```html
<a href="/users/100/show.html">Profile</a>
```

Without it (pure static hosting), prefer route-template + hash params:
```html
<a href="/users/[userId]/show.html#userId=100">Profile</a>
```

Build/SSR engines may still rewrite route-template+hash links into canonical paths (see section 5).
