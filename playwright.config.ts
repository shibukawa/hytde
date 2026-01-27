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
      reuseExistingServer: true,
      timeout: 180_000
    },
    {
      command: "HYTDE_DEMO_DEBUG=true npm run dev -w packages/demo -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 180_000
    },
    {
      command: "HYTDE_DEMO_DEBUG=true HYTDE_DEMO_PATH_MODE=path npm run dev -w packages/demo -- --host 127.0.0.1 --port 5176",
      url: "http://127.0.0.1:5176",
      reuseExistingServer: true,
      timeout: 180_000
    },
    {
      command: "bash scripts/build-and-serve-precompiled-e2e.sh",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 180_000
    },
    {
      command: "npm run ssr:dev -w packages/demo",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
      timeout: 180_000
    },
    {
      command: "bash scripts/build-and-serve-precompiled-spa-e2e.sh",
      url: "http://127.0.0.1:5179",
      reuseExistingServer: false,
      timeout: 180_000
    },
    {
      command: "bash scripts/build-and-serve-precompiled-spa-path-e2e.sh",
      url: "http://127.0.0.1:5180",
      reuseExistingServer: false,
      timeout: 180_000
    },
    {
      command: "bash scripts/build-and-serve-standalone-regression-e2e.sh",
      url: "http://127.0.0.1:5177/index.html",
      reuseExistingServer: false,
      timeout: 180_000
    },
    {
      command: "bash scripts/build-and-serve-precompiled-subpath-e2e.sh",
      url: "http://127.0.0.1:5178/project/acceptance/msw/project/deep/index.html",
      reuseExistingServer: false,
      timeout: 180_000
    }
  ],
  projects: [
    {
      name: "runtime-vite",
      testIgnore: ["**/spa-*.spec.mjs"],
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5173"
      }
    },
    {
      name: "runtime-vite-path",
      testIgnore: ["**/spa-*.spec.mjs"],
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5176"
      }
    },
    {
      name: "precompiled",
      testIgnore: ["**/spa-*.spec.mjs"],
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5174"
      }
    },
    {
      name: "ssr",
      testIgnore: ["**/spa-*.spec.mjs"],
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5175"
      }
    },
    {
      name: "precompiled-spa",
      testMatch: ["**/spa-*.spec.mjs"],
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5179"
      }
    },
    {
      name: "precompiled-spa-path",
      testMatch: ["**/spa-*.spec.mjs"],
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5180"
      }
    },
    {
      name: "regression-static",
      testDir: "tests/acceptance/regression",
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5177"
      }
    },
    {
      name: "precompiled-subpath",
      testDir: "tests/acceptance/regression",
      use: {
        ...devices["desktop-chrome"],
        baseURL: "http://127.0.0.1:5178"
      }
    }
  ]
});
