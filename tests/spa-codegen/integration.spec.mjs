import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import hyTde from "../../packages/vite-plugin/dist/index.js";

const fixtureRoot = resolve(process.cwd(), "tests/fixtures/spa-codegen");
const inputPaths = ["index.html", "routes/next.html"];

async function buildFixture(outDir, options = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await build({
    root: fixtureRoot,
    logLevel: "silent",
    plugins: hyTde({
      mode: options.mode,
      inputPaths,
      manifestPath: options.manifestPath
    }),
    build: {
      outDir,
      emptyOutDir: true
    }
  });
}

function extractIrFromModule(source) {
  const match = source.match(/export const ir = (.*?);\n/s);
  assert.ok(match, "module should export ir");
  return JSON.parse(match[1]);
}

test("spa codegen build emits modules, manifest, and resources", async () => {
  const outDir = resolve(process.cwd(), "tmp/spa-codegen-spa");
  await buildFixture(outDir, { mode: "spa" });

  const manifestPath = resolve(outDir, "route-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest["/spa/index"], "/index.spa.js");
  assert.equal(manifest["/spa/next"], "/routes/next.spa.js");

  const modulePath = resolve(outDir, "index.spa.js");
  const moduleSource = await readFile(modulePath, "utf8");
  assert.ok(moduleSource.includes("export const ir"));
  assert.ok(moduleSource.includes("export const transforms"));
  assert.ok(moduleSource.includes("export function render"));

  const ir = extractIrFromModule(moduleSource);
  assert.ok(ir.rs, "compact ir should include resources");
  assert.ok(Array.isArray(ir.rs.c));
  assert.ok(Array.isArray(ir.rs.j));
  assert.ok(Array.isArray(ir.rs.pf));
  assert.ok(ir.rs.c.some((entry) => entry.h === "/styles/main.css"));
  assert.ok(ir.rs.j.some((entry) => entry.sr === "/scripts/app.js"));
  assert.ok(ir.rs.pf.includes("/api/prefetch-1"));

  const html = await readFile(resolve(outDir, "index.html"), "utf8");
  assert.ok(html.includes("Imported Header"));
  assert.ok(html.includes("/styles/imported.css"));
});

test("mpa build injects prerender links", async () => {
  const outDir = resolve(process.cwd(), "tmp/spa-codegen-mpa");
  await buildFixture(outDir, { mode: undefined });
  const html = await readFile(resolve(outDir, "index.html"), "utf8");
  assert.ok(html.includes("rel=\"prerender\""));
  assert.ok(html.includes("/api/prefetch-1"));
});
