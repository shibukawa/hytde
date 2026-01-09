import { expect, test } from "@playwright/test";

test("cascading select preserves upstream selection", async ({ page }) => {
  await page.goto("/acceptance/cascading-select.html");
  await page.waitForFunction(() => Array.isArray(window.hyState?.aOptions));

  const categorySelect = page.locator('select[name="a"]');
  const subcategorySelect = page.locator('select[name="b"]');
  const itemSelect = page.locator('select[name="c"]');

  await categorySelect.selectOption("a1");
  await page.waitForFunction(() => Array.isArray(window.hyState?.bOptions) && window.hyState.bOptions.length > 0);
  await expect(categorySelect).toHaveValue("a1");

  await subcategorySelect.selectOption("b1");
  await page.waitForFunction(() => Array.isArray(window.hyState?.cOptions) && window.hyState.cOptions.length > 0);
  await expect(categorySelect).toHaveValue("a1");
  await expect(subcategorySelect).toHaveValue("b1");

  await itemSelect.selectOption("c1");
  await expect(categorySelect).toHaveValue("a1");
  await expect(subcategorySelect).toHaveValue("b1");
  await expect(itemSelect).toHaveValue("c1");
});
