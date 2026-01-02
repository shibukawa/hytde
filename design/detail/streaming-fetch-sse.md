# Streaming Fetch and SSE

## Goals
- Provide incremental data updates via `hy-get-stream` (chunked JSON).
- Provide live updates via `hy-sse` (EventSource).
- Keep HTML-first templates; data always stored with `hy-store`.
- Ensure `hy-for` can append items as streaming data arrives.

## Directives

### hy-get-stream
```html
<section hy-get-stream="/api/stream" hy-store="items">
  <ul>
    <li hy-for="item of items">...</li>
  </ul>
</section>
```

#### Sample HTML (append)
```html
<section hy-get-stream="/api/orders/stream" hy-store="orders">
  <ul>
    <li hy-for="order of orders">
      <span hy="order.id">#id</span>
      <span hy="order.status">status</span>
    </li>
  </ul>
</section>
```

### hy-sse
```html
<section hy-sse="/api/events" hy-store="events">
  <ul>
    <li hy-for="event of events">...</li>
  </ul>
</section>
```

#### Sample HTML (append)
```html
<section hy-sse="/api/summary" hy-store="summary">
  <p>
    <strong>Status:</strong>
    <span hy="summary.last.status">unknown</span>
  </p>
</section>
```

## Behavior

### hy-get-stream (chunked JSON)
- Uses `fetch()` with streaming response body.
- Each chunk is parsed as JSON (object or array item).
- Parsed items are appended to the store path declared by `hy-store`.
- `hy-for` loops bound to that store path append new rows as items arrive.
- If a chunk cannot be parsed yet, it is buffered until a complete JSON value is available.
- Initial load gating:
  - Optional attributes: `hy-stream-initial` (number) and `hy-stream-timeout` (ms).
  - Default `hy-stream-initial` is 0 (no wait).
  - If set, initial render waits until the initial count is reached or the timeout elapses.
  - SSR should apply the same initial gating (collects items up to count/timeout before render).

### hy-sse (EventSource)
- Uses `new EventSource(url)`.
- `message` events parse `event.data` as JSON and store to `hy-store`.
  - Append to array store (no replace behavior). `summary.last` is available for latest element access.
- `error` events push an entry to `hy.errors`.
- Initial load gating:
  - Optional attributes: `hy-stream-initial` (number) and `hy-stream-timeout` (ms).
  - Default `hy-stream-initial` is 0 (no wait).
  - If set, initial render waits until the initial count is reached or the timeout elapses.
  - SSR should apply the same initial gating (collects items up to count/timeout before render).

## Mock Behavior
- Streaming mocks use the same `meta[name="hy-mock"]` rules defined in `design/detail/fetching.md`, backed by MSW in mock mode.
- For `hy-get-stream` mock data:
  - If mock result is an array, emit one element every 0.2s.
  - Each emitted element is treated as an individual chunk.
- For `hy-sse` mock data:
  - The same array-based mock payload is emitted as sequential SSE messages.

### Sample Mock JSON (root array)
```json
[
  { "id": "A-100", "status": "new" },
  { "id": "A-101", "status": "processing" },
  { "id": "A-102", "status": "shipped" }
]
```

```json
[
  { "status": "healthy" },
  { "status": "degraded" }
]
```

## Store Semantics
- Writes follow existing rules: replacements by default.
- For streaming items, append semantics are used for array targets only.
- Deduping across SSR + hydration:
  - Optional attribute: `hy-stream-key` (selector key name).
  - During hydration, client runtime fetches again but skips items whose key already exists from SSR.
  - Key comparison uses strict equality on the resolved key value.
- Scope resolution remains lexical: loop vars > store namespaces > globals.

## Error Handling
- Stream parse errors push to `hy.errors` and stop the stream.
- SSE errors push to `hy.errors` and keep the connection (per EventSource behavior).

## Notes
- Table integration should use plugins to subscribe to stream updates.
- Streaming features should not require JS templating; only `hy-*` directives.
