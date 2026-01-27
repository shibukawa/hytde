import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(process.cwd(), "packages", "demo", "dist-spa-path");
const port = Number.parseInt(process.env.PORT ?? "5180", 10);

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

const resolveRequestPath = (pathname) => {
  if (!pathname || pathname === "/") {
    return "/index.html";
  }
  if (pathname.endsWith("/")) {
    return `${pathname}index.html`;
  }
  if (extname(pathname)) {
    return pathname;
  }
  return `${pathname}.html`;
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = resolveRequestPath(decodeURIComponent(url.pathname));
  const absolutePath = resolve(root, `.${pathname}`);
  if (!absolutePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const file = await readFile(absolutePath);
    res.writeHead(200, { "content-type": contentTypeFor(absolutePath) });
    res.end(req.method === "HEAD" ? "" : file);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.listen(port, () => {
  console.log(`[spa-path] server at http://127.0.0.1:${port}`);
});
