# HyTDE Template Import (Draft)

This document defines `hy-import`, a mechanism to reuse trusted HTML fragments/components.

Goals:
- Reuse HTML without embedding JavaScript in templates.
- Keep import semantics simple (no recursive invocation requirements).
- The same template file should work in browsers and on non-JS servers (e.g. Go) without modifications.
- Allow component authors to design components in a “full page” HTML context, while still exporting only the intended nodes for import.

## 1. Syntax

This draft standardizes on a custom element:

```html
<hy-import src="/components/user-card.html"></hy-import>
```

Relative path example (current template: `/users/show.html`):
```html
<hy-import src="../components/user-card.html"></hy-import>
```

## 2. What gets imported

- `src` points to an HTML file (or a fragment endpoint) that returns valid HTML.
- The imported content is treated as trusted HTML and inserted as DOM nodes.
- `src` is resolved relative to the *current template HTML location* (i.e. the importing document), using standard relative URL resolution rules.
- `src` may contain `{<selector>}` interpolation tokens; URL encoding rules from `design/template-language.md` apply.

### 2.1 Export selection via `hy-export`

The imported HTML may contain many nodes for design context. Only nodes explicitly marked with `hy-export` are imported.

Rules:
- HyTDE parses the imported HTML as a document.
- It collects nodes that have the boolean attribute `hy-export`.
- Nodes without `hy-export` are ignored for import purposes.

There are two categories of export nodes:

**A) Content export (replacement)**
- Any exported node that is *not* `<script>`, `<style>`, or `<link>` is a content export candidate.
- The first such node in document order is the **content export**.
- The `<hy-import>` node is replaced by the content export node’s **outerHTML** (as DOM), and the `hy-export` attribute is removed from the inserted node.

**B) Asset exports (merged)**
- Exported `<script>`, `<style>`, and `<link>` nodes are treated as “asset exports”.
- Asset exports are merged into the importing document (see 2.2).

If no content export exists:
- The `<hy-import>` is replaced with nothing (removed).

If multiple content export nodes exist:
- Only the first is used as the replacement in v1.
  (Open question: allow importing multiple exported content blocks.)

### 2.2 Asset merge (`<script>` / `<style>` / `<link>`)

If the imported document contains exported assets (`hy-export` on `<script>`, `<style>`, `<link>`):
- HyTDE MUST insert them into the importing document’s `<head>` (append at the end), and remove the `hy-export` attribute.
- Duplicate handling is implementation-defined, but recommended:
  - `<link>`: dedupe by `rel` + resolved `href`
  - `<script src>`: dedupe by resolved `src`
  - inline `<style>` / inline `<script>`: dedupe by text hash (optional)

This enables authoring components in a full HTML page while still exporting the component root and its required assets.

## 3. Parameters / Context Passing (Minimal)

Optional `hy-with` assigns a new context for the imported subtree.

Example:
```html
<hy-import src="/components/user-card.html" hy-with="current.user"></hy-import>
```

`hy-with` uses the same selector syntax and lexical scope rules as `hy`.
The selected value becomes the “local context” for the imported subtree.

Open question: do we need named parameters (map) or is “single context object” enough for v1?

## 4. Import Lifecycle

HyTDE resolves imports by **replacing** the `<hy-import>` node with the imported DOM nodes.

Resolution timing is runtime-dependent, but behavior must be equivalent:
- **Browser runtime**: fetch/parse imported HTML, replace the node, then process `hy-*` directives within the imported content.
- **Server runtime (non-JS, e.g. Go)**: load/parse imported HTML, replace the node, then continue template processing against the replaced DOM as if it was originally inlined.

Processing order:
1. Resolve `hy-import` (recursively, depth-first).
2. Process remaining directives (`hy-get`, `hy-for`, `hy-if`, bindings) on the resulting DOM.

## 5. Constraints

- Implementations MAY detect and reject circular imports, but templates should not rely on recursion.
- Imported fragments should be valid HTML and may themselves contain `hy-*` bindings.

## 6. Scoping

- Loop variables from `hy-for` remain visible inside imported content (lexical).
- Imported content can access the same store namespaces and reserved globals as the importer.
  - If the imported content performs its own requests, it must store results explicitly via `hy-store` (no implicit request-scoped variables).

## 7. Example

Importer:
```html
<hy-import src="../components/header.html"></hy-import>
```

Imported file (`components/header.html`) can include design context, but only exports marked nodes:
```html
<!doctype html>
<html>
  <head>
    <link hy-export rel="stylesheet" href="./header.css">
    <script hy-export type="module" src="./header.js"></script>
  </head>
  <body>
    <!-- design context (ignored): -->
    <main>
      <p>Example page layout around the header…</p>
    </main>

    <!-- exported component root (replaces hy-import): -->
    <header hy-export>
      <h1>My App</h1>
      <nav>...</nav>
    </header>
  </body>
</html>
```
