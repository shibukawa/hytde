import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/acceptance",
  timeout: 30_000,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "runtime-vite",
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5173"
      },
      webServer: {
        command: "npm run dev -w packages/demo -- --host 127.0.0.1 --port 5173",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true
      }
    },
    {
      name: "precompiled",
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5174"
      },
      webServer: {
        command: "bash scripts/build-and-serve-precompiled.sh",
        url: "http://127.0.0.1:5174",
        reuseExistingServer: false
      }
    }
  ]
});
