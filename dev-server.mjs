// Lokaler Testserver: liefert die App aus public/ und die Serverfunktionen unter /api/….
// Start: npm run dev  (ohne KV_REST_API_URL/KV_REST_API_TOKEN liegen die Daten nur im Arbeitsspeicher)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import claude from "./api/claude.js";
import auth from "./api/auth.js";
import household from "./api/household.js";
import data from "./api/data.js";
import photo from "./api/photo.js";

const API = { "/api/claude": claude, "/api/auth": auth, "/api/household": household, "/api/data": data, "/api/photo": photo };

const PORT = Number(process.env.PORT) || 3000;
const ROOT = join(process.cwd(), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (API[url.pathname]) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    req.query = Object.fromEntries(url.searchParams);
    return API[url.pathname](req, res);
  }
  const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const data = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("Nicht gefunden");
  }
}).listen(PORT, () => console.log(`Pflanzenpflege läuft auf http://localhost:${PORT}`));
