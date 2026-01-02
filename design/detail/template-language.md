# HyTDE Template Language (Draft)

This document defines the *template language* used by HyTDE.

Goals:
- Templates are valid HTML files (`.html`), editable by designers without special tools.
- No JavaScript is required to build the initial page. Dynamic behavior is declared via `hy-*` attributes or `hy-*` custom elements.
- The language focuses on mapping server-provided data into the DOM (mostly “display”), with small, explicit formatting features.
- The same template should run in browsers and on non-JS servers (e.g. Go) with equivalent results.
- Optional post-render enhancement is specified separately in `design/dynamic-behavior.md`.

Non-goals (for this draft):
- A general-purpose programming language in templates.
- Arbitrary expression evaluation or user-defined functions.
- Recursive component invocation with complex control flow.

## 1. Terms

- **Context**: a JSON-like object stored under a named namespace via `hy-store`.
- **Scope**: a lexical environment built from loop variables (`hy-for`) and global state (`hyState`, `hyParams`, `hyAuth`, ...).
- **Selector**: a minimal syntax to select a value via the scope (e.g. `current.user.email`).
- **Binding**: an instruction that maps a selected value into text or an attribute.

## 2. Selector Syntax

Selector is intentionally small and predictable:
- Dot path: `a.b.c`
- Bracket access for keys and indexes:
  - `a["kebab-key"]`
  - `a[0]`

### 2.0 Pipeline Transforms (`|>`)

A selector may apply *transforms* using the pipeline operator:

```
<selector> |> <transform> |> <transform> ...
```

Transforms are named functions with optional literal arguments:
- No-arg: `current.user.name |> capital`
- With args: `current.user.createdAt |> date("yyyy-MM-dd")`
  - Max 3 args: `value |> clamp(0, 10, null)`

Arguments are restricted to literals:
- strings (`"..."` or `'...'`)
- numbers (`123`, `3.14`)
- booleans (`true`, `false`)
- `null`

No arbitrary expressions are allowed inside arguments.

#### 2.0.1 Transform Registration (Runtime API)

Transforms are registered by the runtime (browser/server) via an API so that the same template can execute everywhere:

```
hy.registerTransform(name, inputType, fn)
```

- `name`: transform identifier used in templates (e.g. `date`, `upper`)
- `inputType`: JSON scalar type name (`"string" | "number" | "boolean" | "null"`)
- `fn`: a pure function `function(input: inputType, arg1?, arg2?, arg3?): <json-scalar>` that returns a JSON scalar
  - `arg1..arg3` are optional JSON scalars (`string | number | boolean | null`)

Rules:
- The runtime MUST reject or error when registering duplicate `name`.
- At execution time, the runtime MUST check the input value against `inputType`.
  - On mismatch, it MUST emit an error and treat the transform result as `null`.
- The return value MUST be a JSON scalar (`string | number | boolean | null`).
  - If a non-scalar is returned, the runtime MUST emit an error and treat the result as `null`.
- Transform arguments are limited to **3** literals per transform call.

Type inference note:
- For typed runtimes (e.g. TypeScript), `registerTransform` SHOULD be generic so the `input` parameter type is inferred from `inputType` and the `arg1..arg3` types are inferred from the call signature. This enables IntelliSense and compile-time validation even though runtime still enforces scalar constraints.
- Since output types are not declared in v1, only `inputType` is known ahead of time. Chained transforms therefore rely on runtime checks rather than static inference. A future `outputType` may be added for stronger validation.

### 2.1 Lexical Scope Resolution

HyTDE avoids implicit “data namespaces” based on DOM parent/child relationships. Instead, server responses are stored explicitly via `hy-store`, and templates reference those namespaces directly.

When resolving the *first identifier* of a selector, HyTDE searches in this order:

1. **Loop variables** introduced by nearest-to-farthest `hy-for` ancestors
2. **Store namespaces** created by `hy-store` (aliases of `hyState.<namespace>`, e.g. `current`)
3. **Reserved globals**, e.g. authentication and params (`hyAuth`, `hyParams`, ...)

If a name is not found, it resolves to `null`.

Notes:
- This “loop-first” rule is intentional: within a loop, the loop variable takes precedence over store namespaces and globals.

### 2.2 Reserved Global Variables

Implementations should provide these globals (names are reserved):
- `hy`: runtime state and JS APIs (object; see notes below)
- `hyParams`: path/query params (exact extraction is runtime-defined)
- `hyAuth`: authentication/claims (if available)
- `hyCookies`: cookie-derived state (if exposed; optional)
- `hyState`: a global data store (see `design/data-store.md`)

