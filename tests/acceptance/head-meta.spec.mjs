import { expect, test } from "@playwright/test";

test("head meta bindings apply from store", async ({ page }) => {
  await page.goto("/acceptance/head-meta.html");
  await expect(page).toHaveTitle("SEO Title");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "OG Title");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "SEO description");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://example.com/seo");
  await expect(page.locator('link[rel="alternate"]')).toHaveAttribute("href", "https://example.com/seo-ja");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon-seo.png");
  await expect(page.locator('link[rel="stylesheet"]:not([data-hytde-tailwind])')).toHaveAttribute(
    "href",
    "/styles-seo.css"
  );
  await expect(
    page.locator('head [hy], head [hy-attr-content], head [hy-attr-href], head [hy-href]')
  ).toHaveCount(0);
});

test("head meta bindings remove elements on null or error", async ({ page }) => {
  await page.goto("/acceptance/head-meta-null.html");
  await expect(page.locator("title")).toHaveCount(0);
  await expect(page.locator('meta[property="og:missing"]')).toHaveCount(0);
  await expect(page.locator('meta[name="twitter:error"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(
    page.locator('head [hy], head [hy-attr-content], head [hy-attr-href], head [hy-href]')
  ).toHaveCount(0);
});
