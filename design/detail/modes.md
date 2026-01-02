# HyTDE Modes (Draft)

This document summarizes how HyTDE directives behave across development and runtime modes, and includes a practical **How to Prototype** guide for working “static HTML first”.

Important: HyTDE has two orthogonal “mode” dimensions:
- **Execution mode** (`<meta name="hy-mode" ...>`): whether HyTDE executes, and whether it uses mocks.
- **Rendering / delivery strategy** (CDN runtime vs Vite build vs SSR vs SPA): how the app is shipped and rendered in production.

## Summary Table

| Strategy | Typical Use | Runtime Present | Execution (`hy-mode`) | Dummy aids | `hy-import` | Page params | Notes |
|---|---|---:|---|---|---|---|---|
| Static Design (HTML-only) | Designer creates layouts as plain HTML | No | N/A | `hy-dummy` (attribute) for placeholder nodes; `<!-- hy-get-dummy: ... -->` for documenting dummy JSON | Not used (assume manual inline markup) | N/A | No fetching, no import resolution, no directive execution. |
| Simple Runtime (Browser via CDN) | Run the same HTML in the browser with a small runtime | Yes (JS) | `production` | `hy-dummy` removed; `hy-get-dummy` not a fallback | Resolved at runtime by replacing `<hy-import>` with fetched/loaded HTML | Hash params (`#userId=100`) recommended | Uses `design/routing.md` conventions; intended for CDN-delivered production apps. |
| Simple Runtime + Mock (Browser via CDN) | Same infra as production, but mocked API responses | Yes (JS) | `mock` | Same as Simple Runtime | Same as Simple Runtime | Hash params (`#userId=100`) recommended | Enable with `<meta name="hy-mode" content="mock">` + `<meta name="hy-mock" ...>` per `design/fetching.md`; useful for staging/demo on the same static hosting. |
| Route Fallback HTTP Server (proposal) | Serve canonical URLs with route-template files | Optional | Any (if runtime loaded) | Same as the chosen runtime strategy | Same as the chosen runtime strategy | Canonical paths (`/users/100/...`) | Requests like `/users/100/show.html` are served by falling back to `/users/[userId]/show.html` (URL unchanged); see `design/routing.md`. |
| Vite Build: Static-Optimized HTML | Frontend-only, but pre-optimized output | Yes (JS) | `production` | `hy-dummy` removed; `hy-get-dummy` typically stripped | **Inlined at build time** (output HTML already contains imported DOM) | Canonical path params (`/users/100/...`) recommended | Build MAY rewrite route-template+hash links into canonical paths. |
| Vite Build: SPA | Client-side navigation without full reload | Yes (JS) | `production` | `hy-dummy` removed; `hy-get-dummy` typically stripped | Usually inlined at build time | Canonical path params (`/users/100/...`) recommended | Templates are compiled into JS render modules + shared runtime; described in `design/vite-modes.md` (SPA mode). |
| Server Render (Non-JS, e.g. Go) | Same template rendered on the server | No (JS) | `production` | `hy-dummy` removed; `hy-get-dummy` ignored | Resolved on the server by replacing `<hy-import>` before continuing processing | Canonical path params (`/users/100/...`) recommended | Server rendering outputs fully replaced/expanded HTML; links may be canonicalized. |

## Key Rules (Cross-Mode)

- Templates remain valid HTML (`.html`) in all modes.
- `hy-import` semantics are always “replace in place”; only the *time* of replacement differs (build, browser, or server).
- `hy-dummy` elements are removed when HyTDE runs; they exist to support static design-time layout workflows.
- `hy-get-dummy` comments are not a network-failure fallback.

## Execution Mode Selection (`hy-mode`)

When the HyTDE runtime is present, execution is controlled by:

```html
<meta name="hy-mode" content="production">
```

Values:
- `production` (default if omitted): normal execution with real network requests.
- `mock`: execute HyTDE but serve matching requests from mock fixtures (see `design/fetching.md`).
- `disable`: runtime is loaded but MUST NOT execute directives or mutate the DOM.

Note:
- `hy-mode="production"` does not imply a specific rendering strategy. Production can be delivered as CDN runtime, Vite-built static-optimized HTML, Vite-built SPA, or server rendering; the difference is *how the template is processed and shipped*, not the execution mode value.