Runtime state fields (proposal):
- `hy.loading`: boolean request activity indicator (see `design/fetching.md`)
- `hy.errors`: array of error objects (see `design/fetching.md`)

Store namespace aliases:
- If the page writes to `hyState.current` via `hy-store="current"`, the selector MAY reference it as `current` (alias), i.e. `current.users`.

Examples:
- `current.user.email`
- `current.users[0].name`
- `hyParams.userId`
- `hyAuth.sub`
- `hyState.current.users`

Missing values resolve to **null**.

See also:
- `design/data-store.md` (response namespaces)
- `design/forms.md` (form fetch + history)
- `design/fetching.md` (dedupe + mocking)
- `design/combobox.md` (typeahead)

## 2.3 Response Validation (Optional Schema)

A request directive element (e.g. a form with `hy-get`, or any element with `hy-get`) may define a response schema for validation. This is intended to keep browser and server behavior aligned.

Inline schema as an HTML comment:
```html
<!-- hy-schema: { "type": "object", "required": ["user"] } -->
```

Rules:
- The engine searches direct child nodes of the directive element for the first HTML comment whose trimmed text starts with `hy-schema:`.
- The substring after `hy-schema:` is parsed as JSON Schema (draft/version is project-defined).
- If both `hy-schema` and a response value (real or dummy) are present, the engine SHOULD validate.
  - On validation failure, the engine MUST emit an error event and SHOULD treat the response as `{}` for scope purposes.

## 3. Text Binding

### `hy`

`hy="<selector>"` sets the element’s *text content* to the selected value resolved from the lexical scope.
- Default conversion: `null` → empty string, boolean/number → string, object/array → JSON string (runtime MAY restrict this).
- Output is treated as text, not HTML (escaped by construction).

Example:
```html
<p hy="current.user.email">placeholder</p>
```

## 4. Attribute Binding

### `hy-attr-*`

`hy-attr-<name>="..."` binds an attribute value. It is designed for composing strings (URLs, class names, ARIA labels) without adding a general expression language.

Example:
```html
<a hy-attr-href="/users/[userId]/show.html#userId={current.user.id}">Profile</a>
```

#### 4.1 Interpolation Syntax

Within `hy-attr-*`, interpolation tokens can be embedded using curly braces:
- `{<selector>}` is replaced with the selected value (stringified). The selector may include `|>` transforms.
- Whitespace inside braces is ignored: `{ current.user.id }` is valid.
- If the entire attribute value is a single token (e.g. `{current.user.profileUrl}`) and it resolves to `null`, the attribute is removed.
- Otherwise, `null` resolves to an empty string.

Escaping:
- `{{` becomes a literal `{`
- `}}` becomes a literal `}`

Example (direct bind with removal-on-null):
```html
<a hy-attr-href="{current.user.profileUrl}">Profile</a>
```

For page navigation URLs, prefer the route-template conventions from `design/routing.md` (e.g. `/users/[userId]/show.html#userId={current.user.id}`) so templates work on static servers and can be canonicalized by builds/servers.

## 4.2 String Interpolation in Other Attributes

Some HyTDE attributes (e.g. `hy-get`, `hy-post`, `hy-import src`) accept string interpolation using the same `{<selector>}` tokens.

- Interpolation uses the same lexical scope rules as `hy`.
- For URL-valued attributes, each `{<selector>}` token is substituted using **URL percent-encoding** (UTF-8).
  - Encoding applies to the substituted value only (not the surrounding literal text).
  - `null` becomes an empty string before encoding.
  - This is intended to avoid “raw insertion” into URLs.
  - If the selector uses `|>` transforms, transforms run *before* URL encoding.

Example:
```html
<hy-get src="/api/users/{hyParams.userId}" store="current" unwrap="data"></hy-get>
<section>
  ...
</section>
```

URL-valued HyTDE attributes (initial set):
- `hy-get`, `hy-post`, `hy-put`, `hy-patch`, `hy-delete`
- `hy-import src`
- `hy-attr-href`, `hy-attr-src`, `hy-attr-action`, `hy-attr-formaction`

## 5. Conditional Rendering

### `hy-if` / `hy-else-if` / `hy-else` (Vue-like)

HyTDE conditionals are designed to feel close to Vue templates.

`hy-if="<selector>"` starts a conditional chain. Subsequent sibling elements may continue the chain using:
- `hy-else-if="<selector>"`
- `hy-else` (no expression)

Only the first truthy branch is rendered; all other branches in the same chain are removed.

#### Chain rules

- `hy-else-if` / `hy-else` MUST be in the same parent element as the preceding branch.
- `hy-else-if` / `hy-else` MUST immediately follow the preceding branch in document order, ignoring:
  - whitespace-only text nodes (newlines/indentation)
  - HTML comments
  - elements with `hy-dummy` (see below)
