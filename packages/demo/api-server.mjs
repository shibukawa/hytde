import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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
registerRoute("GET", "/api/notifications/empty", "/mocks/notifications-empty.json");
registerRoute("GET", "/api/notifications/single", "/mocks/notifications-single.json");
registerRoute("GET", "/api/head-meta", "/mocks/head-meta.json");
registerRoute("GET", "/api/head-meta-error", "/mocks/head-meta-error.json", 500);
registerRoute("GET", "/api/orders", "/mocks/table-orders.json");
registerRoute("GET", "/api/categories", "/mocks/cascading/categories.json");
registerRoute("GET", "/api/subcategories/a1", "/mocks/cascading/subcategories-a1.json");
registerRoute("GET", "/api/items/b1", "/mocks/cascading/items-b1.json");

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

function normalizeToken(value) {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildS3Path(uploadUuid, inputName, fileName = "file.bin") {
  return `/s3/${normalizeToken(uploadUuid)}/${normalizeToken(inputName)}/${normalizeToken(fileName)}`;
}

function buildSimplePath(uploadUuid, inputName, fileName = "file.bin") {
  return `/simple/${normalizeToken(uploadUuid)}/${normalizeToken(inputName)}/${normalizeToken(fileName)}`;
}

app.post("/api/uploads/s3/init", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const files = Array.isArray(body?.files) && body.files.length > 0 ? body.files : [{ inputName: "file", chunks: 1, fileName: "file.bin" }];
  const uploads = files.map((file) => {
    const inputName = String(file?.inputName ?? "file");
    const chunks = Number(file?.chunks ?? 1);
    const fileName = String(file?.fileName ?? "file.bin");
    const uploadId = randomUUID();
    return {
      inputName,
      uploadId,
      s3Path: buildS3Path(uploadId, inputName, fileName),
      parts: Array.from({ length: Math.max(1, chunks) }, (_, index) => ({
        partNumber: index + 1,
        url: `/api/uploads/s3/part/${uploadId}/${encodeURIComponent(inputName)}/${index + 1}`
      }))
    };
  });
  return c.json({ uploads });
});

app.put("/api/uploads/s3/part/:uploadUuid/:inputName/:part", async (c) => {
  const part = c.req.param("part");
  c.header("ETag", `etag-${part}`);
  return c.body(null, 200);
});

app.post("/api/uploads/s3/complete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const uploads = Array.isArray(body?.uploads) ? body.uploads : [];
  const files = uploads.map((upload, index) => {
    const inputName = String(upload?.inputName ?? "file");
    const s3Path =
      (typeof upload?.path === "string" && upload.path.length > 0
        ? upload.path
        : typeof upload?.s3Path === "string" && upload.s3Path.length > 0
          ? upload.s3Path
          : buildS3Path(randomUUID(), inputName, `file-${index + 1}`)) ?? "";
    const etags = Array.isArray(upload?.parts)
      ? upload.parts.map((part) => part?.ETag ?? part?.etag ?? null).filter((etag) => typeof etag === "string" && etag.length > 0)
      : [];
    return { inputName, fileId: s3Path, s3Path, etags };
  });
  return c.json({ files });
});

app.post("/api/uploads/simple", async (c) => {
  const body = await c.req.parseBody().catch(() => ({}));
  const inputName = String(body?.inputName ?? "file");
  const fileName = String(body?.fileName ?? "file.bin");
  const path = buildSimplePath(randomUUID(), inputName, fileName);
  return c.json({ inputName, fileId: path, path });
});

app.post("/api/uploads/submit/:mode", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await c.req.json().catch(() => ({}));
    return c.json(payload ?? {});
  }
  const formData = await c.req.parseBody().catch(() => ({}));
  return c.json(formData ?? {});
});

app.all("*", (c) => c.json({ error: "not_found" }, 404));

serve({ fetch: app.fetch, port: PORT });
console.info(`[hytde] demo:api listening on http://localhost:${PORT}`);
