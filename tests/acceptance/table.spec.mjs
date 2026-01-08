import { expect, test } from "@playwright/test";

test("table initializes after data load", async ({ page }) => {
  await page.goto("/acceptance/table.html");
  await page.waitForSelector('[data-hy-table-id="current.orders"]');
  const orderCount = await page.evaluate(() => {
    const state = window.hyState;
    const current = state?.current;
    return Array.isArray(current?.orders) ? current.orders.length : 0;
  });
  expect(orderCount).toBeGreaterThan(0);
});
