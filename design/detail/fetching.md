# Fetching & Deduplication (Draft)

This document specifies the behavior of `hy-get` (and related fetch directives) regarding request deduplication and debug-time mocking.

## 0. Fetch Declaration Styles

HyTDE supports two declaration styles for `hy-get`:
- Attribute form: `hy-get="/api/..."` on a container element (existing behavior).
- Element form: a dedicated `<hy-get>` tag (preferred for multiple requests per form).

The element form enables multiple requests within a single form or section without overloading a single element with multiple directives.

Example (form with multiple requests):
```html
<form>
  <hy-get src="/api/summary" store="summary"></hy-get>
  <hy-get src="/api/results" store="results"></hy-get>
  <!-- form controls -->
</form>
```

### 0.1 Hoisting scope for `<hy-get>`

For `<hy-get>`, the request scope is hoisted to its parent element:
- The parent element is treated as the scope root for selectors and `hy-store` usage.
- The `<hy-get>` element itself does not render content; it is an instruction only.
- Multiple `<hy-get>` elements under the same parent run in parallel on initial render and on form submit.

If a `<hy-get>` is placed directly under `<form>`, it still behaves like a startup request. Remember: in-form `<hy-get>` is intended for preset data (used with `hy-fill`) and is **not** tied to submit behavior.

If a `<hy-get>` is placed under a non-form parent, it behaves like a startup request and runs during initial render.

Note:
- Attribute form still behaves as a container-scoped request (current behavior).
- Mixed usage is allowed but discouraged within the same container.

### 0.2 Forms and element placement

- Form actions continue to use attribute form (`hy-get`, `hy-post`, etc.) on `<form>` as the primary mechanism.
- `<hy-get>` inside `<form>` is reserved for preset data fetching to drive form fills (not submit).
- When using `<hy-get>`, fill-related attributes are unprefixed (e.g. `fill`, `fill-into`), because the element itself already scopes to HyTDE.
  - `fill-into` takes a CSS selector string (e.g. `fill-into="#user-form"`).
  - `fill-into` is optional; if omitted, no default fill target is assumed.
- Attribute `hy-get` executes on form action/submit; tag `<hy-get>` executes during startup load.
- For flexibility, request attributes MAY also be allowed on `<button>`/`<input type="submit">` elements when their semantics are clearly defined (future clarification).
- `<hy-get>` remains the preferred tag form for startup data fetches outside form submission.

### 0.4 Form submission encoding (non-GET)

For non-GET (`hy-post`/`hy-put`/`hy-patch`/`hy-delete`) submissions:
- If the form has **no** `enctype` attribute and no file inputs, HyTDE sends `application/json` with a JSON body.
- If the form has file inputs, HyTDE uses `multipart/form-data` (regardless of `enctype`).
- If `enctype="application/x-www-form-urlencoded"` is explicitly set, HyTDE sends URL-encoded form data.
- If `enctype="multipart/form-data"` is explicitly set, HyTDE sends multipart form data.

### 0.3 Scope-aware access diagnostics (proposal)

When a selector fails to resolve due to scope boundaries, HyTDE SHOULD emit a diagnostic that distinguishes:
- **Scope miss** (the name exists in another scope but is not accessible here)
- vs. **Missing data** (the name does not exist anywhere)

Example message:
> “`current.user` is out of scope here. Move the `hy-get` closer to this template or declare another `hy-get`. If the URL is the same, HyTDE will dedupe and issue only one request.”

Implementation guidance:
- Track scopes as pairs of `(name, scopeRoot)` at parse time so a lookup can tell “name exists but in a different scope”.
- Surface scope-miss diagnostics into `hy.errors` so the default error UX can surface them.

Form fill binding:
- If multiple responses target the same form, later fill operations win (last-write-wins).

## 1. Request Deduplication (Next.js-like)

HyTDE SHOULD avoid issuing duplicate requests when multiple `hy-get` directives resolve to the same URL within the same execution scope.

### 1.1 What is “the same request”

For `hy-get`, the request identity key is:
- method: `GET`
- resolved URL string (after `{...}` interpolation and URL-encoding)

Deduplication is defined for `GET` only (idempotent). Non-GET requests MUST NOT be deduped by default.

Future extensions (not in v1): headers, credentials mode, and varying by `Accept`/`Content-Type`.

### 1.2 Dedupe semantics

- If multiple `hy-get` nodes request the same URL while a fetch is in-flight, HyTDE MUST share the same in-flight promise/result.
- Once the response is resolved, HyTDE MAY reuse the cached response for subsequent identical `hy-get` requests within the same scope.

### 1.3 Scope (lifetime of the cache)

The cache lifetime depends on the execution environment, but should be consistent with “one render unit”:
- **Browser runtime**: the current document lifecycle (until navigation/reload).
- **Server render**: the current HTTP request lifecycle.
- **Build/pre-render**: the current page render job.

This is intentionally similar in spirit to Next.js `fetch` dedupe within a render pass.

## 2. Debug Mocking (Pattern → JSON file)

When prototyping, it is useful to return stable JSON payloads without building a backend. HyTDE can optionally provide a debug mocking facility controlled by the template.

### 2.1 Enabling

Debug mocking is enabled when the document is in mock mode:

```html
<meta name="hy-mode" content="mock">
```

When not in mock mode, all mock declarations are ignored.

### 2.2 Declaring mocks

Declare one or more mock rules using meta tags in the document head.

```html
<meta name="hy-mock" content="pattern=/api/users/[userId] path=./mocks/user.json">
```

