# Combobox / Typeahead Pattern (Draft)

Business apps often need a combobox where:
- the candidate set is huge (10k+),
- preloading is not feasible,
- typing should show ~10 matches,
- network calls must be throttled/debounced,
- and stale responses must not overwrite newer input.

This document proposes a pattern that fits HyTDE’s “static HTML first, optional JS enhancement” philosophy.

## 1. Terminology

- **Typeahead**: suggestions appear as the user types.
- **Combobox**: an input with an associated list of suggestions and a selected value.

## 2. Options for UI primitives

### Option A: Native `<datalist>` (static prototyping, limited)

Markup:
```html
<label>
  User
  <input name="user" list="user-suggest" autocomplete="off" />
  <datalist id="user-suggest">
    <option value="Alice"></option>
    <option value="Bob"></option>
  </datalist>
</label>
```

Pros:
- Minimal markup, good baseline behavior.
- Works without JS (with static options).

Cons:
- Styling is very limited.
- No built-in “loading…” row.
- Behavior differences across browsers.

Notes:
- Updating `<datalist>` options at runtime generally updates suggestions in modern browsers, but the open suggestion UI may not refresh until the user types again / closes and reopens (implementation-dependent).
- For HyTDE combobox, `<datalist>` is treated as a **prototyping fallback**: if HyTDE runs, it should be disabled/removed (see below).

### Option B: Popover + custom listbox (recommended for apps)

Use `popover` to show a suggestion panel, and fill its content dynamically.

Pros:
- Fully stylable.
- Can show loading/error/empty states.
- Can implement richer rows (id + label + secondary text).

Cons:
- Requires JS for keyboard handling and input value application.

## 3. Data fetching behavior

Key behaviors needed:
- **Debounce**: wait ~150–300ms after last keystroke before fetching.
- **Abort/ignore stale**: if the user types again, abort the previous request or ignore its response.
- **Cache**: optionally cache recent queries.

Relationship to `design/fetching.md`:
- Request deduplication helps for identical URLs in-flight.
- Typeahead typically produces many unique URLs (`?q=...`), so **abort + stale protection** matters more than dedupe.

## 4. HyTDE Combobox Markup (proposal)

All attributes use the `hy-` prefix (project rule). If you see `hx-` elsewhere, treat it as a typo for `hy-`.

### 4.1 Minimal input attribute

```html
<input
  name="user"
  hy-combobox-candidate="/api/users/suggest?q={value}"
/>
```

`hy-combobox-candidate` is a URL template. `{value}` refers to the current input value and is URL-encoded before substitution.

### 4.2 Optional tuning attributes

- `hy-combobox-debounce="200"`: debounce in ms (default: 200)
- `hy-combobox-min-chars="1"`: minimum query length to fetch (default: 1)
- `hy-combobox-limit="10"`: desired maximum suggestions (hint; default: 10)
- `hy-combobox-mode="strict|free"`:
  - `strict`: selection must come from candidates
  - `free`: arbitrary input is allowed (candidates are suggestions only)
  - default: `free`

### 4.3 Prototyping fallback with `<datalist>`

For static HTML prototyping (HyTDE not running), use `<datalist>` to get a working baseline UI.

```html
<input
  name="user"
  list="user-suggest"
  hy-combobox-candidate="/api/users/suggest?q={value}"
/>
<datalist id="user-suggest">
  <option value="Dummy user 1"></option>
  <option value="Dummy user 2"></option>
</datalist>
```

Runtime rule:
- If HyTDE runs and an input has `hy-combobox-candidate`, the runtime MUST disable native datalist behavior by removing the input’s `list` attribute (and MAY remove the referenced `<datalist>` node). This prevents double suggestion UIs.

Notes:
- `{value}` is a special placeholder for this attribute only (not a general selector). It refers to the current input string.

### 4.4 Strict-mode prototyping with `<select>` (exact match)

For “must match one of the candidates” use cases, a static HTML prototype can use a native `<select>` (exact match by definition).

```html
<label>
  User
  <select
    name="userId"
    hy-combobox-candidate="/api/users/suggest?q={value}"
    hy-combobox-mode="strict"
  >
    <option value="">(select one)</option>
    <option value="100">Dummy user 100</option>
    <option value="101">Dummy user 101</option>
  </select>
</label>
```

Runtime rule:
- If HyTDE runs and a `<select>` has `hy-combobox-candidate`, the runtime MUST replace it with an input-based combobox UI (popover + listbox) to support remote typeahead.

Recommended replacement behavior:
- Preserve the original `name` for submission by keeping a hidden input for the selected value (id).
- Use a visible text input for the label/search term (it SHOULD NOT share the same `name` to avoid submitting free text in strict mode).
- `required`, `disabled`, and `readonly` should be preserved as closely as possible.

Conceptual output (not normative markup):
```html
<input type="hidden" name="userId" value="100" />
<input type="text" aria-label="User" autocomplete="off" />
```

## 5. Mocking

In `hy-mode=mock`, use `design/fetching.md` mock rules so the same typeahead markup can be tested without a backend.

## 6. Accessibility (minimum expectations)

If using a custom popover list:
- Input: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`.
- List: `role="listbox"`.
- Items: `role="option"`, `aria-selected`.
- Keyboard:
  - ArrowDown/ArrowUp to move selection,
  - Enter to commit selection,
  - Escape to close the popover.

Native `<datalist>` handles much of this automatically, but is less controllable.

## 7. Keyboard & IME behavior (required)

Keyboard interactions (popover/listbox mode):
- `ArrowDown` / `ArrowUp`: move the active option (wrap behavior is implementation-defined).
- `Enter`: commit the active option.
- `Escape`: close the suggestion popover (do not clear the input by default).
- `Tab`: commits selection only if `hy-combobox-mode="strict"` and an active option exists; otherwise allow normal focus navigation.

IME composition:
- During IME composition, the combobox MUST NOT fetch or move selection based on intermediate input events.
- Handle:
  - `compositionstart`: enter composing state
  - `compositionend`: exit composing state and trigger a debounced fetch based on the final value

Stale response protection:
- The runtime MUST ensure that responses for older queries do not overwrite newer results (via AbortController or request-id checks).

## 8. Submission semantics (summary)

- `hy-combobox-mode="free"`: submit the current input string as-is (input keeps `name`).
- `hy-combobox-mode="strict"`: submit the selected candidate value (id).
  - If the author prototypes with `<select name="...">`, HyTDE keeps that submission contract by moving the `name` to a hidden input and using the visible input for search/label only.

## Open Questions

1. Suggestion response format: JSON (template-rendered) vs server-rendered HTML fragments.
2. For `strict` mode, do we require a separate hidden value field (id/label split), or is label-only sufficient?
3. Do we standardize a shared component for rendering and ARIA wiring (recommended) vs keep it purely convention-based?
