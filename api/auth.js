// Konten: registrieren, anmelden, abmelden, Passwort ändern.
// Jede Person hat ein eigenes Konto und gehört zu genau einem Haushalt. Pflanzen gehören dem Haushalt.
import { cmd, getJson, storeConfigured } from "../lib/store.js";
import {
  send, bodyOf, wrap, rid, clientIp, hashPassword, checkPassword, createSession, dropSession, sessionCookie, clearCookie,
  auth, requireAuth, tooMany, newHousehold, saveUser, saveHousehold, meView
} from "../lib/core.js";

const LOGIN_RE = /^[a-z0-9._@+-]{3,60}$/;
const normLogin = v => String(v || "").trim().toLowerCase();
const clean = (v, max) => String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
const storeMissing = () => !storeConfigured() && !!process.env.VERCEL;

export default wrap(async function handler(req, res) {
  if (storeMissing()) return send(res, 503, { code: "store_missing" });

  if (req.method === "GET") {
    const a = await auth(req, { touch: true });
    if (!a) return send(res, 200, { signedIn: false, signupCode: !!process.env.SIGNUP_CODE });
    return send(res, 200, Object.assign({ signedIn: true }, await meView(a)));
  }
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  if (!String(req.headers["content-type"] || "").includes("application/json")) return send(res, 415, { code: "bad_request" });

  const b = bodyOf(req);
  const action = String(b.action || "");

  if (action === "register") {
    const name = clean(b.name, 40);
    const login = normLogin(b.login);
    const password = String(b.password || "");
    const invite = String(b.invite || "").trim().toUpperCase();
    if (!name) return send(res, 400, { code: "name_missing" });
    if (!LOGIN_RE.test(login)) return send(res, 400, { code: "login_invalid" });
    if (password.length < 8 || password.length > 200) return send(res, 400, { code: "password_short" });
    if (await tooMany("reg:" + clientIp(req), 10, 3600)) return send(res, 429, { code: "rate_limited" });

    let hhId = null;
    if (invite) {
      hhId = await cmd("GET", "invite:" + invite);
      if (!hhId) return send(res, 400, { code: "invite_invalid" });
    } else if (process.env.SIGNUP_CODE && String(b.signupCode || "").trim() !== process.env.SIGNUP_CODE) {
      return send(res, 403, { code: "signup_code" });
    }

    const uid = rid(12);
    if ((await cmd("SET", "login:" + login, uid, "NX")) !== "OK") return send(res, 409, { code: "login_taken" });
    let hh;
    if (hhId) {
      hh = await getJson("hh:" + hhId);
      if (!hh) { await cmd("DEL", "login:" + login); return send(res, 400, { code: "invite_invalid" }); }
      hh.members = [...new Set([...hh.members, uid])];
      await saveHousehold(hh);
    } else {
      hh = await newHousehold(clean(b.household, 60) || `Haushalt von ${name}`, uid);
    }
    const user = { id: uid, login, name, hh: hh.id, pw: await hashPassword(password), createdAt: new Date().toISOString() };
    await saveUser(user);
    const token = await createSession(uid);
    return send(res, 200, Object.assign({ signedIn: true }, await meView({ user, hh })), { "set-cookie": sessionCookie(req, token) });
  }

  if (action === "login") {
    const login = normLogin(b.login);
    const password = String(b.password || "");
    if (await tooMany("login:" + login, 10, 900) || await tooMany("loginip:" + clientIp(req), 40, 900)) return send(res, 429, { code: "rate_limited" });
    const uid = LOGIN_RE.test(login) ? await cmd("GET", "login:" + login) : null;
    const user = uid ? await getJson("user:" + uid) : null;
    const ok = user ? await checkPassword(password, user.pw) : await checkPassword(password, "s1$AAAA$AAAA").then(() => false);
    if (!ok) return send(res, 401, { code: "wrong_login" });
    const hh = await getJson("hh:" + user.hh);
    if (!hh) return send(res, 503, { code: "unavailable" });
    const token = await createSession(user.id);
    return send(res, 200, Object.assign({ signedIn: true }, await meView({ user, hh })), { "set-cookie": sessionCookie(req, token) });
  }

  if (action === "logout") {
    await dropSession(req);
    return send(res, 200, { signedIn: false }, { "set-cookie": clearCookie(req) });
  }

  if (action === "password") {
    const a = await requireAuth(req, res);
    if (!a) return;
    if (await tooMany("pw:" + a.user.id, 10, 900)) return send(res, 429, { code: "rate_limited" });
    if (!(await checkPassword(String(b.old || ""), a.user.pw))) return send(res, 401, { code: "wrong_login" });
    const pw = String(b.password || "");
    if (pw.length < 8 || pw.length > 200) return send(res, 400, { code: "password_short" });
    a.user.pw = await hashPassword(pw);
    await saveUser(a.user);
    return send(res, 200, { ok: true });
  }

  if (action === "rename") {
    const a = await requireAuth(req, res);
    if (!a) return;
    const name = clean(b.name, 40);
    if (!name) return send(res, 400, { code: "name_missing" });
    a.user.name = name;
    await saveUser(a.user);
    return send(res, 200, Object.assign({ signedIn: true }, await meView(a)));
  }

  return send(res, 400, { code: "bad_request" });
});
