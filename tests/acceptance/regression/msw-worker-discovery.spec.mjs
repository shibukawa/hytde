import { expect, test } from "@playwright/test";

test("standalone resolves worker at root and subpath", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "regression-static");

  await page.goto("/index.html");
  await expect(page.getByTestId("todo-title")).toHaveText("Root worker resolved");
  const rootWorker = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.map((reg) => reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL);
  });
  expect(rootWorker.some((url) => url && url.endsWith("/mockServiceWorker.js"))).toBe(true);

  await page.goto("/project/deep/index.html");
  await expect(page.getByTestId("todo-title")).toHaveText("Subpath worker resolved");
  const subpathWorker = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.map((reg) => reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL);
  });
  expect(subpathWorker.some((url) => url && url.endsWith("/project/mockServiceWorker.js"))).toBe(true);
});

test("precompile resolves worker under subpath base", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "precompiled-subpath");

  await page.goto("/project/acceptance/msw/project/deep/index.html");
  await expect(page.getByTestId("todo-title")).toHaveText("Precompile subpath worker resolved");
  const workerUrls = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.map((reg) => reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL);
  });
  expect(workerUrls.some((url) => url && url.endsWith("/project/mockServiceWorker.js"))).toBe(true);
});
