import { defineConfig } from "vite";
import { resolve } from "node:path";

type Variant = {
  name: string;
  htmlEntry: string;
  outDir: string;
  debug: boolean;
};

const rootDir = __dirname;
const variants: Variant[] = [
  {
    name: "production-auto",
    htmlEntry: "entries/production-auto/index.html",
    outDir: "dist/production-auto",
    debug: false
  },
  {
    name: "debug-auto",
    htmlEntry: "entries/debug-auto/index.html",
    outDir: "dist/debug-auto",
    debug: true
  },
  {
    name: "production-manual",
    htmlEntry: "entries/production-manual/index.html",
    outDir: "dist/production-manual",
    debug: false
  },
  {
    name: "debug-manual",
    htmlEntry: "entries/debug-manual/index.html",
    outDir: "dist/debug-manual",
    debug: true
  }
];

function resolveVariant(): Variant {
  const name = process.env.HYTDE_STANDALONE_VARIANT ?? "production-auto";
  const variant = variants.find((item) => item.name === name);
  if (!variant) {
    throw new Error(`Unknown HYTDE_STANDALONE_VARIANT: ${name}`);
  }
  return variant;
}

export default defineConfig(() => {
  const variant = resolveVariant();
  const variantRoot = resolve(rootDir, `entries/${variant.name}`);
  return {
    root: variantRoot,
    base: "./",
    build: {
      outDir: resolve(rootDir, variant.outDir),
      sourcemap: variant.debug,
      target: "es2019",
      rollupOptions: {
        input: {
          index: resolve(variantRoot, "index.html")
        },
        output: {
          entryFileNames: "index.js",
          inlineDynamicImports: true
        }
      }
    },
    esbuild: variant.debug ? undefined : { drop: ["console", "debugger"] }
  };
});
