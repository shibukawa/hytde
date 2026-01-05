import { expect, test } from "@playwright/test";

test("table initializes after data load", async ({ page }) => {
  await page.goto("/acceptance/table.html");
  await page.waitForSelector('[data-hy-table-id="current.orders"]');
  const orderCount = await page.evaluate(() => {
    const state = (window as typeof window & { hyState?: Record<string, unknown> }).hyState;
    const current = state?.["current"] as { orders?: unknown[] } | undefined;
    return current?.orders?.length ?? 0;
  });
  expect(orderCount).toBeGreaterThan(0);
});
