import { expect, test } from "@playwright/test";

test("basic render uses mock data", async ({ page }) => {
  await page.goto("/acceptance/basic.html");
  await expect(page.getByTestId("name")).toHaveText("Alice");
  await expect(page.getByTestId("email")).toHaveText("alice@example.com");
});
