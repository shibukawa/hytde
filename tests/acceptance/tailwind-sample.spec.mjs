import { expect, test } from "@playwright/test";

test("tailwind sample renders with styles", async ({ page }) => {
  await page.goto("/acceptance/tailwind-sample.html");

  const layout = page.locator("main");
  await expect(layout).toHaveCSS("display", "flex");

  const heading = page.locator("h1");
  await expect(heading).toHaveCSS("font-size", "30px");
  await expect(heading).toHaveCSS("font-weight", "700");
});
