import { expect, test } from "@playwright/test";

test("missing transform records error", async ({ page }) => {
  await page.goto("/acceptance/transform-error.html");
  await page.waitForFunction(() => window.hy && window.hy.errors.length > 0);
  const hasTransformError = await page.evaluate(() =>
    window.hy?.errors?.some((entry) => entry.type === "transform")
  );
  expect(hasTransformError).toBe(true);
});

test("invalid hy-for records error", async ({ page }) => {
  await page.goto("/acceptance/invalid-for.html");
  await page.waitForFunction(() => window.hy && window.hy.errors.length > 0);
  const errorCount = await page.evaluate(() => window.hy?.errors?.length ?? 0);
  expect(errorCount).toBeGreaterThan(0);
});

test("request failure records error", async ({ page }) => {
  await page.goto("/acceptance/request-error.html");
  await page.waitForFunction(() => window.hy && window.hy.errors.length > 0);
  const hasRequestError = await page.evaluate(() =>
    window.hy?.errors?.some((entry) => entry.type === "request")
  );
  expect(hasRequestError).toBe(true);
});
