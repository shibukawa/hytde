import * as path from "node:path";
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
  await page.waitForFunction(() => {
    const file = window.hyState?.s3Result?.file;
    if (Array.isArray(file)) {
      return file.some((entry) => entry?.fileId);
    }
    return Boolean(file?.fileId);
  });
  const s3Result = await page.evaluate(() => window.hyState?.s3Result);
  const s3File = s3Result?.file;
  const s3FileId = Array.isArray(s3File) ? s3File.find((entry) => entry?.fileId)?.fileId : s3File?.fileId;
  expect(s3FileId).toBeTruthy();

  const simpleForm = page.locator('form[action="/api/uploads/submit/simple"]');
  await simpleForm.locator('input[name="title"]').fill("Acceptance Simple");
  await simpleForm.locator('input[type="file"]').setInputFiles(fixtureA);
  await simpleForm.locator('button[type="submit"]').click();
  await page.waitForFunction(() => {
    const file = window.hyState?.simpleResult?.file;
    if (Array.isArray(file)) {
      return file.some((entry) => entry?.fileId);
    }
    return Boolean(file?.fileId);
  });
  const simpleResult = await page.evaluate(() => window.hyState?.simpleResult);
  const simpleFile = simpleResult?.file;
  const simpleFileId = Array.isArray(simpleFile)
    ? simpleFile.find((entry) => entry?.fileId)?.fileId
    : simpleFile?.fileId;
  expect(simpleFileId).toBeTruthy();
});

test("async upload redirect navigates on success", async ({ page }) => {
  await page.goto("/acceptance/async-upload-redirect.html");
  await page.locator('input[type="file"]').setInputFiles(fixtureA);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/acceptance\/basic(?:\.html)?$/);
  await expect(page.getByTestId("name")).toHaveText("Alice");
});
