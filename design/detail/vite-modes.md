# Vite-powered Modes (Future) (Draft)

This document sketches additional HyTDE modes enabled by a Vite plugin. These are **build-time** concerns and are orthogonal to runtime `hy-mode` (`production|mock|disable`).

Goals:
- Keep authoring as valid HTML templates.
- Make production static deployments faster and smaller.
- Enable optional SPA navigation by generating per-page JS modules from templates.

## 1. Build Outputs

### 1.1 Optimized Static HTML (production build)

Output:
- Optimized `.html` assets (still valid HTML).
- A JS runtime bundle (shared across pages) to execute HyTDE directives in the browser.
- Optional precomputed template/binding metadata to speed runtime.
- Tailwind-optimized CSS output (via Tailwind tooling; HyTDE plugin coordinates but does not replace Tailwind).

Recommended transformations:
1. **Inline `hy-import`**: resolve and replace `<hy-import>` so output is import-expanded (respecting `hy-export` selection; see `design/template-import.md`).
2. **Remove prototyping placeholders**:
   - remove elements with `hy-dummy`
   - strip `hidden="hy-ignore"` (it is a prototyping aid for conditionals, not a production mechanism)
   - remove design-only comments like `<!-- hy-get-dummy: ... -->`
2.5 **Default error UI injection (optional)**:
   - if the template provides no error handling UI (e.g. no `hy-if="hy.errors"` and no `#hy-error`), the build MAY inject a minimal default error popover/container and the runtime hook needed to show it (see `design/fetching.md`).
3. **Pre-parse templates** (optional):
   - parse selectors, `|>` pipelines, and `{...}` interpolations
   - cache compiled representations so runtime does less string parsing
4. **Route canonicalization** (optional):
   - rewrite route-template+hash links (`/users/[userId]/show.html#userId=100`) into canonical paths (`/users/100/show.html`)

Notes:
- This mode is still “static HTML production”; the runtime enhances after load.
- Cloaking: if the source template uses `hy-cloak` (recommended on `<body>`), the build SHOULD emit a small CSS rule like `[hy-cloak]{display:none!important}` into the production HTML, and the runtime should remove `hy-cloak` after it is ready. This keeps static authoring previews visible (no cloak CSS) while production avoids FOUC.

### 1.2 SPA Codegen Mode

Output:
- A JS bundle + per-route code-split modules generated from templates (render functions).
- Shared JS modules that can be reused across routes (e.g. validators, table integrations, common utilities), emitted as normal Vite chunks.
- A route manifest mapping URLs to modules (derived from file paths and/or `<meta name="hy-path">`).

Runtime behavior:
- Initial load renders the first route from the generated module (or hydrates SSR output if present).
- Navigation loads the next route module and reconstructs the view from the template-derived render function.
- Dynamic directives (`hy-get`, forms, tables, combobox) reuse the same fetch/data-store behavior; only navigation/rendering changes.

Recommended transformations:
1. Inline `hy-import` (respecting `hy-export` selection; see `design/template-import.md`)
2. Remove `hy-dummy` and design-only comments
3. Compile templates to JS render functions:
    - clone static DOM skeleton efficiently
    - apply bindings without string-based DOM building
   - compile `hy-if` / `hy-else-if` / `hy-else` chains into conditional DOM creation code
     - the compiler SHOULD attach a stable anchor marker before each chain (e.g. a hashed id) so updates can target the correct insertion point
4. Generate a route manifest for the client router

## 2. Vite Plugin Responsibilities (Sketch)

The plugin would:
- Discover templates in the project.
- Resolve `hy-import` paths relative to the current template file.
- Apply the chosen build pipeline (static optimized vs SPA codegen).
- Emit additional artifacts (route manifest, template cache files).

Suggested configuration surface (draft ideas):
- `mode: "static-optimized" | "spa"`
- `stripDummy: boolean`
- `stripGetDummyComments: boolean`
- `precompileBindings: boolean`
- `canonicalizeRoutes: boolean`

## 3. Relationship to Existing Specs

- Prototyping rules: `design/modes.md` (How to Prototype section)
- `hy-import`: `design/template-import.md`
- Routing: `design/routing.md`
- Data store: `design/data-store.md`

## Open Questions

1. Should SPA codegen keep `.html` as source-of-truth and generate `.js`, or allow authoring `.hy.html` with additional build hints?
2. How to handle dynamic islands (extable, validators) in SPA mode (same registry APIs, different lifecycle timing)?
3. How to keep server and browser template parsing consistent (shared parser library vs separate implementations)?
