// Pflanzen und Einstellungen des Haushalts. Alle Geräte im Haushalt lesen und schreiben dieselben Daten.
// GET  /api/data?since=<ver>  → { ver, docs } (oder { ver, same: true }, wenn sich nichts geändert hat)
// POST /api/data { ops: [{ op: "set"|"update"|"delete", path, value|patch }] } → { ver, docs: { path: neuerWert|null } }
import { pipe, cmd, pairs } from "../lib/store.js";
import { send, bodyOf, wrap, requireAuth } from "../lib/core.js";

const PATH_RE = /^(plants|settings)\/[A-Za-z0-9_-]{1,64}$/;
const MAX_DOC = 1500000;
const MAX_DOCS = 2000;
const MAX_OPS = 200;

function applyPatch(base, patch) {
  const out = Object.assign({}, base);
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === "__proto__" || k === "constructor") continue;
    if (v && typeof v === "object" && !Array.isArray(v) && v.__delete__ === true) delete out[k];
    else out[k] = v;
  }
  return out;
}
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);

export default wrap(async function handler(req, res) {
  const a = await requireAuth(req, res);
  if (!a) return;
  const H = `hh:${a.hh.id}`;

  if (req.method === "GET") {
    const since = String((req.query && req.query.since) || new URL(req.url, "http://x").searchParams.get("since") || "");
    const ver = Number(await cmd("GET", H + ":ver")) || 0;
    if (since !== "" && Number(since) === ver) return send(res, 200, { ver, same: true });
    const [raw, ver2] = await pipe(["HGETALL", H + ":docs"], ["GET", H + ":ver"]);
    const docs = {};
    for (const [k, v] of Object.entries(pairs(raw))) { try { docs[k] = JSON.parse(v); } catch { /* defekter Eintrag */ } }
    return send(res, 200, { ver: Number(ver2) || 0, docs });
  }
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });

  const ops = bodyOf(req).ops;
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) return send(res, 400, { code: "bad_request" });
  for (const o of ops) {
    if (!o || !PATH_RE.test(String(o.path)) || !["set", "update", "delete"].includes(o.op)) return send(res, 400, { code: "bad_request" });
    if (o.op === "set" && !isObj(o.value)) return send(res, 400, { code: "bad_request" });
    if (o.op === "update" && !isObj(o.patch)) return send(res, 400, { code: "bad_request" });
  }

  // Aktuelle Stände für Teil-Änderungen holen, damit gleichzeitige Änderungen anderer Felder erhalten bleiben.
  const upd = [...new Set(ops.filter(o => o.op === "update").map(o => o.path))];
  const cur = {};
  if (upd.length) {
    const got = await pipe(...upd.map(p => ["HGET", H + ":docs", p]));
    upd.forEach((p, i) => { try { cur[p] = got[i] == null ? undefined : JSON.parse(got[i]); } catch { cur[p] = undefined; } });
  }
  const out = {};
  for (const o of ops) {
    if (o.op === "delete") { cur[o.path] = null; out[o.path] = null; continue; }
    if (o.op === "set") { cur[o.path] = o.value; out[o.path] = o.value; continue; }
    if (cur[o.path] === undefined || cur[o.path] === null) return send(res, 404, { code: "not_found" });
    cur[o.path] = applyPatch(cur[o.path], o.patch);
    out[o.path] = cur[o.path];
  }

  const cmds = [];
  const sets = [], dels = [];
  for (const [p, v] of Object.entries(out)) {
    if (v === null) { dels.push(p); continue; }
    const s = JSON.stringify(v);
    if (s.length > MAX_DOC) return send(res, 413, { code: "quota_exceeded" });
    sets.push(p, s);
  }
  if (sets.length) {
    const n = Number(await cmd("HLEN", H + ":docs")) || 0;
    if (n + sets.length / 2 > MAX_DOCS) return send(res, 413, { code: "quota_exceeded" });
    cmds.push(["HSET", H + ":docs", ...sets]);
  }
  if (dels.length) cmds.push(["HDEL", H + ":docs", ...dels]);
  cmds.push(["INCR", H + ":ver"]);
  const r = await pipe(...cmds);
  return send(res, 200, { ver: Number(r[r.length - 1]) || 0, docs: out });
});
