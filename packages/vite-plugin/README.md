# HyTDE Vite Plugin

## Install

```bash
npm install -D @hytde/vite-plugin
```

## Usage

```ts
import { defineConfig } from "vite";
import hyTde from "@hytde/vite-plugin";

export default defineConfig({
  plugins: [
    ...hyTde({
      inputPaths: ["."],
      tailwindSupport: true
    })
  ]
});
```

## Tailwind CSS v4

`tailwindSupport` enables Tailwind v4 processing in precompiled/SSR builds.
Standalone builds keep using the CDN script and ignore this option.

- `tailwindSupport: true`
  - Registers a virtual stylesheet with `@import "tailwindcss"`.
- `tailwindSupport: "src/styles.css"`
  - Uses the provided CSS file and validates it contains `@import "tailwindcss"`.

This plugin works alongside the official Vite Tailwind plugin (`@tailwindcss/vite`).

```ts
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    ...hyTde({ tailwindSupport: "src/styles.css" })
  ]
});
```

## Troubleshooting

- Missing `tailwindcss`: install `tailwindcss@^4.0.0`.
- Missing `@import "tailwindcss"`: add it to your CSS entry or enable the virtual entry.
