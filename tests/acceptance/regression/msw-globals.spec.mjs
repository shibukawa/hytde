import { expect, test } from "@playwright/test";

test("msw globals are exposed by debug runtimes", async ({ page }, testInfo) => {
  const allowedProjects = new Set(["regression-static", "precompiled-subpath"]);
  if (!allowedProjects.has(testInfo.project.name)) {
    testInfo.skip(`msw globals are only asserted in ${[...allowedProjects].join(", ")}`);
  }
  const basePath = testInfo.project.name === "precompiled-subpath" ? "/project" : "";
  await page.goto(`${basePath}/acceptance/msw-globals.html`);
  await expect(page.getByTestId("todo-title")).toHaveText("Globals OK");
  const globals = await page.evaluate(() => ({
    http: typeof globalThis.http,
    HttpResponse: typeof globalThis.HttpResponse,
    delay: typeof globalThis.delay,
    sse: typeof globalThis.sse
  }));
  expect(globals.http).not.toBe("undefined");
  expect(globals.HttpResponse).not.toBe("undefined");
  expect(globals.delay).not.toBe("undefined");
  expect(globals.sse).not.toBe("undefined");
});
