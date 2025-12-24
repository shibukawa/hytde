# HyTDE Blueprint (Design North Star)
1. Templates are valid `.html` (designable without tools); initial UI is never “built by JS”.
2. HyTDE adds behavior only via `hy-*` attributes/elements; no template-side scripting language.
3. Same template must work across: static HTML viewing, browser runtime, build output, and non-JS server rendering.
4. Reuse is HTML-first: `<hy-import>` replaces in place; imported files export nodes via `hy-export` (assets can be merged).
5. Data is explicit: requests never create implicit scopes; responses are stored via `hy-store` into `hyState.<namespace>`.
6. Store writes are replacement (no merge); templates reference data via simple selectors + `|>` transforms.
7. Scope resolution is lexical: loop vars (`hy-for`) > store namespaces > reserved globals.
8. URL interpolation `{...}` is percent-encoded per token; there is no unsafe raw HTML insertion.
9. Conditional/loop directives are attribute-based: `hy-if`/`hy-else-if`/`hy-else` (Vue-like), `hy-for="x of y"`.
10. Prototyping is first-class: `hy-dummy` for placeholders, `hidden="hy-ignore"` for if/else preview, `hy-cloak` for optional FOUC prevention.
11. Modes are orthogonal: execution mode (`hy-mode=production|mock|disable`) vs delivery strategy (CDN runtime, Vite static-optimized, Vite SPA, SSR).
12. Fetching: GET dedupe is Next.js-like within a render scope; no retries in v1; mock fixtures via `<meta name="hy-mock" ...>`.
13. Request state is global: `hy.loading` and `hy.errors[]`; default error UI appears if the template doesn’t handle errors.
14. Forms: plain HTML navigation is the baseline; adding `hy-get`/`hy-post`… makes it fetch-only (no navigation), optional `hy-redirect` for post-submit navigation.
15. Search UX: `hy-history` supports URL↔form sync and auto-run; auto-submit uses debounce and IME-aware rules.
16. Form filling is declarative: `hy-fill` on `<form>` maps an object into descendant controls by `name`.
17. Dynamic islands are allowed after render: tables, combobox, validators; they bind to store paths and can emit `hy.on(...)` events.
18. Table integration is attribute-defined: `hy-table-data` is a unique key; `hy-edit-mode` controls behavior; commit submit can be `diff` (default) or `all`.
19. Security model prefers web defaults: imports/fetching follow normal browser constraints (CORS, etc.); cookies/auth exposure remains conservative.
20. Implementation bias: keep runtime small and predictable; prefer simple rerender/namespace-level dependency tracking over heavy incremental DOM.

