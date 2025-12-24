# Navigation (Links and Forms) (Draft)

HyTDE templates are plain `.html` files and should remain usable without the HyTDE runtime. This document summarizes navigation semantics for:
- `<a href="...">` link navigation, and
- `<form method="..." action="...">` submission navigation,
plus how HyTDE request directives change those behaviors.

Related specs:
- Route templates and `hyParams`: `design/routing.md`
- Fetch-only forms and history sync: `design/forms.md`

## 1. Goals

- Keep templates functional on a simple static file server.
- Keep navigation predictable in browser runtime and server-render modes.
- Allow optional SPA-style navigation in future build/runtime modes without changing authored templates.

## 2. Links (`<a href="...">`)

### 2.1 Baseline (plain HTML)

`<a href="...">` navigates to the target URL as normal HTML.
This is the preferred baseline behavior for static design and SSR.

### 2.2 Static-friendly parameter transport

To keep links working on a static server while still carrying parameters, prefer:
- a route-template filename (so the URL points to a real `.html` file), and
- hash parameters (so the parameter values do not require a backend rewrite).

Example (route template + hash param):
```html
<a href="/users/[userId]/show.html#userId=100">Profile</a>
```

For dynamic links inside HyTDE-rendered lists, use `hy-attr-href` so interpolation can happen at runtime:
```html
<a hy-attr-href="/users/[userId]/show.html#userId={current.user.id}">Profile</a>
```

Notes:
- Hash param format is `#k=v&k2=v2` (see `design/routing.md` for `hyParams` extraction order).
- `{...}` interpolation in URL-valued HyTDE attributes is URL percent-encoded per token (see `design/template-language.md`).

### 2.3 Canonical paths (server / SPA-friendly)

In server-render or optimized build modes, engines MAY rewrite static-friendly links into canonical paths:
- Input: `/users/[userId]/show.html#userId=100`
- Output: `/users/100/show.html`

With an optional route-fallback HTTP server, canonical paths can also work without rewriting (the server maps `/users/100/show.html` to the on-disk template `/users/[userId]/show.html` at serve time). See `design/routing.md`.

Future (SPA mode):
- A router can intercept same-origin link clicks and perform in-app navigation, while still supporting the authored template form above.

## 3. Forms (`<form>`)

### 3.1 Baseline navigation (plain HTML)

If a form has only standard HTML attributes:
- `method="get"` + `action="..."` navigates to the action URL and encodes fields into the query string.
- `method="post"` + `action="..."` submits and navigates to the response (server-defined).

This is the recommended baseline for SSR/MPA behavior and static prototyping.

### 3.2 HyTDE request directives (fetch-only by default)

If a form has any of these attributes:
- `hy-get`, `hy-post`, `hy-put`, `hy-patch`, `hy-delete`

then HyTDE treats submission as **fetch-only**:
- It performs a fetch to the directive URL.
- It does **not** navigate by default.
- The intended pattern is “store response via `hy-store`, then rerender consumers”.

See `design/forms.md` for request serialization, `hy-store`, and `hy-history`.

### 3.3 Optional navigation after fetch (`hy-redirect`) (proposal)

Some flows want “submit via fetch, then move to another page” (e.g. create → show).

Proposal: `hy-redirect` opts into navigation after a fetch-only request completes successfully.

Two forms:

1) Follow server redirect (boolean marker):
```html
<form hy-post="/api/users" hy-send-in="json" hy-redirect>
  ...
</form>
```
Behavior (proposal):
- If the response is an HTTP redirect with a `Location` header, HyTDE navigates to that URL.
- Otherwise, no navigation occurs.

2) Navigate to an explicit URL:
```html
<form
  hy-post="/api/users"
  hy-send-in="json"
  hy-redirect="/users/[userId]/show.html#userId={current.createdUserId}"
>
  ...
</form>
```
Behavior (proposal):
- After a successful response (2xx), HyTDE navigates to the resolved `hy-redirect` URL.

Navigation method (proposal):
- Default uses `location.assign(...)`.
- A future extension may add `hy-redirect-mode="assign|replace"` for history control.

Open questions:
- Do we require `hy-store` for `hy-redirect` (so the redirect URL can reference stored response data)?
- Should following redirects be the default when `hy-redirect` is present, even for 2xx responses with a JSON `{ redirectTo: ... }` body?
