import { expect, test } from "@playwright/test";

const MANIFEST_PATH = "/route-manifest.json";
const ROUTES = {
  next: { path: "/acceptance/spa/next.html", module: "/routes/acceptance-spa-next.js" },
  resources: { path: "/acceptance/spa/resources.html", module: "/routes/acceptance-spa-resources.js" },
  state: { path: "/acceptance/spa/state.html", module: "/routes/acceptance-spa-state.js" },
  transform: { path: "/acceptance/spa/transform.html", module: "/routes/acceptance-spa-transform.js" },
  meta: { path: "/acceptance/spa/meta.html", module: "/routes/acceptance-spa-meta.js" },
  preserve: { path: "/acceptance/spa/preserve.html", module: "/routes/acceptance-spa-preserve.js" },
  force: { path: "/acceptance/spa/force.html", module: "/routes/acceptance-spa-force.js" }
};
const RESOURCE_CSS = "/assets/spa.css";
const RESOURCE_JS = "/assets/spa.js";
const RESOURCE_PREFETCH = "/api/prefetch-resource";
const HYGET_PREFETCH = "/api/prefetch-cache";

function shouldRun(projectName) {
  return (
    projectName === "runtime-vite" ||
    projectName === "runtime-vite-path" ||
    projectName === "precompiled" ||
    projectName === "ssr"
  );
}

function buildManifest() {
  const entries = Object.values(ROUTES).flatMap((route) => {
    const aliases = [route.path];
    if (route.path.endsWith(".html")) {
      aliases.push(route.path.replace(/\.html$/, ""));
    }
    return aliases.map((alias) => [alias, route.module]);
  });
  return Object.fromEntries(entries);
}

function buildModule({ ir = {}, renderBody, extraExports = "" }) {
  return `
export const ir = ${JSON.stringify(ir)};
${extraExports}
export function render() {
  const body = document.createElement("body");
  body.innerHTML = ${JSON.stringify(renderBody)};
  return body;
}
`;
}

function buildTransformModule() {
  const transforms = "hy.registerTransform('upper', 'string', (value) => String(value).toUpperCase());";
  const renderBody = "<h1 data-testid=\"spa-transform\">Transform</h1>";
  return `
export const ir = { resources: { css: [], js: [], prefetch: [] } };
export const transforms = ${JSON.stringify(transforms)};
let registered = false;
export function registerTransforms(hy) {
  if (registered) {
    return;
  }
  const runner = new Function("hy", transforms);
  runner(hy);
  registered = true;
}
export function render() {
  const body = document.createElement("body");
  body.innerHTML = ${JSON.stringify(renderBody)};
  return body;
}
`;
}

function routeWithOptionalQuery(page, path, handler) {
  return page.route((url) => url.pathname === path, handler);
}

const MANIFEST = buildManifest();

async function waitForRouter(page) {
  await page.waitForFunction(() => {
    const ready = Boolean(window.hyRouter && window.hyRouter.navigateTo);
    const lifecycleReady = Boolean(window.hy && typeof window.hy.onUnmount === "function");
    return ready && lifecycleReady;
  });
  await page.evaluate((manifest) => {
    if (window.hyRouter) {
      window.hyRouter.manifest = manifest;
    }
  }, MANIFEST);
}