- A chain MUST NOT start from an element that has `hy-for`. To apply if/else per iteration, wrap the chain in a `<template hy-for="...">` and put `hy-if`/`hy-else` on siblings inside it.

#### Truthiness

`hy-if="<selector>"` conditionally keeps/removes the element based on truthiness.
Truthiness rules:
- `null`, `false`, `0`, `""`, empty array → false
- otherwise → true

#### Rendering behavior

- For normal elements: the kept branch element remains; removed branches are deleted from the DOM.
- For `<template>`: the kept branch replaces the `<template>` node with its children (the `<template>` element itself is not kept). Removed branches delete the entire `<template>` subtree.
- If the kept branch has `hidden` for prototyping, the runtime MUST remove `hidden` only when it is explicitly marked for HyTDE (see below).

Prototyping marker:
- If the kept branch has `hidden=""` or `hidden="hy-ignore"`, the runtime MUST remove `hidden` from it.
- Otherwise (e.g. `hidden="until-found"`), the runtime MUST NOT remove `hidden`.

Example (single element per branch):
```html
<p hy-if="current.user.isAdmin">Admin</p>
<p hy-else-if="current.user.isStaff">Staff</p>
<p hy-else>Member</p>
```

Example (multiple nodes per branch using `<template>`):
```html
<template hy-if="current.user.isAdmin">
  <h2>Admin Console</h2>
  <p>Restricted tools are available.</p>
</template>
<template hy-else>
  <h2>Welcome</h2>
  <p>Standard features are available.</p>
</template>
```

### `hy-dummy` (Design-time placeholders)

`hy-dummy` is a boolean attribute for placeholder elements used during static HTML design.

- When HyTDE is executing (browser runtime, build, or server rendering), any element with `hy-dummy` MUST be treated as if `hy-if="false"` and removed from the output DOM.
- When HyTDE is *not* executing (pure static HTML), the element remains and can be used for layout testing.

Example:
```html
<ul>
  <li hy-for="team of current.user.teams"><span hy="team.name">Dummy team 1</span></li>
  <li hy-dummy><span>Dummy team 2</span></li>
  <li hy-dummy><span>Dummy team 3</span></li>
</ul>
```

See also: `design/modes.md`

## 6. Repetition

### `hy-for`

`hy-for="<item> of <selector>"` repeats the element for each entry in an array.

Inside the repeated element subtree:
- `<item>` becomes a loop variable binding.
- Store namespaces and reserved globals remain accessible via lexical scope resolution.

Example:
```html
<li hy-for="user of current.users">
  <span hy="user.name"></span>
</li>
```

If the selected value is not an array, it is treated as an empty array.

Using `<template hy-for>` to repeat multiple siblings (recommended for if/else chains):
```html
<template hy-for="user of current.users">
  <p hy-if="user.isAdmin">Admin: <span hy="user.name"></span></p>
  <p hy-else>User: <span hy="user.name"></span></p>
</template>
```

## 7. Built-in Transforms (Initial Set)

Transform functions are intentionally small and standard across browser/server implementations.

### Text transforms

- `trim`: trims whitespace
- `lower`: lowercases
- `upper`: uppercases
- `capital`: a simple capitalization (implementation-defined; typically titlecase first character)

### Date/number transforms

- `date("<pattern>")`: formats an ISO-8601 input (or epoch milliseconds; implementation-defined)
- `number("<pattern>")`: formats a numeric input

Pattern language is an open question (ICU vs strftime vs runtime-specific), but the same patterns must be supported in browser and server runtimes for a given project.

Examples:
```html
<time hy="current.user.createdAt |> date('yyyy-MM-dd')">1970-01-01</time>
<span hy="current.total |> number('0,0')">0</span>
<span hy="current.user.name |> capital">name</span>
```

## 8. HTML Reuse / Import

Raw HTML insertion for reuse is done via `hy-import` (defined in `design/template-import.md`).
The intent is “component-like reuse” without supporting recursive/complex re-entry.

## 9. Escaping & Safety

- `hy` binds to textContent (no HTML interpretation).
- `hy-attr-*` binds to attributes (string conversion).
- There is no “unsafe HTML bind” in this draft; use `hy-import` for trusted HTML reuse.

## 10. Open Questions

1. For `hy-for`, do we want `index` support (e.g. `hy-for="(user, i) of current.users"`)?
2. Do we need a non-URL-encoded insertion mode for rare cases (currently: no)?
3. Transform set completeness: do we need `default("...")`, `join(",")`, etc.?