## How to Prototype (Static HTML First)

HyTDE templates should remain useful even when the HyTDE runtime is not running. This section describes recommended patterns for prototyping and layout testing in **plain static HTML**, while still keeping the same file usable as a real HyTDE template later.

### Prototyping Levels (recommended workflow)

1. **Design (no HyTDE)**: do not load the HyTDE runtime; design as static HTML.
2. **Markup (HyTDE markup, no execution)**: add `hy-*` attributes and prototyping markers, but do not execute HyTDE (either by not loading the runtime or by setting `hy-mode=disable`).
3. **Mock (debug execution)**: run HyTDE in mock mode to validate interactions without a real backend.
4. **Production (real backend)**: run HyTDE against the real server.

### 1) Placeholder Nodes (`hy-dummy`)

Use `hy-dummy` for placeholder elements that exist only for layout testing.

- In static HTML (HyTDE not running), `hy-dummy` elements remain visible.
- When HyTDE runs (browser/build/server), `hy-dummy` elements are treated as `hy-if="false"` and removed.

Example (list layout testing):
```html
<ul>
  <li hy-for="team of current.user.teams"><span hy="team.name">Dummy team 1</span></li>
  <li hy-dummy><span>Dummy team 2</span></li>
  <li hy-dummy><span>Dummy team 3</span></li>
</ul>
```

### 2) Conditional Prototyping (`hidden="hy-ignore"` on if/else chains)

In pure static HTML, all conditional branches (`hy-if`, `hy-else-if`, `hy-else`) exist in the DOM and would normally all render at once. To avoid this while prototyping, hide branches using `hidden="hy-ignore"`.

Runtime behavior:
- When HyTDE evaluates a conditional chain and selects the branch to render, it MUST remove `hidden` from the chosen branch **only if** the attribute value is empty or equals `hy-ignore`.
- Non-selected branches are removed as usual.
- This “unhide” behavior applies **only** to `hy-if` / `hy-else-if` / `hy-else` branches (not general elements).

Example:
```html
<p hy-if="current.user.isAdmin" hidden="hy-ignore">Admin</p>
<p hy-else-if="current.user.isStaff" hidden="hy-ignore">Staff</p>
<p hy-else hidden="hy-ignore">Member</p>
```

Notes:
- Prefer `hidden="hy-ignore"` over `style="display: none"` so the intent is obvious and doesn’t mix presentation with markup.
- Avoid using reserved `hidden="until-found"` for this purpose.

### 3) Cloaking Until HyTDE Is Ready (`hy-cloak`)

Some UIs should remain hidden until HyTDE has executed bindings and/or resolved conditionals (classic “hide until JS loads”).

Important nuance:
- `hidden` hides content even when HyTDE is not running, which is undesirable for “open the HTML file and see it” prototyping.

Recommended pattern:
- Mark the region with `hy-cloak` (a HyTDE-specific attribute).
- Cloaking is only active when the page includes a CSS rule for it (typically injected by a build tool like Vite, or by the runtime bootstrap in JS-enabled deployments).
- When HyTDE finishes boot/hydration, it MUST remove the `hy-cloak` attribute from cloaked elements.

Example (authoring in templates):
```html
<body hy-cloak>
  ...
</body>
```

Example (build/runtime injected CSS; not required in the source template):
```html
<style>
  [hy-cloak] { display: none !important; }
</style>
```

### 4) Dummy Data Documentation for Requests (`<!-- hy-get-dummy: ... -->`)

For describing expected server responses during static design, you may place a comment dummy near a request element:

```html
<hy-get src="/api/users/{hyParams.userId}"></hy-get>
<!-- hy-get-dummy: { "user": { "id": 1, "name": "Alice" } } -->
<section>
  ...
</section>
```

This is documentation/external-tooling oriented; HyTDE execution must not treat it as a network fallback.

### 5) Import During Prototyping

During static design time, avoid relying on `hy-import` (since no runtime/build/server is resolving it). Prefer copying the HTML inline or using editor tooling.

In runtime/build/server modes, `hy-import` is resolved by in-place replacement per `design/template-import.md`.

## Future Modes (Vite-powered)

HyTDE intends to support additional build-time modes via a Vite plugin. These modes are described in `design/vite-modes.md`.