async function installSpaRoutes(page) {
  await routeWithOptionalQuery(page, MANIFEST_PATH, async (route) => {
    if (route.request().method() === "HEAD") {
      await route.fulfill({ status: 200, body: "" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildManifest())
    });
  });

  await routeWithOptionalQuery(page, ROUTES.next.module, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: buildModule({
        renderBody: "<h1 data-testid=\"spa-next\">Next</h1>",
        ir: {
          resources: { css: [], js: [], prefetch: [] },
          requestTargets: [
            {
              urlTemplate: HYGET_PREFETCH,
              method: "GET",
              trigger: "startup",
              store: "prefetch"
            }
          ]
        }
      })
    });
  });

  await routeWithOptionalQuery(page, ROUTES.resources.module, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: buildModule({
        renderBody: "<h1 data-testid=\"spa-resources\">Resources</h1>",
        ir: {
          resources: {
            css: [{ href: RESOURCE_CSS }],
            js: [{ src: RESOURCE_JS, defer: true }],
            prefetch: [RESOURCE_PREFETCH]
          }
        }
      })
    });
  });

  await routeWithOptionalQuery(page, ROUTES.state.module, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: buildModule({
        renderBody: "<h1 data-testid=\"spa-state\">State</h1>",
        ir: { resources: { css: [], js: [], prefetch: [] } },
        extraExports: "export const persistNamespaces = ['global', 'custom'];"
      })
    });
  });

  await routeWithOptionalQuery(page, ROUTES.transform.module, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: buildTransformModule()
    });
  });

  await routeWithOptionalQuery(page, ROUTES.meta.module, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: buildModule({
        renderBody: "<h1 data-testid=\"spa-meta\">Meta</h1>",
        ir: {
          html: {
            title: "SPA Meta",
            htmlAttrs: { lang: "ja" },
            bodyAttrs: { "data-spa": "meta" }
          },
          resources: { css: [], js: [], prefetch: [] }
        }
      })
    });
  });

  await routeWithOptionalQuery(page, ROUTES.preserve.module, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: buildModule({
        renderBody: "<div id=\"spa-preserve\" hy-preserve data-testid=\"spa-preserve\">Incoming</div>",
        ir: {
          html: { preserveIds: ["spa-preserve"] },
          resources: { css: [], js: [], prefetch: [] }
        }
      })
    });
  });

  await routeWithOptionalQuery(page, ROUTES.force.module, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: buildModule({
        renderBody: "<h1 data-testid=\"spa-force\">Force</h1>",
        ir: { resources: { css: [], js: [], prefetch: [] } }
      })
    });
  });

  await routeWithOptionalQuery(page, RESOURCE_CSS, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/css", body: "body{background:#fff;}" });
  });

  await routeWithOptionalQuery(page, RESOURCE_JS, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.__spaResourceScriptLoaded = true;"
    });
  });

  await routeWithOptionalQuery(page, RESOURCE_PREFETCH, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

async function installManifestOverride(page) {
  await page.addInitScript((payload) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/route-manifest.json")) {
        const method = init && init.method ? String(init.method).toUpperCase() : "GET";
        if (method === "HEAD") {
          return Promise.resolve(new Response("", { status: 200 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      return originalFetch(input, init);
    };
  }, MANIFEST);
}

test.describe("spa navigation", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!shouldRun(testInfo.project.name)) {
      testInfo.skip();
      return;
    }
    await installManifestOverride(page);
    await installSpaRoutes(page);
  });

  test("intercepts link navigation without reload", async ({ page }) => {
    await page.addInitScript(() => {
      window.__spaReloadCount = (window.__spaReloadCount || 0) + 1;
    });
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    await expect(page.getByTestId("spa-index")).toBeVisible();

    await page.getByRole("link", { name: "Go to Next" }).click();
    await expect(page.getByTestId("spa-next")).toBeVisible();

    const reloadCount = await page.evaluate(() => window.__spaReloadCount);
    expect(reloadCount).toBe(1);
  });

  test("loads resources on navigation", async ({ page }) => {
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    const cssResponse = page.waitForResponse((response) => response.url().includes(RESOURCE_CSS));
    const jsResponse = page.waitForResponse((response) => response.url().includes(RESOURCE_JS));
    const prefetchResponse = page.waitForResponse((response) => response.url().includes(RESOURCE_PREFETCH));

    await page.getByTestId("spa-resources-link").click();
    await expect(page.getByTestId("spa-resources")).toBeVisible();

    await cssResponse;
    await jsResponse;
    await prefetchResponse;

    const scriptLoaded = await page.evaluate(() => window.__spaResourceScriptLoaded);
    expect(scriptLoaded).toBe(true);
  });

  test("resets state with persisted namespaces", async ({ page }) => {
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    await page.evaluate(() => {
      window.hyState = {
        global: { value: "keep" },
        custom: { value: "keep-custom" },
        temp: { value: "drop" }
      };
    });

    await page.getByTestId("spa-state-link").click();
    await expect(page.getByTestId("spa-state")).toBeVisible();

    const state = await page.evaluate(() => window.hyState);
    expect(state.global.value).toBe("keep");
    expect(state.custom.value).toBe("keep-custom");
    expect(state.temp).toBeUndefined();
  });

  test("registers transforms before render", async ({ page }) => {
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    await page.evaluate((path) => window.hyRouter.navigateTo(path), ROUTES.transform.path);
    await expect(page.getByTestId("spa-transform")).toBeVisible();

    const hasTransform = await page.evaluate(() => {
      const registry = window.hy && window.hy.__hytdeTransforms;
      return registry instanceof Map && registry.has("upper");
    });
    expect(hasTransform).toBe(true);
  });

  test("reuses hy-preserve element", async ({ page }) => {
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    const preserved = await page.evaluateHandle(() => {
      const element = document.getElementById("spa-preserve");
      window.__spaPreserveRef = element;
      return element;
    });
    await expect(page.getByTestId("spa-preserve")).toBeVisible();

    await page.getByTestId("spa-preserve-link").click();
    await expect(page.getByTestId("spa-preserve")).toBeVisible();

    const reused = await page.evaluate(() => {
      return document.getElementById("spa-preserve") === window.__spaPreserveRef;
    });
    expect(reused).toBe(true);
    await preserved.dispose();
  });

  test("updates html metadata", async ({ page }) => {
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    await page.getByTestId("spa-meta-link").click();
    await expect(page.getByTestId("spa-meta")).toBeVisible();

    const metadata = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.getAttribute("lang"),
      bodyAttr: document.body.getAttribute("data-spa")
    }));
    expect(metadata.title).toBe("SPA Meta");
    expect(metadata.lang).toBe("ja");
    expect(metadata.bodyAttr).toBe("meta");
  });

  test("hover prefetch triggers module load", async ({ page }) => {
    let prefetchCount = 0;
    await routeWithOptionalQuery(page, HYGET_PREFETCH, async (route) => {
      prefetchCount += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    const responsePromise = page.waitForResponse((response) => response.url().includes(ROUTES.next.module));
    await page.getByRole("link", { name: "Go to Next" }).hover();
    await responsePromise;
    await page.waitForResponse((response) => response.url().includes(HYGET_PREFETCH));
    await page.getByRole("link", { name: "Go to Next" }).hover();
    await page.waitForTimeout(200);
    expect(prefetchCount).toBe(1);
  });

  test("force prefetch schedules downloads", async ({ page }) => {
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    await page.waitForResponse((response) => response.url().includes(ROUTES.force.module));
  });

  test("manual prefetch api downloads module", async ({ page }) => {
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    const responsePromise = page.waitForResponse((response) => response.url().includes(ROUTES.resources.module));
    await page.evaluate(() => window.hy.prefetch("/acceptance/spa/resources"));
    await responsePromise;
  });

  test("lifecycle hooks run in order", async ({ page }) => {
    await page.goto("/acceptance/spa/index.html");
    await waitForRouter(page);
    await page.evaluate(() => {
      window.__spaLifecycle = [];
      window.hy.onUnmount(() => window.__spaLifecycle.push("unmount"));
      window.hy.onMount(() => window.__spaLifecycle.push("mount"));
    });

    await page.getByTestId("spa-resources-link").click();
    await expect(page.getByTestId("spa-resources")).toBeVisible();

    const lifecycle = await page.evaluate(() => window.__spaLifecycle);
    expect(lifecycle).toEqual(["unmount", "mount"]);
  });

  test("initial route check replaces url when manifest mismatches", async ({ page }) => {
    await page.goto("/acceptance/spa/mismatch.html");
    await expect(page.getByTestId("spa-next")).toBeVisible();
    await page.waitForURL("**/acceptance/spa/next.html");
  });
});
