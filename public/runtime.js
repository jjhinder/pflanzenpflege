/*
 * Lokale Laufzeit für die Pflanzenpflege-App.
 * Stellt dieselben Schnittstellen bereit, die die App in claude.ai nutzte
 * (db, assets, sample, user), aber mit Speicherung im Browser (IndexedDB)
 * und KI über die eigene Serverfunktion /api/claude.
 */
"use strict";
(function () {
  const DB_NAME = "pflanzenpflege";
  const DB_VERSION = 1;
  const KEY_STORE = "pp-ai-password";
  const ME = "me";

  /* ---------- IndexedDB ---------- */
  let idbPromise = null;
  function idb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) { reject(new Error("no_idb")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs");
        if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return idbPromise;
  }
  async function tx(store, mode, fn) {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("abort"));
    });
  }
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  /* ---------- documents ---------- */
  const docs = new Map(); // "col/id" -> object
  const listeners = new Set();
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("pflanzenpflege") : null;
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

  async function loadAll() {
    await tx("docs", "readonly", async s => {
      const keys = await reqP(s.getAllKeys());
      const vals = await reqP(s.getAll());
      docs.clear();
      keys.forEach((k, i) => docs.set(String(k), vals[i]));
    });
  }
  function notify(broadcast = true) {
    queueMicrotask(() => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }));
    if (broadcast && bc) bc.postMessage("changed");
  }
  if (bc) bc.onmessage = () => loadAll().then(() => notify(false)).catch(() => {});

  async function put(path, value) {
    try {
      await tx("docs", "readwrite", s => { if (value === undefined) s.delete(path); else s.put(value, path); });
    } catch (e) {
      throw { code: e && e.name === "QuotaExceededError" ? "quota_exceeded" : "unavailable" };
    }
    if (value === undefined) docs.delete(path); else docs.set(path, value);
    notify();
  }
  function applyPatch(base, patch) {
    const out = Object.assign({}, base);
    Object.keys(patch || {}).forEach(k => {
      const v = patch[k];
      if (v && typeof v === "object" && !Array.isArray(v) && v.__delete__ === true) delete out[k];
      else out[k] = clone(v);
    });
    return out;
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
      async set(data) { await put(path, clone(data)); },
      async update(patch) {
        const cur = docs.get(path);
        if (cur === undefined) throw { code: "not_found" };
        await put(path, applyPatch(cur, patch));
      },
      async delete() { await put(path, undefined); },
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
          cb({ docs: list, metadata: { fromCache: false } });
        };
        listeners.add(fn);
        queueMicrotask(fn);
        return () => listeners.delete(fn);
      }
    };
  }
  const db = { collection, doc: path => docRef(path) };

  /* ---------- photos ---------- */
  const urls = new Map();
  async function loadBlobUrls() {
    await tx("blobs", "readonly", async s => {
      const keys = await reqP(s.getAllKeys());
      const vals = await reqP(s.getAll());
      keys.forEach((k, i) => { if (vals[i] instanceof Blob && !urls.has(k)) urls.set(String(k), URL.createObjectURL(vals[i])); });
    });
  }
  const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");
  const assets = {
    async upload(blob, id) {
      id = id || hex(16);
      try { await tx("blobs", "readwrite", s => { s.put(blob, id); }); }
      catch (e) { throw { code: e && e.name === "QuotaExceededError" ? "quota_exceeded" : "unavailable" }; }
      urls.set(id, URL.createObjectURL(blob));
      return { id };
    },
    async get(id) { return tx("blobs", "readonly", async s => reqP(s.get(id))); },
    async ids() { return tx("blobs", "readonly", async s => (await reqP(s.getAllKeys())).map(String)); }
  };
  function photoUrl(id) {
    return urls.get(id) || "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  }

  /* ---------- Claude über /api/claude ---------- */
  const ai = { configured: false, authed: false, checked: false, error: "" };
  const getPw = () => { try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
  const setPw = v => { try { if (v) localStorage.setItem(KEY_STORE, v); else localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } };

  async function toImage(blob) {
    let b = blob;
    const okType = /^image\/(jpeg|png|webp|gif)$/.test(b.type);
    if (!okType || b.size > 900000) {
      try {
        const bmp = await createImageBitmap(b);
        const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * k));
        c.height = Math.max(1, Math.round(bmp.height * k));
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82)) || b;
      } catch { throw { code: "image_rejected" }; }
    }
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); });
    const m = data.match(/^data:(image\/[a-z]+);base64,(.*)$/);
    if (!m) throw { code: "image_rejected" };
    return { media_type: m[1], data: m[2] };
  }
  async function call(prompt, opts, json) {
    opts = opts || {};
    const images = [];
    for (const b of (opts.images || []).slice(0, 4)) images.push(await toImage(b));
    let r;
    try {
      r = await fetch("/api/claude", {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-password": getPw() },
        body: JSON.stringify({ prompt: String(prompt), images, tier: opts.modelTier === "quick" ? "quick" : "default", json: !!json }),
        signal: opts.signal
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled" };
      throw { code: "network" };
    }
    let body = {};
    try { body = await r.json(); } catch { body = {}; }
    if (!r.ok) throw { code: body.code || (r.status === 401 ? "not_granted" : r.status === 429 ? "rate_limited" : r.status === 413 ? "image_rejected" : "error") };
    return body;
  }
  async function sample(prompt, opts) { const b = await call(prompt, opts, false); return { text: String(b.text || "") }; }
  sample.json = async (prompt, opts) => {
    const b = await call(prompt, opts, true);
    if (b.json === undefined || b.json === null) throw { code: "invalid_json" };
    return b.json;
  };
  sample.limits = async () => ({ images: { maxCount: 4 } });

  async function checkAi() {
    ai.checked = true;
    try {
      const r = await fetch("/api/claude", { method: "GET" });
      const b = await r.json();
      ai.configured = !!(b && b.configured);
    } catch { ai.configured = false; }
    if (!ai.configured || !getPw()) { ai.authed = false; return; }
    try {
      const r = await fetch("/api/claude", { method: "POST", headers: { "content-type": "application/json", "x-app-password": getPw() }, body: JSON.stringify({ ping: true }) });
      ai.authed = r.ok;
      ai.error = r.ok ? "" : r.status === 401 ? "Das Passwort stimmt nicht." : "Der KI-Zugang antwortet gerade nicht.";
    } catch { ai.authed = false; ai.error = "Keine Verbindung zum KI-Zugang."; }
  }

  /* ---------- user ---------- */
  const user = {
    async id() { return ME; },
    async can() { return true; },
    async profiles(ids) { const o = {}; ids.forEach(i => { o[i] = { name: i === ME ? "Du" : "" }; }); return o; }
  };

  /* ---------- export / import ---------- */
  const blobToDataUrl = b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); });
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
  async function importData(obj) {
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.plants)) throw { code: "bad_file" };
    let n = 0;
    for (const [id, url] of Object.entries(obj.photos || {})) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof url !== "string" || !url.startsWith("data:image/")) continue;
      const blob = await (await fetch(url)).blob();
      await assets.upload(blob, id);
    }
    const have = new Set(Object.keys(obj.photos || {}));
    for (const raw of obj.plants) {
      if (!raw || typeof raw !== "object") continue;
      const id = /^[A-Za-z0-9_-]{1,64}$/.test(String(raw.id || "")) ? String(raw.id) : randId();
      const p = clone(raw);
      delete p.id;
      if (p.photoId && !have.has(p.photoId) && !urls.has(p.photoId)) delete p.photoId;
      if (Array.isArray(p.log)) p.log = p.log.filter(e => e && typeof e === "object").map(e => {
        const x = Object.assign({}, e, { by: ME });
        if (x.photoId && !have.has(x.photoId) && !urls.has(x.photoId)) delete x.photoId;
        return x;
      });
      await put("plants/" + id, p);
      n++;
    }
    if (obj.settings && typeof obj.settings === "object") await put("settings/app", clone(obj.settings));
    return n;
  }

  /* ---------- window.claude.use ---------- */
  let ready = null;
  function boot() {
    if (ready) return ready;
    ready = (async () => {
      let dbOk = true;
      try {
        await loadAll();
        await loadBlobUrls();
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      } catch { dbOk = false; }
      await checkAi();
      return dbOk;
    })();
    return ready;
  }
  window.claude = {
    async use(name) {
      const dbOk = await boot();
      if (name === "db") return dbOk ? db : null;
      if (name === "assets") return dbOk ? assets : null;
      if (name === "user") return user;
      if (name === "sample") return ai.configured && ai.authed ? sample : null;
      return null;
    }
  };
  window.PP = { photoUrl, ai, getPw, setPw, exportData, importData, checkAi };
})();
