# Hy-Cloak Behavior

## Goals
- Prevent FOUC by keeping `hy-cloak` elements hidden until the initial render completes.
- Reveal content with a smooth fade-in once rendering is finished.

## Template Usage
```html
<div hy-cloak style=\"display: none;\">...</div>
```

### Sample HTML
```html
<div hy-cloak style=\"display: none;\">
  <h2>Welcome</h2>
  <p hy-dummy>Loading...</p>
</div>
```

## Behavior
- On initial page load, elements with `hy-cloak` are expected to be hidden via inline style (ex: `display: none`).
- After the first render completes:
  - Remove `hy-cloak` attribute.
  - Remove inline `display: none` (or equivalent) from the element.
  - Apply a fade-in effect (opacity transition).

## Suggested Runtime Sequence
1. Collect all `hy-cloak` elements during parse/init.
2. After initial render finishes:
   - For each cloaked element:
     - Clear `display: none`.
     - Set `opacity: 0` and `transition: opacity 160ms ease`.
     - On next animation frame, set `opacity: 1` to trigger fade-in.
3. Do not apply fade-in on subsequent renders.

## Notes
- If authors provide their own CSS for `hy-cloak`, runtime should avoid overriding custom transitions when possible.
- This behavior should be opt-in only: elements without `hy-cloak` are unchanged.
