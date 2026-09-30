// Servidor de Skola personal: sirve la PWA ya compilada y guarda los mazos suscritos.
//   GET  /api/feeds/:id   token de lectura (o de escritura)  → el feed en JSON
//   PUT  /api/feeds/:id   token de escritura                → sustituye el feed (guarda el anterior)
//   GET  /api/health                                         → ok
// Todo lo demás son ficheros estáticos de la PWA, con vuelta a index.html.
import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir, stat, copyFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { join, normalize, extname } from "node:path";

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATIC_DIR = process.env.STATIC_DIR || join(process.cwd(), "dist");
const READ_TOKEN = process.env.READ_TOKEN || "";
const WRITE_TOKEN = process.env.WRITE_TOKEN || "";
const MAX_BODY = 5 * 1024 * 1024;
const FEEDS = join(DATA_DIR, "feeds");
const ID_RE = /^[a-z0-9-]{1,40}$/;

if (READ_TOKEN.length < 24 || WRITE_TOKEN.length < 24 || READ_TOKEN === WRITE_TOKEN) {
  console.error("READ_TOKEN y WRITE_TOKEN deben existir, ser distintos y tener al menos 24 caracteres");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

const SECURITY = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY, ...(isBuf ? {} : { "Content-Type": "application/json; charset=utf-8" }), ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}

function tokenOk(req, ...allowed) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return false;
  const given = Buffer.from(h.slice(7));
  return allowed.some((t) => {
    const want = Buffer.from(t);
    return given.length === want.length && timingSafeEqual(given, want);
  });
}

function validFeed(f) {
  return f && f.format === "skola-feed/1" && typeof f.name === "string" && Array.isArray(f.decks) && Array.isArray(f.notes)
    && f.notes.every((n) => n && typeof n.id === "string" && (n.type === "basic" || n.type === "cloze"));
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error("too large"), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleFeed(req, res, id) {
  if (!ID_RE.test(id)) return send(res, 400, { error: "id no válido" });
  const file = join(FEEDS, `${id}.json`);
  if (req.method === "GET") {
    if (!tokenOk(req, READ_TOKEN, WRITE_TOKEN)) return send(res, 401, { error: "no autorizado" });
    try { return send(res, 200, await readFile(file), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); }
    catch { return send(res, 404, { error: "no existe" }); }
  }
  if (req.method === "PUT") {
    if (!tokenOk(req, WRITE_TOKEN)) return send(res, 401, { error: "no autorizado" });
    let feed;
    try { feed = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: e.status ? "demasiado grande" : "JSON no válido" }); }
    if (!validFeed(feed)) return send(res, 422, { error: "no es un skola-feed/1 válido" });
    await mkdir(FEEDS, { recursive: true });
    try { await copyFile(file, join(FEEDS, `${id}.prev.json`)); } catch { /* primera versión */ }
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(feed));
    await rename(tmp, file);
    return send(res, 200, { ok: true, notes: feed.notes.length, decks: feed.decks.length });
  }
  return send(res, 405, { error: "método no permitido" }, { Allow: "GET, PUT" });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "método no permitido" });
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  if (rel.split(/[/\\]/).includes("..")) return send(res, 400, { error: "ruta no válida" });
  let file = join(STATIC_DIR, rel);
  try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = join(STATIC_DIR, "index.html"); }
  const ext = extname(file);
  const noCache = file.endsWith("index.html") || file.endsWith("sw.js") || ext === ".webmanifest";
  const body = await readFile(file);
  res.writeHead(200, { ...SECURITY, "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": noCache ? "no-cache" : "public, max-age=31536000, immutable" });
  res.end(req.method === "HEAD" ? undefined : body);
}

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/api/health") return send(res, 200, { ok: true });
    const m = pathname.match(/^\/api\/feeds\/([^/]+)$/);
    if (m) return await handleFeed(req, res, m[1]);
    if (pathname.startsWith("/api/")) return send(res, 404, { error: "no existe" });
    return await serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "error interno" });
  }
}).listen(PORT, () => console.log(`skola escuchando en :${PORT}`));
