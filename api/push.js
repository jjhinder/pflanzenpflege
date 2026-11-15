// Erinnerungen per Push auf dieses Gerät.
// GET  /api/push                                  → { publicKey }
// POST /api/push { action: "subscribe", sub }     → Gerät anmelden
// POST /api/push { action: "unsubscribe", endpoint }
// POST /api/push { action: "test" }               → Probe-Nachricht an die eigenen Geräte
import { send, bodyOf, wrap, requireAuth, tooMany } from "../lib/core.js";
import { vapid, addSub, removeSub, allSubs, sendPush, householdPlan, message } from "../lib/push.js";

const okSub = s => s && typeof s === "object" && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 &&
  s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string" && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;

export default wrap(async function handler(req, res) {
  const a = await requireAuth(req, res);
  if (!a) return;
  if (req.method === "GET") return send(res, 200, { publicKey: (await vapid()).publicKey });
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  const b = bodyOf(req);
  switch (String(b.action || "")) {
    case "subscribe": {
      if (!okSub(b.sub)) return send(res, 400, { code: "bad_request" });
      if (await tooMany("push:" + a.user.id, 30, 3600)) return send(res, 429, { code: "rate_limited" });
      await addSub(a.user, { endpoint: b.sub.endpoint, keys: { p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth } });
      return send(res, 200, { ok: true });
    }
    case "unsubscribe": {
      if (typeof b.endpoint === "string" && b.endpoint.length < 1000) await removeSub(b.endpoint);
      return send(res, 200, { ok: true });
    }
    case "test": {
      if (await tooMany("pushtest:" + a.user.id, 10, 3600)) return send(res, 429, { code: "rate_limited" });
      const mine = (await allSubs()).filter(s => s.uid === a.user.id && (!b.endpoint || s.sub.endpoint === b.endpoint));
      if (!mine.length) return send(res, 404, { code: "not_subscribed" });
      const msg = message(await householdPlan(a.user.hh), true);
      let sent = 0;
      for (const s of mine) { try { if (await sendPush(s, msg)) sent++; } catch (e) { console.warn("Probe-Push fehlgeschlagen:", e && (e.statusCode || e.message)); } }
      return send(res, sent ? 200 : 502, sent ? { sent } : { code: "push_failed" });
    }
    default:
      return send(res, 400, { code: "bad_request" });
  }
});
