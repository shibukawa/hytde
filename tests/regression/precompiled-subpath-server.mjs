import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const root = resolve(process.cwd(), "packages", "demo", "dist-subpath");
const port = Number.parseInt(process.env.PORT ?? "5178", 10);
const prefix = "/project";

const contentTypeFor = (path) => {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  const stripped = url.pathname.slice(prefix.length) || "/";
  const pathname = stripped === "/" ? "/index.html" : stripped;
  const absolutePath = resolve(root, `.${pathname}`);
  if (!absolutePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const file = await readFile(absolutePath);
    res.writeHead(200, { "content-type": contentTypeFor(absolutePath) });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.listen(port, () => {
  console.log(`[msw-regression] precompiled subpath server at http://127.0.0.1:${port}${prefix}`);
});
