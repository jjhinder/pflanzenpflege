// Gemeinsame Bausteine der Serverfunktionen: Antworten, Cookies, Passwörter, Sitzungen, Haushalte.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";
import { promisify } from "node:util";
import { cmd, pipe, getJson, setJson, storeSecret } from "./store.js";

const scrypt = promisify(scryptCb);
export const SESSION_DAYS = 180;
const COOKIE = "pp_s";

export const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
};
export const bodyOf = req => (req.body && typeof req.body === "object" ? req.body : {});
export const sha = s => createHash("sha256").update(String(s)).digest("hex");
const ALNUM = "abcdefghijkmnpqrstuvwxyz23456789";
export const rid = (n = 12, abc = ALNUM) => Array.from(randomBytes(n), b => abc[b % abc.length]).join("");
export const clientIp = req => String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "?").split(",")[0].trim();

/* ---------- Passwörter ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = await scrypt(String(pw), salt, 64, SCRYPT);
  return `s1$${salt.toString("base64")}$${h.toString("base64")}`;
}
export async function checkPassword(pw, stored) {
  const [v, s, h] = String(stored || "").split("$");
  if (v !== "s1" || !s || !h) return false;
  const want = Buffer.from(h, "base64");
  const got = await scrypt(String(pw), Buffer.from(s, "base64"), want.length, SCRYPT);
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ---------- Verschlüsselung der API-Schlüssel ---------- */
function encKey() {
  const secret = process.env.APP_SECRET || storeSecret() || "nur-lokal";
  return createHash("sha256").update("pflanzenpflege:" + secret).digest();
}
export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString("base64")).join(".");
}
export function decrypt(blob) {
  try {
    const [iv, tag, enc] = String(blob).split(".").map(x => Buffer.from(x, "base64"));
    const d = createDecipheriv("aes-256-gcm", encKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch { return null; }
}

/* ---------- Cookies und Sitzungen ---------- */
function cookies(req) {
  const o = {};
  String(req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* kaputtes Cookie */ } }
  });
  return o;
}
const secure = req => (String(req.headers["x-forwarded-proto"] || "").includes("https") || process.env.VERCEL ? "; Secure" : "");
export const sessionCookie = (req, token) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req)}`;
export const clearCookie = req => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req)}`;

export async function createSession(uid) {
  const token = randomBytes(32).toString("base64url");
  await cmd("SET", "sess:" + sha(token), uid, "EX", SESSION_DAYS * 86400);
  return token;
}
export async function dropSession(req) {
  const t = cookies(req)[COOKIE];
  if (t) await cmd("DEL", "sess:" + sha(t));
}
/** Liefert { user, hh } der angemeldeten Person oder null. */
export async function auth(req, { touch = false } = {}) {
  const t = cookies(req)[COOKIE];
  if (!t || t.length > 100) return null;
  const key = "sess:" + sha(t);
  const uid = await cmd("GET", key);
  if (!uid) return null;
  const user = await getJson("user:" + uid);
  if (!user) return null;
  const hh = await getJson("hh:" + user.hh);
  if (!hh) return null;
  if (touch) await cmd("EXPIRE", key, SESSION_DAYS * 86400);
  return { user, hh };
}
/** Bricht mit 401 ab, wenn niemand angemeldet ist. Schreibende Anfragen müssen JSON sein (Schutz vor fremden Formularen). */
export async function requireAuth(req, res) {
  if (req.method !== "GET" && !String(req.headers["content-type"] || "").includes("application/json")) { send(res, 415, { code: "bad_request" }); return null; }
  const a = await auth(req);
  if (!a) { send(res, 401, { code: "signed_out" }); return null; }
  return a;
}

/* ---------- Bremse gegen Durchprobieren ---------- */
export async function tooMany(key, max, seconds) {
  const [n] = await pipe(["INCR", "rl:" + key], ["EXPIRE", "rl:" + key, seconds]);
  return Number(n) > max;
}

/* ---------- Haushalte ---------- */
export const saveHousehold = hh => setJson("hh:" + hh.id, hh);
export const saveUser = u => setJson("user:" + u.id, u);
export async function newHousehold(name, uid) {
  const hh = { id: rid(12), name: String(name).slice(0, 60), members: [uid], createdAt: new Date().toISOString() };
  await saveHousehold(hh);
  return hh;
}
export async function householdView(hh, me) {
  const users = await Promise.all(hh.members.map(id => getJson("user:" + id)));
  return {
    id: hh.id,
    name: hh.name,
    members: users.filter(Boolean).map(u => ({ id: u.id, name: u.name, me: u.id === me.id })),
    ai: hh.key ? { hint: hh.key.hint, by: hh.key.byName || "", at: hh.key.at } : null
  };
}
export const meView = async ({ user, hh }) => ({ user: { id: user.id, name: user.name, login: user.login }, household: await householdView(hh, user) });

/** Eine Anfrage-Funktion, die Fehler sauber als 500/503 meldet. */
export const wrap = fn => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) {
    console.error("Serverfehler:", e && e.message);
    if (!res.headersSent) send(res, 503, { code: "unavailable" });
  }
};
