import { expect, test } from "@playwright/test";

const MANIFEST_PATH = "/route-manifest.json";
const ROUTE_MODULE_PATH = "/routes/acceptance-spa-next.js";
const SLOW_API_PATH = "/api/slow-user";

function shouldRun(projectName) {
  return projectName === "runtime-vite" || projectName === "runtime-vite-path" || projectName === "ssr";
}

function buildSpaModule() {
  return `
export const ir = {
  resources: { css: [], js: [], prefetch: [] },
  requestTargets: [
    {
      urlTemplate: "${SLOW_API_PATH}",
      method: "GET",
      trigger: "startup",
      store: "user"
    }
  ]
};

export function render() {
  const root = document.createElement("div");
  const name = (window.hyState && window.hyState.user && window.hyState.user.name) || "loading";
  root.innerHTML = '<h1 data-testid="spa-next">' + name + "</h1>";
  if (name === "loading") {
    fetch("${SLOW_API_PATH}")\n      .then((response) => response.json())\n      .then((payload) => {\n        if (!window.hyState) {\n          window.hyState = {};\n        }\n        window.hyState.user = payload;\n        const target = root.querySelector('[data-testid=\"spa-next\"]');\n        if (target) {\n          target.textContent = payload.name || \"loading\";\n        }\n      })\n      .catch(() => undefined);\n  }
  return root;
}
`;
}

async function installSpaRoutes(page) {
  await page.route(MANIFEST_PATH, async (route) => {
    if (route.request().method() === "HEAD") {
      await route.fulfill({ status: 200, body: "" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        "/acceptance/spa/next": ROUTE_MODULE_PATH,
        "/acceptance/spa/next.html": ROUTE_MODULE_PATH
      })
    });
  });

  await page.route(ROUTE_MODULE_PATH, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: buildSpaModule()
    });
  });

  await page.route(SLOW_API_PATH, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ name: "Alice" })
    });
  });
}

test.describe("spa router", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!shouldRun(testInfo.project.name)) {
      testInfo.skip();
      return;
    }
    await installSpaRoutes(page);
  });

  test("prefetch + navigate + back", async ({ page }, testInfo) => {
    await page.goto("/acceptance/spa/index.html");
    await expect(page.getByTestId("spa-index")).toBeVisible();

    const link = page.getByRole("link", { name: "Go to Next" });
    await link.hover();
    if (testInfo.project.name === "runtime-vite-path") {
      await page.waitForResponse(
        (response) => response.url().includes(SLOW_API_PATH) && response.status() === 200,
        { timeout: 1500 }
      );
    } else {
      await expect(
        page.waitForResponse((response) => response.url().includes(SLOW_API_PATH), { timeout: 500 }),
        "hash mode should not prefetch on hover"
      ).rejects.toThrow();
    }

    await link.click();
    if (testInfo.project.name === "runtime-vite-path") {
      await expect(page.getByTestId("spa-next")).toHaveText("Alice", { timeout: 500 });
    } else {
      await expect(page.getByTestId("spa-next")).toHaveText("Alice");
    }

    await page.goBack();
    await expect(page.getByTestId("spa-index")).toBeVisible();
  });

  test("path mode serves extensionless html", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "runtime-vite-path") {
      testInfo.skip();
      return;
    }
    await page.goto("/acceptance/spa/next");
    await expect(page.getByTestId("spa-next-fallback")).toBeVisible();
  });

  test("initial route mismatch jumps to meta route", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "runtime-vite-path") {
      testInfo.skip();
      return;
    }
    await page.goto("/acceptance/spa/mismatch.html");
    await expect(page.getByTestId("spa-next")).toBeVisible();
    await page.waitForURL("**/acceptance/spa/next.html");
  });
});
