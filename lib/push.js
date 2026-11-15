// Push-Benachrichtigungen (Web Push mit VAPID).
// Die VAPID-Schlüssel erzeugt der Server beim ersten Gebrauch selbst und legt sie in Redis ab
// (der private Schlüssel verschlüsselt). Wer will, kann sie auch fest in VAPID_PUBLIC_KEY und
// VAPID_PRIVATE_KEY setzen.
import webpush from "web-push";
import { cmd, getJson, pairs } from "./store.js";
import { encrypt, decrypt, sha } from "./core.js";
import "../public/schedule.js";

const S = globalThis.PPSchedule;
export const TZ = process.env.APP_TIMEZONE || "Europe/Zurich";
const SUBS = "push:subs";

let cached = null;
export async function vapid() {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return cached;
  }
  let v = await getJson("cfg:vapid");
  let priv = v ? decrypt(v.priv) : null;
  if (!v || !priv) {
    // Noch keine Schlüssel (oder APP_SECRET wurde geändert): neue erzeugen. Alte Abos passen dann nicht mehr.
    const k = webpush.generateVAPIDKeys();
    if (v) await cmd("DEL", "cfg:vapid", SUBS);
    await cmd("SET", "cfg:vapid", JSON.stringify({ pub: k.publicKey, priv: encrypt(k.privateKey) }), "NX");
    v = await getJson("cfg:vapid");
    priv = v ? decrypt(v.priv) : null;
    if (!priv) throw new Error("vapid_unavailable");
  }
  cached = { publicKey: v.pub, privateKey: priv };
  return cached;
}

function subject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "pflanzenpflege.vercel.app";
  return "https://" + host.replace(/^https?:\/\//, "");
}

export const subId = endpoint => sha(endpoint).slice(0, 32);
export async function addSub(user, sub) {
  await cmd("HSET", SUBS, subId(sub.endpoint), JSON.stringify({ uid: user.id, sub, at: new Date().toISOString() }));
}
export const removeSub = endpoint => cmd("HDEL", SUBS, subId(endpoint));
export async function allSubs() {
  const out = [];
  for (const [id, raw] of Object.entries(pairs(await cmd("HGETALL", SUBS)))) {
    try { const v = JSON.parse(raw); if (v && v.uid && v.sub && v.sub.endpoint) out.push(Object.assign({ id }, v)); } catch { /* defekter Eintrag */ }
  }
  return out;
}

/** Schickt eine Nachricht. Liefert false, wenn das Abo nicht mehr gilt (dann wurde es gelöscht). */
export async function sendPush(entry, payload) {
  const k = await vapid();
  try {
    await webpush.sendNotification(entry.sub, JSON.stringify(payload), {
      vapidDetails: { subject: subject(), publicKey: k.publicKey, privateKey: k.privateKey },
      TTL: 6 * 3600,
      urgency: "normal",
      topic: "pflanzen"
    });
    return true;
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410 || e.statusCode === 403)) { await cmd("HDEL", SUBS, entry.id); return false; }
    throw e;
  }
}

/* ---------- Inhalt der Erinnerung ---------- */
const nm = p => (typeof p.name === "string" && p.name.trim()) || "Ohne Namen";
function list(ps, max = 3) {
  const names = ps.map(nm);
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} und ${names.length - max} weitere`;
}
export async function householdPlan(hhId) {
  const raw = pairs(await cmd("HGETALL", `hh:${hhId}:docs`));
  const plants = [];
  let settings = {};
  for (const [k, v] of Object.entries(raw)) {
    try {
      if (k.startsWith("plants/")) plants.push(JSON.parse(v));
      else if (k === "settings/app") settings = JSON.parse(v) || {};
    } catch { /* defekter Eintrag */ }
  }
  const t = S.todayIn(TZ);
  return { t, plants, settings, sum: S.summary(plants, t, settings) };
}
export function message({ sum, plants }, test) {
  const { water, fert, repot } = sum;
  const n = water.length + fert.length + repot.length;
  if (!n) {
    if (!test) return null;
    return { title: "Pflanzen", body: plants.length ? "Heute ist nichts zu tun. So sieht die Erinnerung am Morgen aus, wenn etwas ansteht." : "Erinnerungen sind eingeschaltet.", url: "/#heute", badge: 0, tag: "test" };
  }
  const water1 = water.length === 1 ? `${nm(water[0])} braucht heute Wasser.` : water.length ? `${water.length} Pflanzen brauchen heute Wasser: ${list(water)}.` : "";
  const more = [fert.length ? `${fert.length === 1 ? nm(fert[0]) : fert.length + " Pflanzen"} düngen` : "", repot.length ? `${repot.length === 1 ? nm(repot[0]) : repot.length + " Pflanzen"} umtopfen` : ""].filter(Boolean).join(", ");
  const title = water.length ? (water.length === 1 ? "1 Pflanze giessen" : `${water.length} Pflanzen giessen`) : "Pflanzenpflege heute";
  const body = [water1, more ? `Ausserdem: ${more}.` : ""].filter(Boolean).join(" ") || "Heute steht etwas an.";
  return { title, body, url: "/#heute", badge: n, tag: "heute" };
}

/** Erinnerungen an alle Geräte schicken (vom täglichen Cron-Job) */
export async function sendMorning() {
  const subs = await allSubs();
  const users = new Map(), plans = new Map();
  let sent = 0, dropped = 0, failed = 0;
  for (const s of subs) {
    if (!users.has(s.uid)) users.set(s.uid, await getJson("user:" + s.uid));
    const u = users.get(s.uid);
    if (!u) { await cmd("HDEL", SUBS, s.id); dropped++; continue; }
    if (!plans.has(u.hh)) plans.set(u.hh, await householdPlan(u.hh));
    const msg = message(plans.get(u.hh), false);
    if (!msg) continue;
    try { if (await sendPush(s, msg)) sent++; else dropped++; }
    catch (e) { failed++; console.warn("Push fehlgeschlagen:", e && (e.statusCode || e.message)); }
  }
  return { subs: subs.length, sent, dropped, failed };
}
