/*
 * Laufzeit für die Pflanzenpflege-App.
 * Stellt dieselben Schnittstellen bereit, die die App in claude.ai nutzte (db, assets, sample, user),
 * aber mit Konten und Haushalten: Die Pflanzen liegen zentral auf dem Server, alle Personen eines
 * Haushalts sehen und bearbeiten dieselben Daten. Eine Kopie bleibt im Browser, damit die App
 * auch ohne Verbindung startet.
 */
"use strict";
(function () {
  const POLL_MS = 30000;
  const ME_KEY = "pp-me";
  const LEGACY_DONE = "pp-legacy-done";
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };

  /* ---------- Server ---------- */
  async function api(path, opts) {
    opts = opts || {};
    let r;
    try {
      r = await fetch(path, {
        method: opts.method || (opts.body ? "POST" : "GET"),
        headers: opts.body ? { "content-type": "application/json" } : {},
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials: "same-origin",
        cache: "no-store",
        signal: opts.signal
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled" };
      throw { code: "network" };
    }
    let body = {};
    try { body = await r.json(); } catch { body = {}; }
    if (!r.ok) {
      const code = body.code || (r.status === 401 ? "signed_out" : r.status === 429 ? "rate_limited" : r.status === 413 ? "quota_exceeded" : "unavailable");
      if (code === "signed_out" && !opts.quiet) signedOut();
      throw { code, status: r.status };
    }
    return body;
  }

  /* ---------- kleine IndexedDB-Hilfen ---------- */
  function openDb(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) { reject(new Error("no_idb")); return; }
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => upgrade && upgrade(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function idbDo(d, store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      let out;
      Promise.resolve(fn(t.objectStore(store))).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("abort"));
    });
  }

  /* Kopie der Haushaltsdaten für den Start ohne Verbindung */
  let cacheDb = null;
  const cache = () => cacheDb || (cacheDb = openDb("pflanzenpflege-cache", 1, d => { if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); }));
  async function cacheRead() {
    try { const d = await cache(); return await idbDo(d, "kv", "readonly", s => reqP(s.get("snap"))); } catch { return null; }
  }
  let cacheTimer = null;
  function cacheWrite() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(async () => {
      if (!me) return;
      const snap = { hid: me.household.id, ver, docs: Object.fromEntries(docs) };
      try { const d = await cache(); await idbDo(d, "kv", "readwrite", s => { s.put(snap, "snap"); }); } catch { /* ohne Kopie geht es auch */ }
    }, 400);
  }
  async function cacheClear() {
    try { const d = await cache(); await idbDo(d, "kv", "readwrite", s => { s.clear(); }); } catch { /* ignore */ }
    try { if ("caches" in window) await caches.delete("pflanzenpflege-photos"); } catch { /* ignore */ }
  }

  /* ---------- Konto ---------- */
  let me = null;           // { user, household }
  let signupCode = false;  // verlangt der Server einen Anmeldecode für neue Haushalte?
  function setMe(m) {
    me = m && m.user ? { user: m.user, household: m.household } : null;
    lsSet(ME_KEY, me ? JSON.stringify(me) : null);
  }
  let signedOutShown = false;
  function signedOut() {
    if (signedOutShown) return;
    signedOutShown = true;
    setMe(null);
    showAuth({ expired: true }).then(() => location.reload());
  }

  /* ---------- Daten ---------- */
  const docs = new Map(); // "col/id" -> object
  let ver = -1;
  let fromCache = false;
  let pending = 0;
  const listeners = new Set();
  function notify() { queueMicrotask(() => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } })); }
  function replaceAll(obj) {
    docs.clear();
    Object.entries(obj || {}).forEach(([k, v]) => docs.set(k, v));
  }
  async function pull(force) {
    if (pending) return false;
    const b = await api("/api/data" + (force || ver < 0 ? "" : "?since=" + ver));
    if (pending) return false;
    const changed = !b.same;
    if (changed) replaceAll(b.docs);
    ver = b.ver;
    const wasCache = fromCache;
    fromCache = false;
    if (changed || wasCache) { notify(); cacheWrite(); }
    return changed;
  }
  let pollTimer = null;
  function schedulePoll(ms) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!document.hidden) { try { await pull(); } catch { /* nächster Versuch */ } }
      schedulePoll(POLL_MS);
    }, ms);
  }
  let lastRefresh = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !me) return;
    schedulePoll(50);
    if (Date.now() - lastRefresh > 60000) { lastRefresh = Date.now(); account.refresh().catch(() => {}); }
  });
  window.addEventListener("online", () => { if (me) schedulePoll(50); });

  function applyPatch(base, patch) {
    const out = Object.assign({}, base);
    Object.keys(patch || {}).forEach(k => {
      const v = patch[k];
      if (v && typeof v === "object" && !Array.isArray(v) && v.__delete__ === true) delete out[k];
      else out[k] = clone(v);
    });
    return out;
  }
  /* Schreibt sofort lokal (damit die App flüssig bleibt) und dann auf den Server. Klappt das nicht, wird zurückgesetzt. */
  async function write(ops) {
    const before = new Map();
    ops.forEach(o => {
      if (!before.has(o.path)) before.set(o.path, docs.get(o.path));
      if (o.op === "delete") docs.delete(o.path);
      else if (o.op === "set") docs.set(o.path, clone(o.value));
      else docs.set(o.path, applyPatch(docs.get(o.path), o.patch));
    });
    notify();
    pending++;
    try {
      const r = await api("/api/data", { body: { ops } });
      Object.entries(r.docs || {}).forEach(([k, v]) => { if (v === null) docs.delete(k); else docs.set(k, v); });
      if (r.ver === ver + 1) ver = r.ver; else schedulePoll(300);
      notify();
      cacheWrite();
    } catch (e) {
      before.forEach((v, k) => { if (v === undefined) docs.delete(k); else docs.set(k, v); });
      notify();
      throw { code: e && e.code === "quota_exceeded" ? "quota_exceeded" : e && e.code === "rate_limited" ? "resource_exhausted" : "unavailable" };
    } finally {
      pending--;
    }
  }
  function snapOf(path) {
    const v = docs.get(path);
    return { exists: v !== undefined, id: path.split("/").pop(), data: () => clone(v) };
  }
  function docRef(path) {
    return {
      id: path.split("/").pop(),
      path,
      async get() { return snapOf(path); },
      async set(data) { await write([{ op: "set", path, value: clone(data) }]); },
      async update(patch) {
        if (!docs.has(path)) throw { code: "not_found" };
        await write([{ op: "update", path, patch: clone(patch) }]);
      },
      async delete() { await write([{ op: "delete", path }]); },
      onSnapshot(cb) {
        const fn = () => cb(snapOf(path));
        listeners.add(fn);
        queueMicrotask(fn);
        return () => listeners.delete(fn);
      }
    };
  }
  function collection(name) {
    return {
      doc(id) { return docRef(name + "/" + (id || randId())); },
      onSnapshot(cb) {
        const fn = () => {
          const pre = name + "/";
          const list = [];
          docs.forEach((v, k) => { if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) list.push({ id: k.slice(pre.length), data: () => clone(v) }); });
          cb({ docs: list, metadata: { fromCache } });
        };
        listeners.add(fn);
        queueMicrotask(fn);
        return () => listeners.delete(fn);
      }
    };
  }
  const db = { collection, doc: path => docRef(path) };

  /* ---------- Fotos ---------- */
  const blobToDataUrl = b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); });
  async function compress(blob, max, limit) {
    const okType = /^image\/(jpeg|png|webp|gif)$/.test(blob.type);
    if (okType && blob.size <= limit) return blob;
    try {
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return (await new Promise(r => c.toBlob(r, "image/jpeg", 0.8))) || blob;
    } catch { if (okType) return blob; throw { code: "image_rejected" }; }
  }
  async function toImage(blob, max = 1280, limit = 900000) {
    const data = await blobToDataUrl(await compress(blob, max, limit));
    const m = data.match(/^data:(image\/[a-z]+);base64,(.*)$/);
    if (!m) throw { code: "image_rejected" };
    return { media_type: m[1], data: m[2] };
  }
  const local = new Map(); // frisch hochgeladene Fotos sofort aus dem Speicher zeigen
  const assets = {
    async upload(blob, id) {
      const im = await toImage(blob, 1400, 450000);
      let r;
      try { r = await api("/api/photo", { body: { id: id || undefined, type: im.media_type, data: im.data } }); }
      catch (e) { throw { code: e && e.code === "quota_exceeded" ? "quota_exceeded" : "unavailable" }; }
      try { local.set(r.id, URL.createObjectURL(blob)); } catch { /* ignore */ }
      return { id: r.id };
    },
    async remove(id) { await api("/api/photo", { body: { action: "delete", id } }); local.delete(id); },
    async get(id) {
      const r = await fetch(photoUrl(id), { credentials: "same-origin" });
      if (!r.ok) throw { code: "not_found" };
      return r.blob();
    }
  };
  function photoUrl(id) {
    if (!id || typeof id !== "string") return PIXEL;
    return local.get(id) || "/api/photo?id=" + encodeURIComponent(id);
  }

  /* ---------- Claude über /api/claude (mit dem Schlüssel des Haushalts) ---------- */
  async function call(prompt, opts, json) {
    opts = opts || {};
    const images = [];
    for (const b of (opts.images || []).slice(0, 4)) images.push(await toImage(b));
    try {
      return await api("/api/claude", { body: { prompt: String(prompt), images, tier: opts.modelTier === "quick" ? "quick" : "default", json: !!json, feature: opts.feature || "" }, signal: opts.signal, quiet: true });
    } catch (e) {
      if (e && e.code === "signed_out") throw { code: "session_expired" };
      throw { code: (e && e.code) || "error" };
    }
  }
  async function sample(prompt, opts) { const b = await call(prompt, opts, false); return { text: String(b.text || "") }; }
  sample.json = async (prompt, opts) => {
    const b = await call(prompt, opts, true);
    if (b.json === undefined || b.json === null) throw { code: "invalid_json" };
    return b.json;
  };
  sample.limits = async () => ({ images: { maxCount: 4 } });

  /* ---------- user ---------- */
  const user = {
    async id() { return me ? me.user.id : null; },
    async can() { return true; },
    async profiles(ids) {
      const o = {};
      const known = () => ((me && me.household.members) || []).map(x => x.id);
      if (ids.some(i => !known().includes(i))) { try { await account.refresh(); } catch { /* Namen bleiben leer */ } }
      const mem = (me && me.household.members) || [];
      ids.forEach(i => { const m = mem.find(x => x.id === i); o[i] = { name: m ? m.name : "" }; });
      return o;
    }
  };

  /* ---------- Sicherung, Import und Übernahme alter Daten ---------- */
  async function exportData() {
    const plants = [];
    let settings = null;
    docs.forEach((v, k) => {
      if (k.startsWith("plants/")) plants.push(Object.assign({ id: k.slice(7) }, clone(v)));
      if (k === "settings/app") settings = clone(v);
    });
    const used = new Set();
    plants.forEach(p => { if (p.photoId) used.add(p.photoId); (p.log || []).forEach(e => { if (e && e.photoId) used.add(e.photoId); }); });
    const photos = {};
    for (const id of used) { const b = await assets.get(id).catch(() => null); if (b) photos[id] = await blobToDataUrl(b); }
    return { app: "pflanzenpflege", version: 1, exportedAt: new Date().toISOString(), plants, settings, photos };
  }
  /* Liest Pflanzen ein. Pflanzen, die es im Haushalt schon gibt, bleiben unverändert (damit nichts Neueres überschrieben wird). */
  async function importPlants(plants, settings, getPhoto, onStep) {
    const uid = me ? me.user.id : "me";
    const valid = id => /^[A-Za-z0-9_-]{1,64}$/.test(String(id || ""));
    const sent = new Set();
    let added = 0, skipped = 0, batch = [], size = 0;
    const flush = async () => { if (batch.length) { await write(batch); batch = []; size = 0; } };
    for (const raw of plants) {
      if (!raw || typeof raw !== "object") continue;
      const id = valid(raw.id) ? String(raw.id) : randId();
      if (docs.has("plants/" + id)) { skipped++; continue; }
      const p = clone(raw);
      delete p.id;
      const ok = async pid => {
        if (!pid || !valid(pid)) return false;
        if (sent.has(pid)) return true;
        const b = await getPhoto(pid).catch(() => null);
        if (!b) return false;
        try { await assets.upload(b, pid); sent.add(pid); return true; } catch { return false; }
      };
      if (p.photoId && !(await ok(p.photoId))) delete p.photoId;
      if (Array.isArray(p.log)) {
        const out = [];
        for (const e of p.log) {
          if (!e || typeof e !== "object") continue;
          const x = Object.assign({}, e);
          if (!x.by || x.by === "me") x.by = uid;
          if (x.photoId && !(await ok(x.photoId))) delete x.photoId;
          out.push(x);
        }
        p.log = out;
      }
      const s = JSON.stringify(p).length;
      if (size + s > 2500000 || batch.length >= 100) await flush();
      batch.push({ op: "set", path: "plants/" + id, value: p });
      size += s;
      added++;
      if (onStep) onStep(added);
    }
    if (settings && typeof settings === "object" && !docs.has("settings/app")) batch.push({ op: "set", path: "settings/app", value: clone(settings) });
    await flush();
    return { added, skipped };
  }
  async function importData(obj) {
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.plants)) throw { code: "bad_file" };
    const photos = obj.photos && typeof obj.photos === "object" ? obj.photos : {};
    const getPhoto = async id => {
      const url = photos[id];
      if (typeof url !== "string" || !url.startsWith("data:image/")) return null;
      return (await fetch(url)).blob();
    };
    const r = await importPlants(obj.plants, obj.settings, getPhoto);
    return r.added;
  }

  /* Daten der früheren Version (nur in diesem Browser gespeichert) */
  async function legacyOpen() {
    if (indexedDB.databases) {
      try { const list = await indexedDB.databases(); if (!list.some(d => d.name === "pflanzenpflege")) return null; } catch { /* weiter versuchen */ }
    }
    try { return await openDb("pflanzenpflege", 1, d => { if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs"); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); }); }
    catch { return null; }
  }
  const legacy = { count: 0, done: false };
  async function legacyRead() {
    const d = await legacyOpen();
    if (!d) return null;
    try {
      return await idbDo(d, "docs", "readonly", async s => {
        const keys = await reqP(s.getAllKeys());
        const vals = await reqP(s.getAll());
        const plants = [];
        let settings = null;
        keys.forEach((k, i) => {
          k = String(k);
          if (k.startsWith("plants/")) plants.push(Object.assign({}, vals[i], { id: k.slice(7) }));
          if (k === "settings/app") settings = vals[i];
        });
        return { d, plants, settings };
      });
    } catch { return null; }
  }
  async function legacyCheck() {
    legacy.done = lsGet(LEGACY_DONE) === "1";
    const l = await legacyRead();
    legacy.count = l ? l.plants.length : 0;
  }
  async function migrateLegacy(onStep) {
    const l = await legacyRead();
    if (!l) return { added: 0, skipped: 0 };
    const getPhoto = id => idbDo(l.d, "blobs", "readonly", s => reqP(s.get(id))).then(b => (b instanceof Blob ? b : null));
    const r = await importPlants(l.plants, l.settings, getPhoto, onStep);
    lsSet(LEGACY_DONE, "1");
    legacy.done = true;
    return r;
  }
  function legacyDismiss() { lsSet(LEGACY_DONE, "1"); legacy.done = true; }

  /* ---------- Haushalt und Konto ---------- */
  const account = {
    async refresh() { const b = await api("/api/auth"); if (b.signedIn) setMe(b); return me; },
    async invite() { return api("/api/household", { body: { action: "invite" } }); },
    async join(code) { const b = await api("/api/household", { body: { action: "join", code } }); setMe(b); await cacheClear(); return b; },
    async leave() { const b = await api("/api/household", { body: { action: "leave" } }); setMe(b); await cacheClear(); return b; },
    async renameHousehold(name) { setMe(await api("/api/household", { body: { action: "rename", name } })); },
    async renameMe(name) { setMe(await api("/api/auth", { body: { action: "rename", name } })); },
    async setKey(key) { setMe(await api("/api/household", { body: { action: "setKey", key } })); },
    async removeKey() { setMe(await api("/api/household", { body: { action: "removeKey" } })); },
    async usage() { return api("/api/household", { body: { action: "usage" } }); },
    async password(old, password) { await api("/api/auth", { body: { action: "password", old, password } }); },
    async logout() {
      try { await api("/api/auth", { body: { action: "logout" }, quiet: true }); } catch { /* trotzdem lokal abmelden */ }
      setMe(null);
      await cacheClear();
      location.hash = "";
      location.reload();
    }
  };

  /* ---------- Erinnerungen per Push ---------- */
  const b64ToBytes = s => {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };
  const push = {
    supported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; },
    standalone() { return !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone); },
    ios() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); },
    permission() { return "Notification" in window ? Notification.permission : "unsupported"; },
    async current() {
      if (!push.supported()) return null;
      const reg = await navigator.serviceWorker.ready;
      return reg.pushManager.getSubscription();
    },
    /* Muss direkt aus einem Tipp aufgerufen werden (sonst fragt Safari nicht nach). */
    async enable() {
      if (!push.supported()) throw { code: "push_unsupported" };
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw { code: perm === "denied" ? "push_denied" : "push_dismissed" };
      const { publicKey } = await api("/api/push");
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Mit einem anderen Server-Schlüssel angemeldet? Dann neu anmelden.
        const k = sub.options && sub.options.applicationServerKey;
        const same = k && btoa(String.fromCharCode(...new Uint8Array(k))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === publicKey;
        if (!same) { await sub.unsubscribe().catch(() => {}); sub = null; }
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api("/api/push", { body: { action: "subscribe", sub: sub.toJSON() } });
      return sub;
    },
    async disable() {
      const sub = await push.current();
      if (!sub) return;
      try { await api("/api/push", { body: { action: "unsubscribe", endpoint: sub.endpoint } }); } catch { /* lokal trotzdem abmelden */ }
      await sub.unsubscribe().catch(() => {});
    },
    async test() {
      const sub = await push.current();
      if (sub) await api("/api/push", { body: { action: "subscribe", sub: sub.toJSON() } }); // falls der Server das Gerät vergessen hat
      return api("/api/push", { body: { action: "test", endpoint: sub ? sub.endpoint : undefined } });
    }
  };

  /* ---------- Anmeldung ---------- */
  const ERR = {
    network: "Keine Verbindung. Prüfe das Internet und versuch es nochmals.",
    wrong_login: "Benutzername oder Passwort stimmen nicht.",
    login_taken: "Diesen Benutzernamen gibt es schon. Wähle einen anderen oder melde dich an.",
    login_invalid: "Der Benutzername braucht 3 bis 60 Zeichen: Buchstaben, Zahlen und . _ - @ +, ohne Leerzeichen.",
    password_short: "Das Passwort braucht mindestens 8 Zeichen.",
    name_missing: "Wie heisst du? Der Name erscheint im Verlauf.",
    invite_invalid: "Diesen Einladungscode gibt es nicht oder er ist abgelaufen. Lass dir einen neuen geben.",
    signup_code: "Der Anmeldecode stimmt nicht. Du bekommst ihn von der Person, die die App betreibt.",
    rate_limited: "Zu viele Versuche. Warte ein paar Minuten.",
    store_missing: "Auf dem Server ist noch kein Speicher eingerichtet. Die Anleitung steht im README des Repos.",
    unavailable: "Der Server antwortet gerade nicht. Versuch es gleich nochmals."
  };
  const errText = e => ERR[e && e.code] || ERR.unavailable;
  function inviteFromHash() {
    const m = location.hash.match(/einladung=([A-Za-z0-9]{6,12})/);
    return m ? m[1].toUpperCase() : "";
  }
  function clearInviteHash() {
    if (/einladung=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search + "#heute");
  }
  const LEAF = `<svg viewBox="0 0 512 512" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><path d="M166 404h180l20-118H146z"/><path d="M256 286v-62"/><path d="M256 224c0-66 44-110 122-110 0 66-44 110-122 110z"/><path d="M256 224c0-52-35-88-98-88 0 52 35 88 98 88z"/></g></svg>`;
  function overlay() {
    let el = document.getElementById("auth");
    if (!el) {
      el = document.createElement("div");
      el.id = "auth";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-labelledby", "auth-title");
      document.body.appendChild(el);
    }
    el.hidden = false;
    document.body.classList.add("locked");
    return el;
  }
  function closeOverlay() {
    const el = document.getElementById("auth");
    if (el) { el.hidden = true; el.innerHTML = ""; }
    if (!document.getElementById("sheet") || document.getElementById("sheet").hidden) document.body.classList.remove("locked");
  }
  /* Zeigt Anmelden / Registrieren und löst auf, sobald jemand angemeldet ist. */
  function showAuth(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const el = overlay();
      const st = { mode: inviteFromHash() ? "register" : "login", invite: inviteFromHash(), err: opts.storeMissing ? ERR.store_missing : "", busy: false, showInvite: !!inviteFromHash() };
      const draw = () => {
        const reg = st.mode === "register";
        el.innerHTML = `<div class="auth-wrap">
          <div class="auth-mark">${LEAF}</div>
          <p class="kicker">Pflanzenpflege</p>
          <h1 class="headline" id="auth-title">${opts.expired ? "Bitte neu anmelden." : st.invite ? "Willkommen im <em>Haushalt</em>." : reg ? "Neues <em>Konto</em>." : "Willkommen <em>zurück</em>."}</h1>
          <p class="lede">${st.invite ? "Du wurdest eingeladen. Erstelle ein Konto, dann siehst du dieselben Pflanzen wie alle im Haushalt." : reg ? "Ein Konto gehört zu einem Haushalt. Alle im Haushalt pflegen dieselben Pflanzen, jede Person von ihrem eigenen Gerät aus." : "Melde dich an, um deine Pflanzen auf diesem Gerät zu sehen."}</p>
          <div class="pills" role="group" aria-label="Anmelden oder registrieren">
            <button type="button" class="pill" data-auth-mode="login" aria-pressed="${!reg}">Anmelden</button>
            <button type="button" class="pill" data-auth-mode="register" aria-pressed="${reg}">Neues Konto</button>
          </div>
          <form class="panel auth-form" novalidate>
            ${reg ? `<div class="field"><label for="a-name">Dein Name</label><input id="a-name" autocomplete="given-name" maxlength="40" required></div>` : ""}
            <div class="field"><label for="a-login">Benutzername oder E-Mail</label><input id="a-login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="60" required></div>
            <div class="field"><label for="a-pw">Passwort</label><input id="a-pw" type="password" autocomplete="${reg ? "new-password" : "current-password"}" minlength="8" required>${reg ? `<span class="muted small">Mindestens 8 Zeichen.</span>` : ""}</div>
            ${reg && st.showInvite ? `<div class="field"><label for="a-invite">Einladungscode</label><input id="a-invite" autocapitalize="characters" spellcheck="false" maxlength="12" value="${esc(st.invite)}"><span class="muted small">Damit trittst du einem bestehenden Haushalt bei.</span></div>` : ""}
            ${reg && !st.showInvite ? `<div class="field"><label for="a-hh">Name des Haushalts <span class="muted">(freiwillig)</span></label><input id="a-hh" maxlength="60" placeholder="z. B. Wohnung Seefeld"></div>` : ""}
            ${reg && !st.showInvite && signupCode ? `<div class="field"><label for="a-code">Anmeldecode</label><input id="a-code" autocapitalize="none" spellcheck="false" maxlength="80"><span class="muted small">Neue Haushalte brauchen einen Code von der Person, die die App betreibt.</span></div>` : ""}
            <p class="err" role="alert">${esc(st.err)}</p>
            <button class="btn primary block" type="submit"${st.busy ? " disabled" : ""}>${st.busy ? "Einen Moment …" : reg ? (st.showInvite ? "Konto erstellen und beitreten" : "Konto erstellen") : "Anmelden"}</button>
            ${reg ? `<button type="button" class="btn ghost sm" data-auth-invite>${st.showInvite ? "Ich will einen neuen Haushalt gründen" : "Ich habe einen Einladungscode"}</button>` : ""}
          </form>
          ${reg ? `<p class="muted small">Für Skizzen, Pflanzendoktor und Foto-Erkennung hinterlegt jeder Haushalt später seinen eigenen Anthropic-Schlüssel und bezahlt die Anfragen selbst.</p>` : ""}
        </div>`;
        const first = el.querySelector("input");
        if (first) first.focus({ preventScroll: true });
      };
      el.onclick = e => {
        const m = e.target.closest("[data-auth-mode]");
        if (m) { st.mode = m.dataset.authMode; st.err = ""; draw(); return; }
        if (e.target.closest("[data-auth-invite]")) { st.showInvite = !st.showInvite; st.err = ""; draw(); }
      };
      el.onsubmit = async e => {
        e.preventDefault();
        if (st.busy) return;
        const v = id => { const x = el.querySelector("#" + id); return x ? x.value.trim() : ""; };
        const pw = (el.querySelector("#a-pw") || {}).value || "";
        const body = st.mode === "register"
          ? { action: "register", name: v("a-name"), login: v("a-login"), password: pw, invite: st.showInvite ? v("a-invite") : "", household: v("a-hh"), signupCode: v("a-code") }
          : { action: "login", login: v("a-login"), password: pw };
        if (st.mode === "register" && !body.name) { st.err = ERR.name_missing; draw(); return; }
        if (st.mode === "register" && pw.length < 8) { st.err = ERR.password_short; draw(); return; }
        if (st.mode === "register" && st.showInvite && !body.invite) { st.err = "Gib den Einladungscode ein."; draw(); return; }
        st.busy = true; st.err = ""; draw();
        // Eingaben nach dem Neuzeichnen wiederherstellen
        try {
          const b = await api("/api/auth", { body, quiet: true });
          setMe(b);
          signedOutShown = false;
          clearInviteHash();
          closeOverlay();
          resolve(me);
        } catch (ex) {
          st.busy = false; st.err = errText(ex); draw();
          const set = (id, val) => { const x = el.querySelector("#" + id); if (x && val) x.value = val; };
          set("a-name", body.name); set("a-login", body.login); set("a-hh", body.household); set("a-code", body.signupCode); set("a-invite", body.invite);
          const f = el.querySelector("#a-pw"); if (f) f.focus();
        }
      };
      draw();
    });
  }

  /* Einladungslink geöffnet, obwohl schon angemeldet: beitreten? */
  function showJoinPrompt(code) {
    return new Promise(resolve => {
      const el = overlay();
      const solo = me.household.members.length <= 1;
      el.innerHTML = `<div class="auth-wrap">
        <div class="auth-mark">${LEAF}</div>
        <p class="kicker">Einladung</p>
        <h1 class="headline" id="auth-title">Einem <em>Haushalt</em> beitreten?</h1>
        <p class="lede">Du bist als ${esc(me.user.name)} im Haushalt «${esc(me.household.name)}» angemeldet. Mit dem Code ${esc(code)} wechselst du in den Haushalt, der dich eingeladen hat.</p>
        <section class="panel"><p>${solo ? "Deine bisherigen Pflanzen nimmst du mit, sie erscheinen danach im neuen Haushalt." : "Deine bisherigen Pflanzen bleiben bei den anderen im alten Haushalt."}</p>
        <p class="err" role="alert"></p>
        <div class="btn-row"><button class="btn primary" data-join-yes>Beitreten</button><button class="btn" data-join-no>Nicht jetzt</button></div></section>
      </div>`;
      el.onsubmit = null;
      el.onclick = async e => {
        if (e.target.closest("[data-join-no]")) { clearInviteHash(); closeOverlay(); resolve(false); return; }
        const y = e.target.closest("[data-join-yes]");
        if (!y) return;
        y.disabled = true; y.textContent = "Einen Moment …";
        try { await account.join(code); clearInviteHash(); closeOverlay(); resolve(true); }
        catch (ex) { y.disabled = false; y.textContent = "Beitreten"; el.querySelector(".err").textContent = errText(ex); }
      };
    });
  }

  /* Alte Daten aus diesem Browser übernehmen? (einmalig nach der Umstellung) */
  function showLegacyPrompt() {
    return new Promise(resolve => {
      const el = overlay();
      el.innerHTML = `<div class="auth-wrap">
        <div class="auth-mark">${LEAF}</div>
        <p class="kicker">Umzug</p>
        <h1 class="headline" id="auth-title">Pflanzen <em>mitnehmen</em>?</h1>
        <p class="lede">In diesem Browser sind noch ${legacy.count === 1 ? "1 Pflanze" : legacy.count + " Pflanzen"} aus der früheren Version gespeichert, mit Fotos und Verlauf. Sollen sie in den Haushalt «${esc(me.household.name)}» übernommen werden?</p>
        <section class="panel"><p class="muted small">Pflanzen, die es im Haushalt schon gibt, bleiben unverändert. Du kannst das auch später im Profil oben rechts machen.</p>
        <p class="status" role="status"></p><p class="err" role="alert"></p>
        <div class="btn-row"><button class="btn primary" data-leg-yes>Übernehmen</button><button class="btn" data-leg-later>Später</button><button class="btn ghost" data-leg-no>Nein, nie</button></div></section>
      </div>`;
      el.onsubmit = null;
      el.onclick = async e => {
        if (e.target.closest("[data-leg-later]")) { closeOverlay(); resolve(false); return; }
        if (e.target.closest("[data-leg-no]")) { legacyDismiss(); closeOverlay(); resolve(false); return; }
        const y = e.target.closest("[data-leg-yes]");
        if (!y) return;
        el.querySelectorAll("button").forEach(b => { b.disabled = true; });
        const s = el.querySelector(".status");
        try {
          const r = await migrateLegacy(n => { s.textContent = `${n} von ${legacy.count} übernommen …`; });
          s.textContent = "";
          closeOverlay();
          resolve(r);
        } catch (ex) {
          el.querySelectorAll("button").forEach(b => { b.disabled = false; });
          el.querySelector(".err").textContent = ex && ex.code === "quota_exceeded" ? "Der Speicher ist voll." : errText(ex);
        }
      };
    });
  }

  /* ---------- Start ---------- */
  let ready = null;
  function boot() {
    if (ready) return ready;
    ready = (async () => {
      let online = true;
      try {
        const b = await api("/api/auth", { quiet: true });
        signupCode = !!b.signupCode;
        if (b.signedIn) setMe(b); else setMe(null);
      } catch (e) {
        if (e && e.code === "store_missing") { await showAuth({ storeMissing: true }); }
        else {
          online = false;
          try { me = JSON.parse(lsGet(ME_KEY) || "null"); } catch { me = null; }
        }
      }
      if (!me) await showAuth();
      const code = inviteFromHash();
      if (code && online) await showJoinPrompt(code);
      clearInviteHash();

      const snap = await cacheRead();
      if (snap && snap.hid === me.household.id && snap.docs) { replaceAll(snap.docs); fromCache = true; }
      try { await pull(true); }
      catch (e) { if (!snap || snap.hid !== me.household.id) fromCache = true; }
      schedulePoll(POLL_MS);

      if (online) {
        await legacyCheck().catch(() => {});
        if (legacy.count && !legacy.done) await showLegacyPrompt();
      }
      return true;
    })();
    return ready;
  }
  window.claude = {
    async use(name) {
      await boot();
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "user") return user;
      if (name === "sample") return me && me.household.ai ? sample : null;
      return null;
    }
  };
  window.PP = {
    photoUrl,
    get me() { return me; },
    legacy,
    migrateLegacy,
    account,
    push,
    deletePhoto: id => assets.remove(id),
    errText,
    exportData,
    importData
  };
})();
