// Zentraler Speicher: Upstash Redis über die REST-Schnittstelle (kostenlos über den Vercel-Marketplace).
// Ohne Zugangsdaten (lokal zum Ausprobieren) läuft ein flüchtiger Speicher im Arbeitsspeicher.
const URL_ = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const storeConfigured = () => !!(URL_ && TOKEN);
export const storeSecret = () => TOKEN;

async function remote(cmds) {
  const r = await fetch(URL_ + "/pipeline", {
    method: "POST",
    headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error("store_http_" + r.status);
  const out = await r.json();
  return out.map(x => { if (x && x.error) throw new Error("store: " + x.error); return x ? x.result : null; });
}

/* ---------- Speicher im Arbeitsspeicher (nur für lokale Tests) ---------- */
const mem = globalThis.__ppMem || (globalThis.__ppMem = { kv: new Map(), exp: new Map() });
function alive(k) {
  const e = mem.exp.get(k);
  if (e && e <= Date.now()) { mem.kv.delete(k); mem.exp.delete(k); }
  return mem.kv.has(k);
}
const hash = k => { if (!alive(k)) mem.kv.set(k, new Map()); return mem.kv.get(k); };
function local1(c) {
  const [op, k, ...a] = c;
  switch (String(op).toUpperCase()) {
    case "GET": return alive(k) ? mem.kv.get(k) : null;
    case "SET": {
      let nx = false, ex = 0;
      for (let i = 1; i < a.length; i++) { const f = String(a[i]).toUpperCase(); if (f === "NX") nx = true; if (f === "EX") ex = Number(a[++i]); }
      if (nx && alive(k)) return null;
      mem.kv.set(k, String(a[0])); mem.exp.delete(k);
      if (ex) mem.exp.set(k, Date.now() + ex * 1000);
      return "OK";
    }
    case "DEL": { let n = 0; [k, ...a].forEach(x => { if (alive(x)) { mem.kv.delete(x); mem.exp.delete(x); n++; } }); return n; }
    case "INCR": { const v = Number(alive(k) ? mem.kv.get(k) : 0) + 1; mem.kv.set(k, String(v)); return v; }
    case "EXPIRE": if (!alive(k)) return 0; mem.exp.set(k, Date.now() + Number(a[0]) * 1000); return 1;
    case "HGET": return alive(k) ? (mem.kv.get(k).get(a[0]) ?? null) : null;
    case "HSET": { const h = hash(k); let n = 0; for (let i = 0; i < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], String(a[i + 1])); } return n; }
    case "HDEL": { if (!alive(k)) return 0; const h = mem.kv.get(k); let n = 0; a.forEach(f => { if (h.delete(f)) n++; }); return n; }
    case "HGETALL": { if (!alive(k)) return []; const o = []; mem.kv.get(k).forEach((v, f) => o.push(f, v)); return o; }
    case "HKEYS": return alive(k) ? [...mem.kv.get(k).keys()] : [];
    case "HLEN": return alive(k) ? mem.kv.get(k).size : 0;
    case "HINCRBY": { const h = hash(k); const v = Number(h.get(a[0]) || 0) + Number(a[1]); h.set(a[0], String(v)); return v; }
    case "HVALS": return alive(k) ? [...mem.kv.get(k).values()] : [];
    default: throw new Error("memstore: " + op);
  }
}
let warned = false;
async function local(cmds) {
  if (!warned) { warned = true; console.warn("Kein Redis konfiguriert: Daten liegen nur im Arbeitsspeicher und gehen beim Neustart verloren."); }
  return cmds.map(c => local1(c.map(x => (typeof x === "number" ? String(x) : x))));
}

/** Mehrere Befehle in einem Aufruf, z. B. pipe(["GET","a"],["INCR","b"]) */
export const pipe = (...cmds) => (storeConfigured() ? remote(cmds) : local(cmds));
export const cmd = async (...c) => (await pipe(c))[0];

export const getJson = async k => { const v = await cmd("GET", k); if (v == null) return null; try { return JSON.parse(v); } catch { return null; } };
export const setJson = (k, v, ...opts) => cmd("SET", k, JSON.stringify(v), ...opts);
export function pairs(arr) {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i + 1 < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  else if (arr && typeof arr === "object") Object.assign(o, arr);
  return o;
}
