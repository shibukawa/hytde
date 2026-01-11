import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.HYTDE_DEMO_API_PORT ?? "8787");
const demoDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const publicDir = resolve(demoDir, "public");

const app = new Hono();
const fixtureCache = new Map();

function resolveFixturePath(fixturePath) {
  const relativePath = fixturePath.startsWith("/") ? fixturePath.slice(1) : fixturePath;
  return resolve(publicDir, relativePath);
}

async function loadFixture(fixturePath) {
  if (fixtureCache.has(fixturePath)) {
    return fixtureCache.get(fixturePath);
  }
  const fullPath = resolveFixturePath(fixturePath);
  const raw = await readFile(fullPath, "utf8");
  const data = JSON.parse(raw);
  fixtureCache.set(fixturePath, data);
  return data;
}

async function respondWithFixture(c, fixturePath, status = 200) {
  if (status === 204) {
    return c.body(null, status);
  }
  const payload = await loadFixture(fixturePath);
  return c.json(payload, status);
}

function registerRoute(method, path, fixturePath, status = 200) {
  const handler = async (c) => {
    if (method !== "GET") {
      try {
        await c.req.parseBody();
      } catch {
        // ignore parse errors for non-form payloads
      }
    }
    console.info("[hytde] demo:api", { method, path, status, fixturePath });
    return respondWithFixture(c, fixturePath, status);
  };
  const lower = method.toLowerCase();
  if (typeof app[lower] === "function") {
    app[lower](path, handler);
  }
}

// Specific routes
registerRoute("GET", "/api/users/1", "/mocks/user-detail.json");
registerRoute("GET", "/api/users/100", "/mocks/users/100.json");
registerRoute("GET", "/api/users/101", "/mocks/users/101.json");
registerRoute("GET", "/api/users/102", "/mocks/users/102.json");
registerRoute("GET", "/api/users/100.json", "/mocks/users/100.json");
registerRoute("GET", "/api/users/101.json", "/mocks/users/101.json");
registerRoute("GET", "/api/users/102.json", "/mocks/users/102.json");
registerRoute("GET", "/api/users/100/detail.json", "/mocks/users/100-detail.json");
registerRoute("GET", "/api/users/101/detail.json", "/mocks/users/101-detail.json");
registerRoute("GET", "/api/users/102/detail.json", "/mocks/users/102-detail.json");
registerRoute("GET", "/api/users", "/mocks/path-parameter-users.json");
registerRoute("GET", "/api/notifications", "/mocks/notifications.json");
registerRoute("GET", "/api/orders", "/mocks/table-orders.json");
registerRoute("GET", "/api/categories", "/archive/mocks/cascading/categories.json");
registerRoute("GET", "/api/subcategories/a1", "/archive/mocks/cascading/subcategories-a1.json");
registerRoute("GET", "/api/items/b1", "/archive/mocks/cascading/items-b1.json");

// Parameterized routes
app.get("/api/users/:userId", async (c) => {
  const userId = c.req.param("userId");
  if (userId === "1") {
    return respondWithFixture(c, "/mocks/user-detail.json");
  }
  return respondWithFixture(c, "/mocks/user.json");
});

// POST routes
registerRoute("POST", "/api/profile/update", "/mocks/profile-update.json", 200);
registerRoute("POST", "/api/profile/title", "/mocks/profile-update.json", 200);
registerRoute("POST", "/api/profile/name", "/mocks/user-error.json", 422);
registerRoute("POST", "/api/users/register", "/mocks/register.json", 201);
registerRoute("POST", "/api/users/1", "/mocks/user.json", 201);
registerRoute("POST", "/api/users/1/fail", "/mocks/user-error.json", 422);
registerRoute("POST", "/api/users/1/avatar", "/mocks/user.json", 204);

app.all("*", (c) => c.json({ error: "not_found" }, 404));

serve({ fetch: app.fetch, port: PORT });
console.info(`[hytde] demo:api listening on http://localhost:${PORT}`);
