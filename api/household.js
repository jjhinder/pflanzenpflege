// Haushalt verwalten: einladen, beitreten, verlassen, umbenennen und den eigenen Anthropic-Schlüssel hinterlegen.
import Anthropic from "@anthropic-ai/sdk";
import { cmd, pipe, getJson, pairs } from "../lib/store.js";
import { usageView } from "../lib/usage.js";
import { send, bodyOf, wrap, rid, requireAuth, tooMany, encrypt, saveHousehold, saveUser, newHousehold, meView } from "../lib/core.js";

const INVITE_DAYS = 7;
const INVITE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const clean = (v, max) => String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
const ok = async (res, a) => send(res, 200, Object.assign({ signedIn: true }, await meView(a)));

/** Verschiebt Pflanzen, Einstellungen und Fotos von einem Haushalt in einen anderen. */
async function moveData(fromId, toId) {
  const [docsRaw, photosRaw, targetKeys] = await pipe(["HGETALL", `hh:${fromId}:docs`], ["HGETALL", `hh:${fromId}:phs`], ["HKEYS", `hh:${toId}:docs`]);
  const docs = pairs(docsRaw), photos = pairs(photosRaw);
  const have = new Set(targetKeys || []);
  const cmds = [];
  for (const [path, v] of Object.entries(docs)) {
    if (path.startsWith("settings/") && have.has(path)) continue; // Einstellungen des Ziel-Haushalts behalten
    cmds.push(["HSET", `hh:${toId}:docs`, path, v]);
  }
  for (const [pid, size] of Object.entries(photos)) {
    const data = await cmd("GET", `hh:${fromId}:ph:${pid}`);
    if (data == null) continue;
    cmds.push(["SET", `hh:${toId}:ph:${pid}`, data], ["HSET", `hh:${toId}:phs`, pid, size], ["DEL", `hh:${fromId}:ph:${pid}`]);
  }
  cmds.push(["INCR", `hh:${toId}:ver`], ["DEL", `hh:${fromId}:docs`, `hh:${fromId}:phs`, `hh:${fromId}:ver`, `hh:${fromId}`]);
  for (let i = 0; i < cmds.length; i += 50) await pipe(...cmds.slice(i, i + 50));
  return Object.keys(docs).filter(p => p.startsWith("plants/")).length;
}

export default wrap(async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  const a = await requireAuth(req, res);
  if (!a) return;
  const { user, hh } = a;
  const b = bodyOf(req);

  switch (String(b.action || "")) {
    case "invite": {
      if (await tooMany("inv:" + hh.id, 20, 3600)) return send(res, 429, { code: "rate_limited" });
      const code = rid(8, INVITE_ABC);
      await cmd("SET", "invite:" + code, hh.id, "EX", INVITE_DAYS * 86400);
      return send(res, 200, { code, days: INVITE_DAYS });
    }
    case "join": {
      const code = String(b.code || "").trim().toUpperCase();
      if (await tooMany("join:" + user.id, 10, 3600)) return send(res, 429, { code: "rate_limited" });
      const targetId = /^[A-Z0-9]{6,12}$/.test(code) ? await cmd("GET", "invite:" + code) : null;
      const target = targetId ? await getJson("hh:" + targetId) : null;
      if (!target) return send(res, 400, { code: "invite_invalid" });
      if (target.id === hh.id) return ok(res, a);
      let moved = 0;
      if (hh.members.length <= 1) {
        // Allein im alten Haushalt: Pflanzen mitnehmen, damit nichts verloren geht.
        if (b.keepPlants !== false) moved = await moveData(hh.id, target.id);
        else await cmd("DEL", `hh:${hh.id}:docs`, `hh:${hh.id}:phs`, `hh:${hh.id}:ver`, `hh:${hh.id}`);
      } else {
        hh.members = hh.members.filter(id => id !== user.id);
        await saveHousehold(hh);
      }
      target.members = [...new Set([...target.members, user.id])];
      await saveHousehold(target);
      user.hh = target.id;
      await saveUser(user);
      return send(res, 200, Object.assign({ signedIn: true, moved }, await meView({ user, hh: target })));
    }
    case "leave": {
      if (hh.members.length <= 1) return send(res, 400, { code: "last_member" });
      hh.members = hh.members.filter(id => id !== user.id);
      await saveHousehold(hh);
      const fresh = await newHousehold(`Haushalt von ${user.name}`, user.id);
      user.hh = fresh.id;
      await saveUser(user);
      return ok(res, { user, hh: fresh });
    }
    case "rename": {
      const name = clean(b.name, 60);
      if (!name) return send(res, 400, { code: "name_missing" });
      hh.name = name;
      await saveHousehold(hh);
      return ok(res, a);
    }
    case "setKey": {
      const key = String(b.key || "").trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) return send(res, 400, { code: "key_invalid" });
      if (await tooMany("key:" + hh.id, 10, 3600)) return send(res, 429, { code: "rate_limited" });
      try {
        await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return send(res, 400, { code: "key_rejected" });
        console.warn("Schlüssel konnte nicht geprüft werden:", e && e.message);
      }
      hh.key = { enc: encrypt(key), hint: key.slice(0, 7) + "…" + key.slice(-4), by: user.id, byName: user.name, at: new Date().toISOString() };
      await saveHousehold(hh);
      return ok(res, a);
    }
    case "usage":
      return send(res, 200, await usageView(hh.id));
    case "removeKey": {
      delete hh.key;
      await saveHousehold(hh);
      return ok(res, a);
    }
    default:
      return send(res, 400, { code: "bad_request" });
  }
});