Content keys:
- `pattern`: a URL pattern using `[param]` path segments (same style as `design/routing.md`).
- `path`: a JSON file path to load as the response payload. Resolved relative to the current template HTML location.
- `method` (optional): defaults to `GET`.
- `delay` (optional): delay in ms (or range `min-max`) for mock delivery. For streaming mocks, this delay is applied per item.

Notes:
- Multiple `<meta name="hy-mock" ...>` tags may be declared; they are evaluated in document order.
- `pattern` matching is performed against the resolved URL **pathname only** (no query-string matching in v1).
- Parameter extraction from `[param]` segments is **not** used for fixture selection in v1 (mocks are intentionally simple).

Parsing:
- The `content` value is parsed as a whitespace-separated list of `key=value` pairs.
- For convenience, `pattern:` is accepted as an alias of `pattern=` (e.g. `pattern:/api/...` or `pattern: /api/...`).
- Unknown keys are ignored.

### 2.3 Matching and response

When `hy-mode=mock` and a HyTDE request is about to be issued (`hy-get`, `hy-post`, `hy-put`, `hy-patch`, `hy-delete`, `hy-get-stream`, `hy-sse`, `hy-get-polling`):
1. HyTDE evaluates mock rules in document order.
2. If `method` matches and `pattern` matches the request URL pathname, HyTDE loads and parses the JSON from `path`.
3. The parsed JSON is used as if it were the server response payload for that request.

If no rule matches, HyTDE performs a real network fetch as usual.

### 2.4 Streaming mocks (hy-get-stream / hy-sse)

For streaming directives, mock payloads are treated as arrays where each element is delivered one-by-one.

```html
<meta name="hy-mock" content="pattern=/api/orders/stream path=/mocks/orders.json method=GET delay=500" />
<meta name="hy-mock" content="pattern=/api/summary path=/mocks/summary.json method=GET delay=500" />
```

Behavior:
- If the mock JSON is an array, each element is emitted sequentially.
- `delay` controls the interval between items (default 200ms if not set).
- This applies to both `hy-get-stream` and `hy-sse` in mock mode.

### 2.5 Tag form for stream / SSE / polling

Streaming and SSE use tag form (like `<hy-get>`). Options remove the `hy-` prefix.

```html
<hy-get-stream src="/api/orders/stream" store="orders" stream-initial="2" stream-timeout="1200" stream-key="id"></hy-get-stream>
<hy-sse src="/api/summary" store="summary" stream-initial="1" stream-timeout="1000" stream-key="status"></hy-sse>
```

Polling:
```html
<hy-get-polling src="/api/summary" store="summary" interval="1000"></hy-get-polling>
```

### 2.6 Polling mock behavior
- Mock payloads for polling are arrays.
- Each interval consumes the next element.
- `null` values are treated as "no content" (no store update).

### 2.4 Sharing across files/pages

Because `hy-get` requests are deduped, using a single mock rule for a URL will automatically serve all matching `hy-get` usages in the same scope.

To share mock rules across multiple templates/files, keep fixtures under a stable path and include the same `<meta name="hy-mock" ...>` declarations in each page (or inject them at build/server time; mechanism is project-defined).

## 3. Relationship to static design aids

- `hy-dummy` (attribute) is for placeholder DOM nodes and is removed when HyTDE runs. See `design/modes.md`.
- `<!-- hy-get-dummy: ... -->` comments are for design documentation/external tooling and are ignored by HyTDE execution. See `design/modes.md`.

## 4. Loading and Error State (Globals)

HyTDE exposes runtime state under the reserved `hy` global:
- `hy.loading`: boolean
- `hy.errors`: error object array (empty when no errors)

Intended use:
```html
<p hy-if="hy.loading">Loading...</p>
<p hy-if="hy.errors">Something went wrong.</p>
```

### 4.1 State transitions (proposal)

For any HyTDE-managed request (`hy-get`, forms with `hy-post`, etc.):
- before issuing the request: `hy.loading = true`, `hy.errors = []`
- on success: `hy.loading = false`, `hy.errors = []`
- on failure: `hy.loading = false`, `hy.errors = [<error object>]`

Error object fields are implementation-defined, but SHOULD include:
- `message` (string)
- `url` (string, resolved)
- `method` (string)
- `status` (number, optional)

Concurrency note (v1):
- If multiple requests are in flight, behavior is intentionally unspecified in v1 (last-write-wins is acceptable). This may be refined later.

No retries:
- HyTDE does not automatically retry failed requests in v1.

## 5. Default Error UI (proposal)

If the template does not provide any error handling UI, HyTDE SHOULD provide a default error popup when a request fails.

“Error handling UI exists” (v1 heuristic):
- any element in the document uses `hy-if="hy.errors"` (or `hy-else-if="hy.errors"`) OR
- an element with `id="hy-error"` exists

### 5.1 `#hy-error` popover integration (optional)

If the document contains an element with `id="hy-error"` and it has the `popover` attribute, HyTDE SHOULD open it when `hy.errors` becomes non-empty.

Example:
```html
<div id="hy-error" popover>
  <p><strong>Error:</strong> <span hy="hy.errors[0].message">Unknown</span></p>
  <p><span hy="hy.errors[0].method">GET</span> <code hy="hy.errors[0].url">/api/...</code></p>
  <button type="button" command="hide-popover" commandfor="hy-error">Close</button>
</div>
```

If no error UI is present, a minimal default can be:
- `alert(hy.errors[0]?.message || "Error")` (browser runtime), plus `console.error(hy.errors[0])`

## Open Questions

1. Should `pattern` match include query strings in addition to pathname?
2. Should dedupe cache persist across SPA navigation in browser runtime modes?
