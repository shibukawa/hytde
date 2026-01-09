# Runtime Core (IR-only)

This folder is the IR-driven runtime core.

Rules:
- No DOM discovery APIs (`querySelector*`, `closest`, `matches`, `getElementsBy*`).
- No `getAttribute`/`hasAttribute` checks for `hy-*` discovery.
- Element lookup must use `document.getElementById` only.

Legacy runtime modules live outside `core/` and are migrated here in phases.
