# Fetching & Deduplication (Draft)

This document specifies the behavior of `hy-get` (and related fetch directives) regarding request deduplication and debug-time mocking.

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

Notes:
- Multiple `<meta name="hy-mock" ...>` tags may be declared; they are evaluated in document order.
- `pattern` matching is performed against the resolved URL **pathname only** (no query-string matching in v1).
- Parameter extraction from `[param]` segments is **not** used for fixture selection in v1 (mocks are intentionally simple).

Parsing:
- The `content` value is parsed as a whitespace-separated list of `key=value` pairs.
- For convenience, `pattern:` is accepted as an alias of `pattern=` (e.g. `pattern:/api/...` or `pattern: /api/...`).
- Unknown keys are ignored.

### 2.3 Matching and response

When `hy-mode=mock` and a HyTDE request is about to be issued (`hy-get`, `hy-post`, `hy-put`, `hy-patch`, `hy-delete`):
1. HyTDE evaluates mock rules in document order.
2. If `method` matches and `pattern` matches the request URL pathname, HyTDE loads and parses the JSON from `path`.
3. The parsed JSON is used as if it were the server response payload for that request.

If no rule matches, HyTDE performs a real network fetch as usual.

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
