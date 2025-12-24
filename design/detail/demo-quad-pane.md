# Demo Quad-Pane Standard Layout

## Purpose
Standardize the HyTDE demo UI so source, transformed HTML, rendered output, and runtime logs are visible at once for rapid validation.

## Layout
- 2x2 grid layout (responsive):
  - Desktop: two columns, two rows.
  - Mobile: stacked vertical panes.
- Pane roles:
  - Top-left: Source (HTML + dummy JSON) with tabs.
  - Top-right: Transformed HTML (DOM dump after runtime render).
  - Bottom-left: Rendered Output (live runtime-applied DOM).
  - Bottom-right: Runtime Log (events, errors).

## Styling
- Tailwind CSS + daisyUI loaded via CDN.
- Cards for panes, tabs for source view, monospace for source/log output.

## Source Pane
- Static `<pre>` blocks; no live editor.
- HTML and JSON are provided explicitly for clarity and repeatability.
- Source panes are syntax-highlighted, with HyTDE tags/attributes visually distinct.

## Transformed HTML Pane
- Updated after every render pass.
- Content is produced by serializing the rendered output container.
- Output is formatted with consistent indentation.
- Syntax highlighting matches the source pane, including HyTDE-specific styling.

## Rendered Output Pane
- Contains the actual DOM rendered by the HyTDE runtime.
- Runtime directives execute against this pane only.

## Runtime Log Pane
- Shows render lifecycle events and request/errors.
- Entries are appended in time order; oldest entries trimmed when needed.
