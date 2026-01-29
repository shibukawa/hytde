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
    name: "prod",
    htmlEntry: "entries/prod/index.html",
    outDir: "dist/prod",
    debug: false
  },
  {
    name: "debug",
    htmlEntry: "entries/debug/index.html",
    outDir: "dist/debug",
    debug: true
  },
  {
    name: "prod-manual",
    htmlEntry: "entries/prod-manual/index.html",
    outDir: "dist/prod-manual",
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
  const name = process.env.HYTDE_STANDALONE_VARIANT ?? "prod";
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
      emptyOutDir: true,
      sourcemap: variant.debug,
      target: "es2019",
      rollupOptions: {
        input: {
          index: resolve(variantRoot, "index.html")
        },
        output: {
          entryFileNames: "index.js",
          manualChunks: (id) => {
            if (id.includes("extable-core") || id.includes("@extable/core")) {
              return "extable-core";
            }
            return undefined;
          }
        }
      }
    },
    esbuild: variant.debug ? undefined : { drop: ["console", "debugger"] }
  };
});
