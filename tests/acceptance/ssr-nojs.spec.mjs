import { test, expect } from "@playwright/test";

test.describe("ssr no-js", () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(({ }, testInfo) => {
    if (testInfo.project.name !== "ssr") {
      testInfo.skip();
    }
  });

  test("basic renders server data", async ({ page }) => {
    await page.goto("/acceptance/basic.html");
    await expect(page.getByTestId("name")).toHaveText("Alice");
    await expect(page.getByTestId("email")).toHaveText("alice@example.com");
  });

  test("table renders server output", async ({ page }) => {
    await page.goto("/acceptance/table.html");
    const table = page.locator('table[data-extable-renderer="html"]');
    await expect(table).toBeVisible();
  });
});
