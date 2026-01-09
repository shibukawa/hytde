import { expect, test } from "@playwright/test";

test("table initializes after data load", async ({ page }) => {
  await page.goto("/acceptance/table.html");
  const tableHost = page.locator('[data-hy-table-id="current.orders"]');
  await expect(tableHost).toBeVisible();
  const renderedTable = tableHost.locator('table[data-extable-renderer="html"]');
  await expect(renderedTable).toBeVisible();
  const orderCount = await page.evaluate(() => {
    const state = window.hyState;
    const current = state?.current;
    return Array.isArray(current?.orders) ? current.orders.length : 0;
  });
  expect(orderCount).toBeGreaterThan(0);

  await expect(renderedTable).toContainText("Sparrow Labs");

  const targetCell = renderedTable.locator("td", { hasText: "Sparrow Labs" }).first();
  await targetCell.click();
  await expect(renderedTable.locator("td.extable-active-cell")).toBeVisible();
});
