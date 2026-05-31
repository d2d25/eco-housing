import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve("outputs");
const port = Number(process.env.PORT ?? 4173);
const host = "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(root, requested);

    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Eco Housing app: http://${host}:${port}`);
});
