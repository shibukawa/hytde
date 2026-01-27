import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const root = resolve(process.cwd(), "tests", "regression", "site-root");
const port = Number.parseInt(process.env.PORT ?? "5177", 10);

const contentTypeFor = (path) => {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
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
  console.log(`[msw-regression] static server at http://127.0.0.1:${port}`);
});
