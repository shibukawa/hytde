import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/acceptance",
  timeout: 30_000,
  use: {
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: "npm run demo:api",
      url: "http://127.0.0.1:8787/api/users/1",
      reuseExistingServer: true
    },
    {
      command: "HYTDE_DEMO_DEBUG=true npm run dev -w packages/demo -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true
    },
    {
      command: "bash scripts/build-and-serve-precompiled.sh",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false
    }
  ],
  projects: [
    {
      name: "runtime-vite",
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5173"
      }
    },
    {
      name: "precompiled",
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5174"
      }
    }
  ]
});
