import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureA = path.join(__dirname, "..", "fixtures", "upload-a.txt");
const fixtureB = path.join(__dirname, "..", "fixtures", "upload-b.txt");

test("async uploads complete for s3 and simple", async ({ page }) => {
  await page.goto("/async-file-upload.html");

  const s3Form = page.locator('form[action="/api/uploads/submit/s3"]');
  await s3Form.locator('input[name="title"]').fill("Acceptance S3");
  await s3Form.locator('input[type="file"]').setInputFiles([fixtureA, fixtureB]);
  await s3Form.locator('button[type="submit"]').click();
  await page.waitForFunction(() => (window as any).hyState?.s3Result);
  const s3Result = await page.evaluate(() => (window as any).hyState?.s3Result);
  expect(s3Result?.file?.fileId).toBeTruthy();

  const simpleForm = page.locator('form[action="/api/uploads/submit/simple"]');
  await simpleForm.locator('input[name="title"]').fill("Acceptance Simple");
  await simpleForm.locator('input[type="file"]').setInputFiles(fixtureA);
  await simpleForm.locator('button[type="submit"]').click();
  await page.waitForFunction(() => (window as any).hyState?.simpleResult);
  const simpleResult = await page.evaluate(() => (window as any).hyState?.simpleResult);
  expect(simpleResult?.file?.fileId).toBeTruthy();
});

test("async upload redirect navigates on success", async ({ page }) => {
  await page.goto("/acceptance/async-upload-redirect.html");
  await page.locator('input[type="file"]').setInputFiles(fixtureA);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/acceptance/basic.html");
  await expect(page.getByTestId("name")).toHaveText("Alice");
});
