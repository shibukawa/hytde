# Native HTML UI Building Blocks (No JavaScript Required)

This document lists modern, standard HTML features that can help build usable UI **without writing JavaScript** (HyTDE aside). These are useful for Static Design and server-rendered modes where we want interaction and accessibility “for free”.

## `<dialog>` (Modal / Non-modal Surface)

What it is:
- A semantic container for modal and non-modal dialogs.

What works without JavaScript:
- Rendering the dialog initially open via the `open` attribute.
- Opening/closing via `command` / `commandfor` (preferred when available).
- Closing via `<form method="dialog">` buttons inside the dialog.

Preferred JS-less control (using `command`/`commandfor`):
```html
<button command="show-modal" commandfor="my-dialog">Open modal</button>

<dialog id="my-dialog">
  <p>Modal description goes here.</p>
  <button command="close" commandfor="my-dialog">Close</button>
</dialog>
```

Alternative JS-less close (return value):
```html
<dialog open>
  <p>Confirm?</p>
  <form method="dialog">
    <button value="cancel">Cancel</button>
    <button value="confirm">OK</button>
  </form>
</dialog>
```

Notes:
- Prefer `command`/`commandfor` over calling `showModal()` / `show()` from JavaScript.
- When used as a modal surface, ensure accessible labeling (`aria-labelledby`/`aria-label`) and sane focus order.

Compatibility:
- Invoker Commands (`command` / `commandfor`): https://caniuse.com/wf-invoker-commands

#### Command Mappings (Invoker Commands)

Invoker Commands can map declarative `command` values to element behaviors.

Popover-related mappings:
- `show-popover` → `el.showPopover()`
- `hide-popover` → `el.hidePopover()`
- `toggle-popover` → `el.togglePopover()`

Dialog-related mappings:
- `show-modal` → `dialogEl.showModal()`
- `close` → `dialogEl.close()`

### Initial Focus (`autofocus`)

When a dialog is shown, the browser will focus an appropriate element inside it. Prefer explicitly marking the intended primary action with `autofocus`.

Example:
```html
<dialog>
  <p>Do you agree to the terms?</p>
  <button>Cancel</button>
  <button autofocus>Agree</button>
</dialog>
```

Compatibility:
- `autofocus` (global attribute): https://caniuse.com/mdn-html_global_attributes_autofocus

### Styling & Animation

Backdrop overlay:
- Style the translucent overlay outside the dialog with the `::backdrop` pseudo-element.

Open state styling:
- Apply styles to the open state using `dialog[open]`.

Open/close animations:
- When a dialog is hidden, it becomes `display: none`, so initial animation styles should be declared with `@starting-style`.

Background scroll suppression:
- Safari can be tricky, but this CSS can help reduce background scrolling while a dialog is open:
```css
:root:has(dialog[open]) {
  overflow: hidden;
  scrollbar-gutter: stable;
}
```

## `<meter>` (Scalar Measurement)

What it is:
- A gauge for a known range (e.g. quota usage, temperature, confidence score).

Use cases:
- “Disk usage 72%”
- “Quality score”
- “Budget spent”

Example:
```html
<label for="quota">Storage</label>
<meter id="quota" min="0" max="100" low="60" high="85" optimum="50" value="72">
  72%
</meter>
```

Notes:
- Prefer `<progress>` for task completion/unknown endpoints; use `<meter>` for measurement in a known range.

## `popover` + `popovertarget` (Declarative Popovers)

What it is:
- A native popover mechanism that can be toggled by buttons/anchors **without JavaScript**.

Key attributes:
- `popover` on the popover element.
  - `popover="auto"` (default-ish): light-dismiss behavior.
  - `popover="manual"`: only closes via explicit actions.
- `popovertarget="id"` on a control element.
- `popovertargetaction="toggle|show|hide"` to control behavior.

Example (tooltip-like help):
```html
<button type="button" popovertarget="help" popovertargetaction="toggle">
  Help
</button>

<div id="help" popover>
  <p>Passwords must be at least 12 characters.</p>
</div>
```

Example (menu):
```html
<button type="button" popovertarget="menu" popovertargetaction="toggle">
  Actions
</button>
<div id="menu" popover="auto">
  <a href="/edit.html">Edit</a>
  <a href="/delete.html">Delete</a>
</div>
```

Notes:
- Popovers are a strong fit for “no-JS” interaction: contextual help, menus, lightweight panels.
- Still consider keyboard access and focus order; keep popover content simple and navigable.

### Tooltip / Hovercard Note (Chrome-only `popover="hint"`)

Chrome supports `popover="hint"` as an experimental/limited feature for hint-like popovers:
https://developer.chrome.com/blog/popover-hint

Future direction:
- `interesttarget` is expected to enable automatic open/close behavior for hovercards/tooltips, but it is not widely available yet.

Example (concept):
```html
<a interesttarget="my-hovercard" href="...">
  Hover to show the hovercard
</a>
<span popover="hint" id="my-hovercard">
  This is the hovercard
</span>
```

### Styling

Open state styling:
- Apply styles when the popover is open using `:popover-open`.

Backdrop styling:
- Style the overlay (if shown) with `::backdrop`.

Example:
```css
/* Apply styles when open */
.popover-content:popover-open {
  width: 300px;
  height: 120px;
  border-radius: 8px;
  border: none;
  padding: 24px;
  box-shadow: 8px 8px 10px #707070;
  background: #ffffff;
}

/* Backdrop styling */
.popover-content::backdrop {
  background-color: #505050;
  opacity: 0.5;
}
```

## Other Useful Native Features (Quick List)

- `<details>` / `<summary>`: disclosure widgets (accordion-like).
- `<datalist>`: lightweight suggestions for `<input list="...">`.
- Modern `<input>` types: `email`, `url`, `number`, `date`, `datetime-local`, `month`, `week`, `time`, `range`, `color`, `search`.
- Constraint validation (no JS required for basic cases): `required`, `pattern`, `min`, `max`, `step`, `minlength`, `maxlength`, `type="email"`, etc.
- `<progress>`: task progress indicator.
- `<output>`: display calculated results (often paired with forms; calculations may be server-side for JS-less).

## Practical Guidance

- Prefer these primitives for baseline UX in Static Design / SSR: they work even when HyTDE runtime is absent.
- In JS-enabled modes, HyTDE can progressively enhance, but templates should remain functional with plain HTML whenever possible.

## CSS-Only Component Libraries (Tailwind)

Even when JavaScript is not allowed, CSS frameworks can provide “interactive-feeling” UI patterns using only HTML + CSS.

### daisyUI

Website: https://daisyui.com

Summary:
- Built on Tailwind CSS.
- Provides components that can be implemented without JavaScript (CSS + HTML patterns).

Examples of useful UI patterns:
- Speed dial
- Drawer (off-canvas)
- Tabs
