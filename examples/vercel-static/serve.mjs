/**
 * Minimal local runner that mimics Vercel's routing for this project:
 * every request goes through the proxy first; when the proxy answers with
 * `x-middleware-next: 1` (what `@vercel/functions`' `next()` returns) the
 * request continues to a function under api/ or a static file under public/.
 *
 * `vercel dev` is the full-fidelity way to run this; this runner exists so the
 * example can be smoke-tested without a Vercel login.
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import proxy from "@dgodolias/access-gate/vercel";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const apiDir = path.join(root, "api");
const port = Number(process.env.PORT || 3000);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function toRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader("set-cookie", cookies);
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  res.end(body);
}

function inside(base, target) {
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function serveApp(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    const file = path.resolve(apiDir, `.${pathname.slice(4)}.js`);
    if (!inside(apiDir, file)) return new Response("Not found", { status: 404 });
    try {
      await stat(file);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const mod = await import(pathToFileURL(file).href);
    return mod.default(request);
  }

  // cleanUrls: "/" -> index.html, "/about" -> about.html
  const candidates = pathname === "/" ? ["index.html"] : [pathname.slice(1), `${pathname.slice(1)}.html`];
  for (const candidate of candidates) {
    const file = path.resolve(publicDir, candidate);
    if (!inside(publicDir, file)) continue;
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      const body = await readFile(file);
      return new Response(body, { headers: { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" } });
    } catch {
      // try next candidate
    }
  }
  return new Response("Not found", { status: 404 });
}

http
  .createServer(async (req, res) => {
    try {
      const request = toRequest(req);
      const gated = await proxy(request);
      if (gated.headers.get("x-middleware-next") === "1") return await send(res, await serveApp(request));
      return await send(res, gated);
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.end("Internal error");
    }
  })
  .listen(port, () => console.log(`vercel-static example listening on http://localhost:${port}`));
