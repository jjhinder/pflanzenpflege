// Fotos des Haushalts.
// GET  /api/photo?id=<id>                     → das Bild
// POST /api/photo { id?, type, data(base64) } → { id }
import { randomBytes } from "node:crypto";
import { cmd, pipe } from "../lib/store.js";
import { send, bodyOf, wrap, requireAuth } from "../lib/core.js";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 2500000;
const MAX_PHOTOS = 3000;

export default wrap(async function handler(req, res) {
  const a = await requireAuth(req, res);
  if (!a) return;
  const H = `hh:${a.hh.id}`;

  if (req.method === "GET") {
    const id = String((req.query && req.query.id) || new URL(req.url, "http://x").searchParams.get("id") || "");
    if (!ID_RE.test(id)) return send(res, 400, { code: "bad_request" });
    const raw = await cmd("GET", `${H}:ph:${id}`);
    if (!raw) return send(res, 404, { code: "not_found" });
    let p;
    try { p = JSON.parse(raw); } catch { return send(res, 404, { code: "not_found" }); }
    const buf = Buffer.from(p.d, "base64");
    res.statusCode = 200;
    res.setHeader("content-type", TYPES.has(p.t) ? p.t : "image/jpeg");
    res.setHeader("content-length", buf.length);
    res.setHeader("cache-control", "private, max-age=31536000, immutable");
    return res.end(buf);
  }
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });

  const b = bodyOf(req);
  const id = b.id == null || b.id === "" ? randomBytes(16).toString("hex") : String(b.id);
  if (!ID_RE.test(id) || !TYPES.has(b.type) || typeof b.data !== "string") return send(res, 400, { code: "image_rejected" });
  const size = Math.floor(b.data.length * 3 / 4);
  if (size > MAX_BYTES) return send(res, 413, { code: "quota_exceeded" });
  if ((Number(await cmd("HLEN", H + ":phs")) || 0) >= MAX_PHOTOS) return send(res, 413, { code: "quota_exceeded" });
  await pipe(["SET", `${H}:ph:${id}`, JSON.stringify({ t: b.type, d: b.data })], ["HSET", H + ":phs", id, size]);
  return send(res, 200, { id });
});
