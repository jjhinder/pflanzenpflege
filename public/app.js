"use strict";
const LOGMAX = 150;
const HEALTH = ["", "Kritisch", "Schwach", "Okay", "Gut", "Prächtig"];
const LIGHT = ["Schatten", "Halbschatten", "Hell, indirekt", "Sonnig"];
const AMOUNT = ["Wenig", "Mittel", "Viel", "Tauchen"];
const EV = { water: "Gegossen", skip: "Verschoben", fert: "Gedüngt", check: "Check-in", repot: "Umgetopft", doctor: "Diagnose", scan: "Per Foto erfasst" };
const PHOTO_TYPES = ["check", "doctor", "scan"];
const TREND = { besser: "besser als zuletzt", gleich: "unverändert", schlechter: "schlechter als zuletzt" };
const CAM_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/></svg>`;
const VIEWS = ["heute", "pflanzen", "neu", "plan", "verlauf"];
const CAL_DAYS = 120;
const IC = {
  water: `<svg viewBox="0 0 24 24"><path d="M12 3.2c3.6 4.3 6.2 7.8 6.2 10.8a6.2 6.2 0 0 1-12.4 0c0-3 2.6-6.5 6.2-10.8z"/></svg>`,
  fert: `<svg viewBox="0 0 24 24"><path d="M6 21h12"/><path d="M7.5 21l1-9h7l1 9"/><path d="M9.5 12V8.5a2.5 2.5 0 0 1 5 0V12"/><path d="M12 3v2"/></svg>`,
  photo: `<svg viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/></svg>`,
  crit: `<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`
};
const FEEY = {
  schaedlinge: { name: "Mittel gegen Zimmerpflanzen-Schädlinge", path: "products/mittel-gegen-schadlinge", use: "Blattläuse, Spinnmilben, Thripse und andere saugende Schädlinge" },
  raubmilben: { name: "Raubmilben (Nützlinge)", path: "products/raubmilben", use: "Spinnmilben und Thripse biologisch bekämpfen" },
  nematoden: { name: "Nützlinge gegen Trauermücken", path: "products/nematoden-gegen-trauermucken", use: "Trauermücken-Larven in der Erde" },
  gelbtafeln: { name: "Gelbtafeln gegen Trauermücken", path: "products/gelbtafeln", use: "fliegende Trauermücken abfangen, Befall erkennen" },
  wolllaeuse: { name: "Bekämpfungs-Set gegen Wollläuse", path: "products/bekaempfungsset-wolllaeuse", use: "Woll- und Schmierläuse" },
  duenger: { name: "Flüssigdünger für Zimmerpflanzen", path: "products/fluessigduenger", use: "Nährstoffmangel, blasse Blätter, Düngen in der Wachstumszeit" },
  erde: { name: "Erde für Zimmerpflanzen", path: "products/zimmerpflanzenerde", use: "Umtopfen, verdichtete, verbrauchte oder schimmlige Erde ersetzen" },
  kakteenerde: { name: "Kakteenerde", path: "products/kakteenerde", use: "Kakteen und Sukkulenten, sehr durchlässiges Substrat" },
  pflegemittel: { name: "Pflegemittel bei feey (Übersicht)", path: "collections/pflegemittel", use: "weitere Pflegeprodukte" }
};
const feeyUrl = path => "https://feey.ch/" + path;
const feeySearch = q => "https://feey.ch/search?q=" + encodeURIComponent(q);
const feeyList = () => Object.entries(FEEY).map(([id, x]) => `- ${id}: ${x.name} (für ${x.use})`).join("\n");

const S = {
  db: null, user: null, assets: null, sample: null, imgLimits: null, uid: null,
  acct: { invite: null, err: "", busy: "", keyEdit: false, pwEdit: false, nameEdit: false, leave: false },
  canWrite: true, plants: [], loaded: false, stale: false, dbMissing: false, dbError: null,
  names: {}, sheet: null, day: 0, filter: { q: "", room: "" }, plan: null, prevM: {},
  settings: { photoCheckDays: 14 }, lastRoom: "",
  finder: { light: "Hell, indirekt", effort: "Normal", size: "Mittel (Tisch, Kommode)", room: "", pets: false, wish: "", have: "", busy: false, error: "", result: null }
};
const chains = {};

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const validYmd = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const utc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const addDays = (s, n) => { const d = new Date(utc(s) + n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const str = (v, max = 200) => (typeof v === "string" ? v.trim() : "").slice(0, max);
const nm = p => str(p && p.name, 60) || "Ohne Namen";
const byName = (a, b) => nm(a).localeCompare(nm(b), "de");
const getP = id => S.plants.find(p => p.id === id);
const logOf = p => (p && Array.isArray(p.log) ? p.log.filter(e => e && typeof e === "object") : []);
const photoUrl = id => window.PP.photoUrl(id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const dateFmt = (s, opts) => new Date(utc(s)).toLocaleDateString("de-CH", Object.assign({ timeZone: "UTC" }, opts));

function interval(p) { return clampInt(p.intervalDays, 1, 90, 7); }
function baseNext(p) { return validYmd(p.lastWatered) ? addDays(p.lastWatered, interval(p)) : today(); }
function nextWater(p) { const b = baseNext(p); return validYmd(p.snoozeUntil) && p.snoozeUntil > b ? p.snoozeUntil : b; }
function dueIn(p) { return diffDays(today(), nextWater(p)); }
function moisture(p) {
  if (!validYmd(p.lastWatered)) return 0;
  const total = Math.max(1, diffDays(p.lastWatered, nextWater(p)));
  return Math.max(0, Math.min(1, diffDays(today(), nextWater(p)) / total));
}
function fertOcc(p, from, to) {
  const f = clampInt(p.fertilizeDays, 0, 365, 0);
  if (!f) return [];
  let d = validYmd(p.lastFertilized) ? addDays(p.lastFertilized, f) : today();
  if (d < from) d = from;
  const out = [];
  for (let i = 0; d <= to && i < 60; i++) { out.push(d); d = addDays(d, f); }
  return out;
}
const byRoom = (a, b) => (str(a.room, 60) || "~").localeCompare(str(b.room, 60) || "~", "de") || byName(a, b);
function normProducts(a) {
  return (Array.isArray(a) ? a : []).map(x => typeof x === "string" ? { id: x, why: "" } : { id: str(x && x.id, 40), why: str(x && x.why, 160) })
    .filter((x, i, arr) => FEEY[x.id] && arr.findIndex(y => y.id === x.id) === i).slice(0, 3);
}
function productsHtml(ps) {
  if (!ps || !ps.length) return "";
  return `<div><h3>Passende Produkte bei feey</h3><ul class="prods">${ps.map(x => `<li><a href="${feeyUrl(FEEY[x.id].path)}" target="_blank" rel="noopener noreferrer"><b>${esc(FEEY[x.id].name)}</b>${x.why ? `<span>${esc(x.why)}</span>` : ""}</a></li>`).join("")}</ul></div>`;
}
function fertDue(p) {
  const f = clampInt(p.fertilizeDays, 0, 365, 0);
  if (!f) return null;
  return validYmd(p.lastFertilized) ? diffDays(today(), addDays(p.lastFertilized, f)) : 0;
}
function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function lastPhoto(p) { return logOf(p).find(e => typeof e.photoId === "string" && PHOTO_TYPES.includes(e.type)) || null; }
function photoEvery(p) {
  const base = clampInt(S.settings.photoCheckDays, 0, 90, 14);
  if (!base) return 0;
  const h = clampInt(p.health, 0, 5, 0);
  return h && h <= 2 ? Math.max(3, Math.round(base / 2)) : base;
}
function photoDueIn(p) {
  const ev = photoEvery(p);
  if (!ev) return null;
  const last = lastPhoto(p);
  if (last && validYmd(last.d)) return diffDays(today(), addDays(last.d, ev));
  const created = validYmd(str(p.createdAt, 10)) ? str(p.createdAt, 10) : today();
  return diffDays(today(), addDays(created, hashStr(p.id) % ev));
}
const canPhotoCheck = () => !!(S.sample && S.imgLimits && S.canWrite && S.assets);
function camButtons(prefix, extraAttr = "") {
  return `<input id="${prefix}-cam" class="vh" type="file" accept="image/*" capture="environment"${extraAttr}><label class="btn primary big" for="${prefix}-cam">${CAM_ICON}Foto aufnehmen</label>
    <input id="${prefix}-lib" class="vh" type="file" accept="image/*"${extraAttr}><label class="btn" for="${prefix}-lib">Aus Fotos wählen</label>`;
}
function occurrences(p, from, to) {
  const out = [];
  let d = nextWater(p);
  if (d < from) d = from;
  for (let i = 0; d <= to && i < 120; i++) { out.push(d); d = addDays(d, interval(p)); }
  return out;
}
function fmtDate(s) {
  if (!validYmd(s)) return "–";
  const [y, m, d] = s.split("-").map(Number);
  return `${d}.${m}.${y !== new Date().getFullYear() ? y : ""}`;
}
function ago(s) {
  if (!validYmd(s)) return "";
  const n = diffDays(s, today());
  return n <= 0 ? "heute" : n === 1 ? "gestern" : `vor ${n} Tagen`;
}
function dueText(d) {
  if (d < 0) return d === -1 ? "seit gestern fällig" : `seit ${-d} Tagen fällig`;
  return d === 0 ? "heute" : d === 1 ? "morgen" : `in ${d} Tagen`;
}
function dueChip(d) { return `<span class="chip ${d < 0 ? "c-crit" : d === 0 ? "c-water" : "c-mute"}">${dueText(d)}</span>`; }
function healthChip(h) {
  h = clampInt(h, 0, 5, 0);
  if (!h) return "";
  return `<span class="chip ${h <= 2 ? "c-crit" : h === 3 ? "c-dry" : "c-ok"}">${HEALTH[h]}</span>`;
}
function thumb(p, cls = "thumb") {
  const sk = cleanSketch(p.sketch);
  if (sk) return `<span class="${cls} sk" aria-hidden="true">${sk}</span>`;
  if (sketchJobs.has(p.id)) return `<span class="${cls} sk drawing" aria-hidden="true"></span>`;
  return `<span class="${cls} ph" aria-hidden="true">${esc(nm(p).charAt(0).toUpperCase())}</span>`;
}

/* ---------- sketches ---------- */
const sketchJobs = new Set();
const SK_ALLOWED = { g: [], path: ["d"], circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"], line: ["x1", "y1", "x2", "y2"], polyline: ["points"], polygon: ["points"], rect: ["x", "y", "width", "height", "rx", "ry"] };
const SK_CLASSES = new Set(["leaf", "pot", "soil", "shade", "dark", "fine"]);
const skCache = new Map();
const SK_STYLE = 3; // 3 = schwarzweiss, detailreich und naturgetreu, ganze Pflanze mit Topf
const needsSketch = p => !cleanSketch(p.sketch) || p.sketchStyle !== SK_STYLE;
const isNum = v => /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(v);
function cleanSketch(src) {
  if (typeof src !== "string" || !src || src.length > 90000) return "";
  if (skCache.has(src)) return skCache.get(src);
  let out = "";
  try {
    const doc = new DOMParser().parseFromString(src, "image/svg+xml");
    const root = doc.documentElement;
    if (root && root.localName === "svg" && !doc.getElementsByTagName("parsererror").length) {
      let n = 0;
      const ok = (name, v) => {
        if (v.length > 20000) return false;
        if (name === "d") return /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+\-eE]+$/.test(v);
        if (name === "points") return /^[0-9.,\s\-eE]+$/.test(v);
        return isNum(v.trim());
      };
      const walk = el => {
        let s = "";
        for (const c of el.children) {
          if (++n > 900) break;
          const tag = c.localName;
          if (!Object.prototype.hasOwnProperty.call(SK_ALLOWED, tag)) continue;
          let a = "";
          for (const at of SK_ALLOWED[tag]) { const v = c.getAttribute(at); if (v != null && ok(at, v)) a += ` ${at}="${v.trim().replace(/\s+/g, " ")}"`; }
          const cls = (c.getAttribute("class") || "").split(/\s+/).filter(x => SK_CLASSES.has(x));
          if (cls.length) a += ` class="${cls.join(" ")}"`;
          const tf = (c.getAttribute("transform") || "").trim();
          if (tf && tf.length < 200 && /^((translate|rotate|scale|matrix|skewX|skewY)\(\s*[-\d.,\se]*\)\s*,?\s*)+$/i.test(tf)) a += ` transform="${tf}"`;
          s += tag === "g" ? `<g${a}>${walk(c)}</g>` : `<${tag}${a}/>`;
        }
        return s;
      };
      const body = walk(root);
      const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/);
      const viewBox = vb.length === 4 && vb.every(isNum) && +vb[2] > 0 && +vb[3] > 0 ? vb.join(" ") : "0 0 200 200";
      if (body) out = `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" focusable="false">${body}</svg>`;
    }
  } catch { out = ""; }
  skCache.set(src, out);
  return out;
}
function sketchPrompt(p, hasImg) {
  return `Zeichne eine detailreiche, naturgetreue Skizze ${hasImg ? "genau dieser Zimmerpflanze auf dem Foto" : "einer typischen Zimmerpflanze dieser Art"}: ${nm(p)}${p.species ? ` (${str(p.species, 80)})` : ""}.
Ziel: Wie eine sorgfältige botanische Illustration mit Tusche. Wer die Pflanze kennt, erkennt sie sofort wieder. Nicht stilisiert, nicht symbolhaft, keine Icon- oder Clipart-Formen.
Regeln:
- Zeige immer die ganze Pflanze mit dem ganzen Topf. Nichts abschneiden: Blattspitzen, Topfrand und Topfboden liegen vollständig im Bild.
- Nur Pflanze, Topf und sichtbare Erde. Kein Hintergrund, kein Tisch, kein Text, kein Rahmen.
- viewBox="0 0 200 200". Pflanze zentriert, Topf unten, alles zusammen etwa 188 hoch, rundum etwas Rand.
- Realismus: ${hasImg ? "Übernimm vom Foto die tatsächliche Anzahl, Grösse, Richtung und Neigung der Blätter, die Stängel, die Wuchshöhe und -breite und die genaue Topfform, Topfhöhe und Topfverzierung." : "Zeichne Anzahl, Grösse und Stellung der Blätter, Stängel, Wuchshöhe und Topf so, wie sie bei einer ausgewachsenen Zimmerpflanze dieser Art typisch sind."} Stimmen müssen auch die Proportionen von Pflanze zu Topf.
- Jedes Blatt einzeln mit seiner echten Umrissform (z. B. Schlitze und Löcher, gewellte oder gezähnte Ränder, Spitzen, Herzform), mit Mittelrippe und den wichtigsten Seitenadern, mit Überlappungen und verkürzten, gedrehten oder umgebogenen Blättern, wo sie so stehen. Dazu Stiele, Stängel, Knoten, Luftwurzeln, Blüten oder Ausläufer, falls vorhanden.
- Musterungen (Streifen, Flecken, Bänderung) als feine Linien oder Flächen zeichnen.
- Licht und Tiefe: hintere oder beschattete Blätter mit class="leaf shade". Schatten, Rundung und Struktur mit feiner Schraffur als offene Pfade mit class="fine". Ganz dunkle Stellen (z. B. Löcher-Innenseiten, tiefe Schatten) als geschlossene Flächen mit class="dark", sparsam.
- Topf: Rand, Wölbung, Material und Verzierung erkennbar, die Schattenseite mit class="pot shade" oder Schraffur.
- Weglassen darfst du nur kleine, verdeckte oder unwichtige Blätter. Alles Wesentliche bleibt.
- Erlaubte Elemente: svg, g, path, circle, ellipse, line, polyline, polygon, rect. Keine style-, fill-, stroke- oder color-Attribute, keine Farben, keine Filter, keine Verläufe. Die Graustufen kommen über die Klassen.
- Blätter als geschlossene Pfade mit class="leaf", den Topf mit class="pot", sichtbare Erde mit class="soil". Blattadern, Stiele und Konturdetails als offene Pfade ohne class oder mit class="fine".
- Höchstens 400 Elemente und unter 40000 Zeichen. Koordinaten mit höchstens einer Nachkommastelle.
Antworte nur mit dem SVG-Code, ohne Erklärung.`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function makeSketch(id, blob) {
  let p = getP(id);
  for (let i = 0; !p && i < 24; i++) { await sleep(250); p = getP(id); }
  if (!p || !S.sample || sketchJobs.has(id)) return;
  sketchJobs.add(id);
  render();
  try {
    let img = blob || null;
    if (!img && p.photoId && S.imgLimits) {
      try { const r = await fetch(photoUrl(p.photoId)); if (r.ok) img = await r.blob(); } catch { img = null; }
    }
    const opts = { modelTier: "default", cache: false };
    if (img && S.imgLimits) opts.images = [img];
    const res = await S.sample(sketchPrompt(p, !!opts.images), opts);
    const m = String(res && res.text || "").match(/<svg[\s\S]*?<\/svg>/i);
    const clean = m ? cleanSketch(m[0]) : "";
    if (!clean) throw { code: "bad_svg" };
    await writePlant(id, () => ({ sketch: clean, sketchStyle: SK_STYLE }));
  } finally {
    sketchJobs.delete(id);
    render();
  }
}
async function sketchAll() {
  if (S.batch || !S.sample) return;
  const queue = S.plants.filter(needsSketch).sort(byName).map(p => p.id);
  if (!queue.length) return;
  const b = S.batch = { total: queue.length, done: 0, failed: 0, stop: false, err: "" };
  render();
  const worker = async () => {
    while (queue.length && !b.stop) {
      const id = queue.shift();
      try { await makeSketch(id); b.done++; }
      catch (e) {
        b.failed++;
        if (e && ["not_granted", "sampling_disabled", "rate_limited", "session_expired"].includes(e.code)) { b.stop = true; b.err = aiErr(e); }
      }
      render();
    }
  };
  await Promise.all([worker(), worker()]);
  S.batch = null;
  render();
  toast(b.err || `${plural(b.done, "Skizze", "Skizzen")} gezeichnet${b.failed ? `, ${b.failed} fehlgeschlagen` : ""}`);
}
function sketchPanel() {
  if (!S.sample || !S.canWrite) return "";
  const b = S.batch;
  const missing = S.plants.filter(needsSketch).length;
  const none = S.plants.filter(p => !cleanSketch(p.sketch)).length;
  const outdated = missing - none;
  if (!b && !missing) return "";
  if (b) {
    const pct = Math.round(100 * (b.done + b.failed) / Math.max(1, b.total));
    return `<section class="panel compact"><p><strong>Claude zeichnet Skizzen</strong> <span class="muted small">${b.done + b.failed} von ${b.total}</span></p><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><p class="muted small">Lass die Seite offen. Pro Pflanze dauert es etwa eine halbe Minute.</p><div class="btn-row"><button class="btn ghost sm" data-sketch-stop${b.stop ? " disabled" : ""}>${b.stop ? "Wird gestoppt …" : "Stoppen"}</button></div></section>`;
  }
  const why = [outdated ? `${plural(outdated, "Skizze ist", "Skizzen sind")} noch im alten Stil` : "", none ? `${plural(none, "Pflanze hat", "Pflanzen haben")} noch keine Skizze` : ""].filter(Boolean).join(", ");
  const label = outdated ? (missing === 1 ? "Skizze neu zeichnen" : `${missing} Skizzen neu zeichnen`) : (missing === 1 ? "Skizze zeichnen" : `${missing} Skizzen zeichnen`);
  return `<section class="panel compact"><p><strong>Skizzen für die Übersicht</strong></p><p class="muted small">${why}. Claude zeichnet sie aus dem Foto in Schwarzweiss: detailreich und naturgetreu, die ganze Pflanze mit Topf.</p><div class="btn-row"><button class="btn primary sm" data-sketch-all>${label}</button></div></section>`;
}
function tube(p) {
  const m = moisture(p);
  const from = S.prevM[p.id] ?? 0;
  return `<span class="tube${m === 0 ? " empty" : ""}" data-m="${m.toFixed(3)}" data-id="${esc(p.id)}" role="img" aria-label="Substratfeuchte ${Math.round(m * 100)} Prozent"><i style="height:${(from * 100).toFixed(1)}%"></i></span>`;
}
function hbar(p) {
  const m = moisture(p);
  const from = S.prevM[p.id] ?? 0;
  return `<span class="hbar" data-m="${m.toFixed(3)}" data-id="${esc(p.id)}" aria-hidden="true"><i style="width:${(from * 100).toFixed(1)}%"></i></span>`;
}
function fillMeters() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll("[data-m]").forEach(el => {
      const m = Number(el.dataset.m), i = el.firstElementChild;
      if (!i) return;
      if (el.classList.contains("tube")) i.style.height = (m * 100) + "%"; else i.style.width = (m * 100) + "%";
      S.prevM[el.dataset.id] = m;
    });
  }));
}
function who(id) {
  if (!id || typeof id !== "string") return "Unbekannt";
  if (id === S.uid) return "Du";
  return S.names[id] || "Jemand";
}
function timeOf(t) {
  try { return new Date(t).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
function dayLabel(d) {
  if (!validYmd(d)) return "Ohne Datum";
  const n = diffDays(d, today());
  if (n === 0) return "Heute";
  if (n === 1) return "Gestern";
  if (n === -1) return "Morgen";
  return dateFmt(d, { weekday: "long", day: "numeric", month: "long" });
}
function season() {
  const now = new Date(), m = now.getMonth();
  return { name: now.toLocaleDateString("de-CH", { month: "long" }), winter: m >= 9 || m <= 2 };
}
function section(title, count, body, extra = "") {
  return `<section${extra}><h2>${esc(title)}${count != null ? `<span class="count">${count}</span>` : ""}</h2>${body}</section>`;
}
function kicker(text) { return `<p class="kicker">Pflanzenpflege · ${esc(text)}</p>`; }

/* ---------- writing ---------- */
function writeMsg(e) {
  const c = e && e.code;
  if (c === "invalid_argument") return "Du hast keine Bearbeitungsrechte für diese Seite.";
  if (c === "quota_exceeded") return "Der Speicher ist voll. Lösche alte Pflanzen oder Fotos.";
  if (c === "resource_exhausted") return "Zu viele Änderungen auf einmal. Warte kurz und versuch es nochmals.";
  return "Speichern hat nicht geklappt. Prüfe die Verbindung und versuch es nochmals.";
}
function writeErr(e) {
  if (e && e.code === "invalid_argument") { S.canWrite = false; render(); }
  toast(writeMsg(e));
}
function writePlant(id, fn) {
  const ref = S.db.collection("plants").doc(id);
  const job = (chains[id] || Promise.resolve()).catch(() => {}).then(() => {
    const cur = getP(id);
    if (!cur) throw { code: "gone" };
    return ref.update(fn(cur));
  });
  chains[id] = job;
  return job;
}
async function createPlant(data, log) {
  const ref = S.db.collection("plants").doc();
  await ref.set(Object.assign({}, data, { createdAt: new Date().toISOString(), log: log || [] }));
  return ref.id;
}
function mkEntry(type, extra) {
  const e = Object.assign({ t: new Date().toISOString(), d: today(), type }, extra || {});
  if (S.uid) e.by = S.uid;
  return e;
}
const pushLog = (cur, entry) => [entry, ...logOf(cur)].slice(0, LOGMAX);

function logAction(id, type, patch, msg, extra) {
  const p = getP(id);
  if (!p || !S.canWrite) return;
  const prev = {};
  Object.keys(patch).forEach(k => { prev[k] = p[k]; });
  const entry = mkEntry(type, extra);
  writePlant(id, cur => Object.assign({}, patch, { log: pushLog(cur, entry) })).catch(writeErr);
  toast(msg, "Rückgängig", () => {
    writePlant(id, cur => {
      const back = {};
      Object.keys(prev).forEach(k => { back[k] = prev[k] === undefined ? { __delete__: true } : prev[k]; });
      back.log = logOf(cur).filter(x => x.t !== entry.t);
      return back;
    }).catch(writeErr);
  });
}
function water(id) {
  const p = getP(id);
  if (!p) return;
  logAction(id, "water", { lastWatered: today(), snoozeUntil: { __delete__: true } }, `${nm(p)} gegossen`, { late: Math.max(0, -dueIn(p)) });
}
const fertilize = id => logAction(id, "fert", { lastFertilized: today() }, `${nm(getP(id))} gedüngt`);
const repot = id => logAction(id, "repot", { lastRepotted: today() }, `${nm(getP(id))} als umgetopft vermerkt`);
function snooze(id, n) {
  const p = getP(id);
  if (!p) return;
  logAction(id, "skip", { snoozeUntil: addDays(today(), n) }, `${nm(p)} ${n === 1 ? "auf morgen" : `um ${n} Tage`} verschoben`, { days: n });
}
function waterAll() {
  const due = S.plants.filter(p => dueIn(p) <= 0);
  const undo = [];
  for (const p of due) {
    const entry = mkEntry("water", { late: Math.max(0, -dueIn(p)) });
    undo.push({ id: p.id, prev: p.lastWatered, prevSnooze: p.snoozeUntil, t: entry.t });
    writePlant(p.id, cur => ({ lastWatered: today(), snoozeUntil: { __delete__: true }, log: pushLog(cur, entry) })).catch(writeErr);
  }
  toast(`${plural(due.length, "Pflanze", "Pflanzen")} gegossen`, "Rückgängig", () => {
    undo.forEach(u => writePlant(u.id, cur => ({
      lastWatered: u.prev === undefined ? { __delete__: true } : u.prev,
      snoozeUntil: u.prevSnooze === undefined ? { __delete__: true } : u.prevSnooze,
      log: logOf(cur).filter(x => x.t !== u.t)
    })).catch(writeErr));
  });
}
function fertAll() {
  const due = S.plants.filter(p => { const f = fertDue(p); return f !== null && f <= 0; });
  const undo = [];
  for (const p of due) {
    const entry = mkEntry("fert");
    undo.push({ id: p.id, prev: p.lastFertilized, t: entry.t });
    writePlant(p.id, cur => ({ lastFertilized: today(), log: pushLog(cur, entry) })).catch(writeErr);
  }
  toast(`${plural(due.length, "Pflanze", "Pflanzen")} gedüngt`, "Rückgängig", () => {
    undo.forEach(u => writePlant(u.id, cur => ({ lastFertilized: u.prev === undefined ? { __delete__: true } : u.prev, log: logOf(cur).filter(x => x.t !== u.t) })).catch(writeErr));
  });
}
async function deletePlant(id) {
  const name = nm(getP(id));
  try {
    await (chains[id] || Promise.resolve()).catch(() => {});
    await S.db.collection("plants").doc(id).delete();
    closeSheet();
    toast(`${name} gelöscht`);
  } catch (e) { writeErr(e); }
}
function snoozeHint(p) {
  const since = str(p.intervalSetAt, 40);
  const ev = logOf(p).filter(e => (e.type === "water" || e.type === "skip") && String(e.t) > since).slice(0, 6);
  const skips = ev.filter(e => e.type === "skip");
  if (skips.length < 2) return null;
  const avg = skips.reduce((s, e) => s + clampInt(e.days, 1, 14, 1), 0) / skips.length;
  const suggest = clampInt(interval(p) + Math.max(1, Math.round(avg)), 1, 90, interval(p));
  return suggest > interval(p) ? { skips: skips.length, suggest } : null;
}

/* ---------- photos ---------- */
async function shrink(file, max = 1600) {
  try {
    let src, w, h;
    try {
      src = await createImageBitmap(file, { imageOrientation: "from-image" });
      w = src.width; h = src.height;
    } catch {
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
    return b || file;
  } catch { return file; }
}
async function uploadPhoto(fileOrBlob, alreadyShrunk) {
  const b = alreadyShrunk ? fileOrBlob : await shrink(fileOrBlob);
  const r = await S.assets.upload(b);
  return r.id;
}

/* ---------- Claude ---------- */
function aiErr(e) {
  const c = e && e.code;
  return ({
    not_granted: "Für die KI-Funktionen braucht dein Haushalt einen Anthropic-Schlüssel. Trag ihn unter «Verlauf» bei «Einstellungen» ein.",
    no_key: "Für die KI-Funktionen braucht dein Haushalt einen Anthropic-Schlüssel. Trag ihn unter «Verlauf» bei «Einstellungen» ein.",
    key_rejected: "Anthropic lehnt den hinterlegten Schlüssel ab. Ersetze ihn unter «Verlauf» bei «Einstellungen».",
    no_credit: "Auf dem Anthropic-Konto deines Haushalts ist kein Guthaben mehr. Lade es auf console.anthropic.com auf.",
    network: "Keine Verbindung. Prüfe das Internet und versuch es nochmals.",
    sampling_disabled: "Claude ist für dieses Konto hier nicht verfügbar.",
    unavailable: "Der Server antwortet gerade nicht. Versuch es gleich nochmals.",
    rate_limited: "Gerade zu viele Anfragen. Versuch es in einer Minute nochmals.",
    image_rejected: "Dieses Foto geht nicht. Versuch ein anderes (JPEG oder PNG).",
    images_unavailable: "Fotos können hier nicht an Claude geschickt werden. Beschreib das Problem in Worten.",
    invalid_json: "Die Antwort war unvollständig. Bitte nochmals versuchen.",
    session_expired: "Bitte melde dich neu an.",
    refused: "Claude konnte diese Anfrage nicht beantworten. Formuliere sie anders.",
    cancelled: "Abgebrochen."
  })[c] || "Das hat nicht geklappt. Bitte später nochmals versuchen.";
}
function profilePrompt(items) {
  const se = season();
  return `Du bist Expertin für Zimmerpflanzen. Erstelle für jede Pflanze unten ein Pflegeprofil für eine Wohnung in der Schweiz.
Aktueller Monat: ${se.name}. ${se.winter ? "Es ist Heizperiode: Giessintervalle eher länger als im Sommer, Düngen meist pausieren (fertilizeDays 0)." : "Wachstumszeit: normale Giessintervalle, Düngen alle 2 bis 4 Wochen üblich."}

Pflanzen:
${items.map((x, i) => `${i + 1}. ${x.name}${x.species ? ` (Art: ${x.species})` : ""}${x.room ? `, Raum: ${x.room}` : ""}`).join("\n")}

Antworte nur mit einem JSON-Array mit genau ${items.length} Objekt(en), in derselben Reihenfolge, jedes in dieser Form:
{"species": "botanischer Name", "intervalDays": ganze Zahl, "fertilizeDays": ganze Zahl, "light": "Schatten" | "Halbschatten" | "Hell, indirekt" | "Sonnig", "amount": "Wenig" | "Mittel" | "Viel" | "Tauchen", "careNote": "ein konkreter Pflegehinweis, max. 100 Zeichen"}
Schreibe Schweizer Hochdeutsch (ss statt ß). Ist eine Pflanze unklar, nimm die wahrscheinlichste Zimmerpflanze und erwähne das in careNote.`;
}
function normalizeProfile(o, base) {
  o = o && typeof o === "object" ? o : {};
  return {
    name: base.name, room: base.room || "",
    species: str(o.species, 80) || base.species || "",
    intervalDays: clampInt(o.intervalDays, 1, 90, 7),
    fertilizeDays: clampInt(o.fertilizeDays, 0, 365, 0),
    light: LIGHT.includes(o.light) ? o.light : "Hell, indirekt",
    amount: AMOUNT.includes(o.amount) ? o.amount : "Mittel",
    careNote: str(o.careNote, 160)
  };
}
function identifyPrompt() {
  const se = season();
  return `Bestimme die Zimmerpflanze auf dem Foto und erstelle ein Pflegeprofil für eine Wohnung in der Schweiz.
Aktueller Monat: ${se.name}. ${se.winter ? "Es ist Heizperiode: Giessintervalle eher länger als im Sommer, Düngen meist pausieren (fertilizeDays 0)." : "Wachstumszeit: normale Giessintervalle, Düngen alle 2 bis 4 Wochen üblich."}
Achte auf Blattform, Wuchs, Musterung und Topfgrösse. Schätze auch den Zustand der Pflanze nach dem Foto.

Antworte nur mit JSON in dieser Form:
{"name": "gebräuchlicher deutscher Name", "species": "botanischer Name", "confidence": "hoch" | "mittel" | "tief", "alternatives": [{"name": "deutscher Name", "species": "botanischer Name"}], "intervalDays": ganze Zahl, "fertilizeDays": ganze Zahl, "light": "Schatten" | "Halbschatten" | "Hell, indirekt" | "Sonnig", "amount": "Wenig" | "Mittel" | "Viel" | "Tauchen", "careNote": "ein konkreter Pflegehinweis, max. 100 Zeichen", "health": ganze Zahl 1 bis 5 (1 kritisch, 5 prächtig), "healthNote": "kurze Einschätzung des sichtbaren Zustands, max. 120 Zeichen"}
alternatives nur bei confidence "mittel" oder "tief", höchstens 2, sonst leeres Array.
Ist auf dem Foto keine Pflanze zu erkennen, antworte nur mit {"error": "kurzer Grund"}.
Schreibe Schweizer Hochdeutsch (ss statt ß).`;
}
function normalizeScan(o) {
  o = o && typeof o === "object" ? o : {};
  const name = str(o.name, 60) || str(o.species, 60) || "Neue Pflanze";
  const base = normalizeProfile(o, { name, room: S.lastRoom || "", species: "" });
  return Object.assign(base, {
    confidence: ["hoch", "mittel", "tief"].includes(o.confidence) ? o.confidence : "mittel",
    alternatives: (Array.isArray(o.alternatives) ? o.alternatives : [])
      .map(a => ({ name: str(a && a.name, 60), species: str(a && a.species, 80) })).filter(a => a.name).slice(0, 2),
    health: clampInt(o.health, 0, 5, 0),
    healthNote: str(o.healthNote, 200)
  });
}
function doctorPrompt(p, text, nImg, prevDate) {
  const se = season();
  const log = logOf(p);
  const waters = log.filter(e => e.type === "water" && validYmd(e.d)).slice(0, 10).map(e => fmtDate(e.d));
  const skips = log.filter(e => e.type === "skip").slice(0, 5).length;
  const checks = log.filter(e => PHOTO_TYPES.includes(e.type) && e.health).slice(0, 4)
    .map(e => `${fmtDate(e.d)}: ${HEALTH[clampInt(e.health, 1, 5, 3)]}${e.note ? `, ${str(e.note, 140)}` : ""}`);
  return `Du bist eine erfahrene Pflanzendoktorin für Zimmerpflanzen. Beurteile die Gesundheit dieser Pflanze${nImg ? ` anhand der ${nImg} Foto(s) und` : " anhand"} der Angaben.

Pflanze: ${nm(p)}${p.species ? ` (${str(p.species, 80)})` : ""}
Raum: ${str(p.room, 60) || "unbekannt"}; Lichtbedarf laut Profil: ${p.light || "unbekannt"}
Giessintervall: alle ${interval(p)} Tage, Menge: ${p.amount || "unbekannt"}
Zuletzt gegossen: ${validYmd(p.lastWatered) ? `${fmtDate(p.lastWatered)} (${ago(p.lastWatered)})` : "unbekannt"}
Giessdaten zuletzt: ${waters.join(", ") || "keine erfasst"}
Giessen verschoben, weil Erde noch feucht: ${skips}× in letzter Zeit
Düngen: ${clampInt(p.fertilizeDays, 0, 365, 0) ? `alle ${p.fertilizeDays} Tage, zuletzt ${fmtDate(p.lastFertilized)}` : "pausiert"}
Frühere Check-ins: ${checks.join("; ") || "keine"}
Heute: ${fmtDate(today())}, Monat ${se.name}. Wohnung in der Schweiz${se.winter ? ", Heizperiode mit trockener Raumluft und weniger Licht" : ""}.
Beobachtung der Person: ${text ? `"${text}"` : "keine Angabe"}
Du darfst zur Behandlung Produkte vom Schweizer Pflanzenshop feey empfehlen, aber nur aus dieser Liste und nur, wenn sie wirklich zum Problem passen:
${feeyList()}
${prevDate ? `Bild 1 ist heute aufgenommen. Bild 2 ist das vorherige Foto vom ${fmtDate(prevDate)}. Vergleiche beide und beurteile, ob sich der Zustand verändert hat.` : "Es gibt kein früheres Foto zum Vergleich."}

Antworte nur mit JSON in dieser Form:
{"health": ganze Zahl 1 bis 5 (1 kritisch, 3 okay, 5 prächtig), "trend": "besser" | "gleich" | "schlechter" | "unklar", "summary": "Diagnose in 1 bis 2 Sätzen", "causes": ["wahrscheinliche Ursachen, höchstens 3, leer wenn alles gut ist"], "actions": ["konkrete nächste Schritte, höchstens 5"], "intervalDays": empfohlenes Giessintervall als ganze Zahl oder null, wenn das aktuelle passt, "urgency": "niedrig" | "mittel" | "hoch", "products": [{"id": "ID aus der feey-Liste", "why": "wofür, max. 80 Zeichen"}]}
products: höchstens 3, leer, wenn kein Produkt nötig ist.
Schreibe Schweizer Hochdeutsch (ss statt ß), klar und praktisch.`;
}
function normalizeDiag(o) {
  o = o && typeof o === "object" ? o : {};
  const list = (a, n) => (Array.isArray(a) ? a : []).map(x => str(x, 240)).filter(Boolean).slice(0, n);
  return {
    health: clampInt(o.health, 1, 5, 3),
    trend: ["besser", "gleich", "schlechter"].includes(o.trend) ? o.trend : "unklar",
    summary: str(o.summary, 500) || "Keine eindeutige Diagnose.",
    causes: list(o.causes, 3),
    actions: list(o.actions, 5),
    intervalDays: o.intervalDays == null ? null : clampInt(o.intervalDays, 1, 90, null),
    urgency: ["niedrig", "mittel", "hoch"].includes(o.urgency) ? o.urgency : "mittel",
    products: normProducts(o.products)
  };
}

/* ---------- views ---------- */
const app = $("#app");
function view() { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : "heute"; }

function banner() {
  const b = [];
  if (S.dbMissing) b.push("Die Daten sind gerade nicht erreichbar. Lade die Seite neu.");
  else if (S.dbError) b.push("Die Daten konnten nicht geladen werden. Lade die Seite später neu.");
  else if (S.stale) b.push(S.plants.length ? "Keine Verbindung zum Speicher. Die Angaben sind evtl. nicht aktuell." : "Die Pflanzen lassen sich gerade nicht laden. Prüfe die Verbindung.");
  if (!S.canWrite && !S.dbMissing) b.push("Du kannst hier nur ansehen. Zum Abhaken brauchst du Bearbeitungsrechte vom Besitzer der Seite.");
  return b.map(t => `<p class="banner" role="status">${esc(t)}</p>`).join("");
}
function emptyState() {
  if (!S.canWrite || S.dbMissing) return `<section class="panel"><h2>Noch keine Pflanzen</h2><p>Hier sind noch keine Pflanzen erfasst.</p></section>`;
  if (canScan()) return `<section class="camera-hero">
    <h2>Fang mit deiner Sammlung an</h2>
    <p>Fotografiere eine Pflanze. Claude erkennt die Art und schlägt Giessintervall, Menge und Lichtbedarf vor. Du wählst nur noch den Raum.</p>
    <div class="pick"><button class="btn primary big" data-scan>${CAM_ICON}Pflanze fotografieren</button></div>
    <div class="btn-row"><button class="btn ghost sm" data-bulk>Mehrere als Liste erfassen</button><button class="btn ghost sm" data-new>Ohne Foto erfassen</button></div>
  </section>`;
  return `<section class="panel">
    <h2>Fang mit deiner Sammlung an</h2>
    <p>Am schnellsten geht es mit «Mehrere erfassen»: eine Pflanze pro Zeile, zum Beispiel «Monstera, Wohnzimmer». ${S.sample ? "Claude schlägt für jede Pflanze Giessintervall, Menge und Lichtbedarf vor." : ""}</p>
    <div class="btn-row"><button class="btn primary" data-bulk>Mehrere erfassen</button><button class="btn" data-new>Einzeln hinzufügen</button></div>
  </section>`;
}
const canScan = () => !!(S.sample && S.imgLimits && S.canWrite);
function photoCheckSection() {
  if (!canPhotoCheck()) return "";
  const due = S.plants.map(p => ({ p, d: photoDueIn(p) })).filter(x => x.d !== null && x.d <= 0).sort((a, b) => a.d - b.d || byName(a.p, b.p));
  if (!due.length) return "";
  const shown = due.slice(0, 5);
  const rows = shown.map(({ p }) => {
    const last = lastPhoto(p);
    const meta = last && validYmd(last.d) ? `Letztes Foto ${ago(last.d)}` : "Noch kein Zustandsfoto";
    const acts = `<input id="pcq-${esc(p.id)}" class="vh" type="file" accept="image/*" capture="environment" data-photocheck="${esc(p.id)}"><label class="btn water sm" for="pcq-${esc(p.id)}">${CAM_ICON}Foto machen</label>`;
    return row(p, { meta, chip: healthChip(p.health) || `<span class="chip c-mute">Foto-Check</span>`, acts });
  }).join("");
  return section("Foto-Check vom Pflanzendoktor", due.length,
    `<p class="muted small" style="margin:-4px 0 10px">Ein Foto pro Pflanze, bei Tageslicht und mit der ganzen Pflanze. Claude vergleicht es mit dem letzten Foto.</p><ul class="rows">${rows}</ul>` +
    (due.length > shown.length ? `<p class="muted small" style="margin-top:8px">Und ${plural(due.length - shown.length, "weitere Pflanze", "weitere Pflanzen")}, sobald diese erledigt sind.</p>` : ""));
}
function row(p, opts) {
  const o = Object.assign({ d: null, acts: "", chip: "", note: false, meta: null }, opts);
  const meta = o.meta != null ? o.meta : [str(p.room, 60), p.amount ? `Menge ${p.amount.toLowerCase()}` : ""].filter(Boolean).join(" · ");
  const chip = o.chip || (o.d != null ? dueChip(o.d) : "");
  return `<li class="row${o.acts ? "" : " simple"}" data-open="${esc(p.id)}" tabindex="0">
    ${tube(p)}${thumb(p)}
    <div class="row-main"><span class="row-name">${esc(nm(p))}</span>${meta ? `<span class="row-meta">${esc(meta)}</span>` : ""}${o.note && p.careNote ? `<span class="row-note">${esc(str(p.careNote, 300))}</span>` : ""}</div>
    <div class="row-chip">${chip}</div>
    ${o.acts ? `<div class="row-acts">${o.acts}</div>` : ""}
  </li>`;
}
function waterActs(p) {
  if (!S.canWrite) return "";
  return `<button class="btn water sm" data-water="${esc(p.id)}">Gegossen</button><button class="btn ghost sm" data-snooze="${esc(p.id)}">Erde noch feucht</button>`;
}
function calendar() {
  const t = today(), end = addDays(t, CAL_DAYS - 1);
  const wc = new Map(), fc = new Map();
  S.plants.forEach(p => {
    occurrences(p, t, end).forEach(d => wc.set(d, (wc.get(d) || 0) + 1));
    fertOcc(p, t, end).forEach(d => fc.set(d, (fc.get(d) || 0) + 1));
  });
  const sel = addDays(t, S.day);
  const days = [...Array(CAL_DAYS)].map((_, i) => addDays(t, i));
  return `<div class="cal">
    <div class="cal-head"><span class="cal-month">${esc(dateFmt(sel, { month: "long", year: "numeric" }))}</span>${S.day ? `<button class="linkish" data-day="0">Zurück zu heute</button>` : `<span class="muted small">Wischen für die nächsten Monate</span>`}</div>
    <div class="strip hscroll" data-keep="strip" role="group" aria-label="Kalender der nächsten ${CAL_DAYS} Tage">${days.map((d, i) => {
      const w = wc.get(d) || 0, f = fc.get(d) || 0, first = d.slice(8) === "01";
      const wd = i === 0 ? "Heute" : first ? dateFmt(d, { month: "short" }).replace(".", "") : dateFmt(d, { weekday: "short" }).replace(".", "");
      return `<button class="day${first ? " mstart" : ""}" data-day="${i}" aria-pressed="${S.day === i}" aria-label="${esc(dayLabel(d))}: ${plural(w, "Pflanze giessen", "Pflanzen giessen")}${f ? `, ${f} düngen` : ""}"><span class="wd">${esc(wd)}</span><span class="dn">${Number(d.slice(8))}</span><span class="dc">${w || ""}${f ? `<i class="fd"></i>` : ""}</span></button>`;
    }).join("")}</div>
  </div>`;
}
function dayTasks(d) {
  const isToday = d === today();
  const water = isToday ? S.plants.filter(p => dueIn(p) <= 0) : S.plants.filter(p => occurrences(p, today(), d).includes(d));
  const fert = isToday ? S.plants.filter(p => { const f = fertDue(p); return f !== null && f <= 0; }) : S.plants.filter(p => fertOcc(p, today(), d).includes(d));
  return { water: water.sort(byRoom), fert: fert.sort(byRoom) };
}
function taskItem(p, o) {
  const meta = o.meta ? o.meta(p) : esc(str(p.room, 60));
  return `<li class="task" data-open="${esc(p.id)}" tabindex="0">${thumb(p)}<div class="task-main"><span class="task-name">${esc(nm(p))}</span>${meta ? `<span class="task-meta">${meta}</span>` : ""}</div><div class="task-acts">${o.acts ? o.acts(p) : ""}</div></li>`;
}
function taskCard(kind, title, sub, plants, o = {}) {
  if (!plants.length) return "";
  const groups = new Map();
  plants.forEach(p => { const r = str(p.room, 60) || "Ohne Raum"; if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  const multi = groups.size > 1;
  const body = [...groups].map(([r, ps]) => `${multi ? `<p class="task-room">${esc(r)}</p>` : ""}<ul class="task-list">${ps.map(p => taskItem(p, o)).join("")}</ul>`).join("");
  return `<section class="task-card" aria-label="${esc(title)}"><div class="task-head"><span class="task-ic ic-${kind}" aria-hidden="true">${IC[kind]}</span><div class="task-title"><b>${esc(title)}</b>${sub ? `<span>${sub}</span>` : ""}</div><span class="count">${plants.length}</span></div>${body}${o.footer ? `<div class="task-foot">${o.footer}</div>` : ""}</section>`;
}
function renderToday() {
  const t = today();
  const head = kicker(dateFmt(t, { weekday: "long", day: "numeric", month: "long" }));
  if (!S.plants.length) return `<header>${head}<h1 class="headline">Willkommen im <em>Pflanzenzimmer</em>.</h1></header>` + emptyState();
  const isToday = S.day === 0, d = addDays(t, S.day), W = S.canWrite && isToday;
  const { water, fert } = dayTasks(d);
  const photo = isToday && canPhotoCheck() ? S.plants.filter(p => (photoDueIn(p) ?? 1) <= 0).sort(byRoom).slice(0, 6) : [];
  const sick = isToday ? S.plants.filter(p => { const h = clampInt(p.health, 0, 5, 0); return h && h <= 2 && !photo.includes(p); }).sort(byRoom) : [];
  const parts = [water.length ? `${plural(water.length, "Pflanze", "Pflanzen")} giessen` : "", fert.length ? `${fert.length} düngen` : "", photo.length ? `${photo.length} fotografieren` : ""].filter(Boolean);
  const n = water.length + fert.length + photo.length;
  let h = "";
  if (isToday) {
    const title = n ? `Heute: <em>${plural(n, "Aufgabe", "Aufgaben")}</em>.` : `Heute ist <em>alles erledigt</em>.`;
    let lede = parts.join(", ");
    if (!n) {
      const next = [...Array(CAL_DAYS - 1)].map((_, i) => addDays(t, i + 1)).find(x => { const k = dayTasks(x); return k.water.length || k.fert.length; });
      if (next) { const k = dayTasks(next); lede = `Als Nächstes ${dayLabel(next) === "Morgen" ? "morgen" : `am ${dayLabel(next)}`}: ${[k.water.length ? `${plural(k.water.length, "Pflanze", "Pflanzen")} giessen` : "", k.fert.length ? `${k.fert.length} düngen` : ""].filter(Boolean).join(", ")}.`; }
    }
    h += `<header>${head}<h1 class="headline">${title}</h1>${lede ? `<p class="lede">${esc(lede)}</p>` : ""}</header>`;
  } else {
    h += `<header>${kicker("Vorschau")}<h1 class="headline">${esc(dayLabel(d))}: <em>${n ? plural(n, "Aufgabe", "Aufgaben") : "frei"}</em>.</h1>${parts.length ? `<p class="lede">${esc(parts.join(", "))}. Vorschau, falls bis dahin nach Plan gepflegt wird.</p>` : ""}</header>`;
  }
  h += calendar();
  let cards = "";
  const late = water.filter(p => dueIn(p) < 0).length;
  cards += taskCard("water", "Giessen", isToday && late ? `${late} davon überfällig` : "Nach Raum sortiert", water, {
    meta: p => [`Menge ${esc(String(p.amount || "Mittel").toLowerCase())}`, isToday && dueIn(p) < 0 ? `<span class="late">${esc(dueText(dueIn(p)))}</span>` : ""].filter(Boolean).join(" · "),
    acts: W ? p => `<button class="linkish" data-snooze="${esc(p.id)}">noch feucht</button><button class="check" data-water="${esc(p.id)}" aria-label="${esc(nm(p))} gegossen" title="Gegossen">${IC.check}</button>` : null,
    footer: W && water.length > 1 ? `<button class="btn water block" data-water-all>Alle ${water.length} gegossen</button>` : ""
  });
  cards += taskCard("fert", "Düngen", isToday ? "Dünger ins Giesswasser" : "", fert, {
    meta: p => esc(`alle ${clampInt(p.fertilizeDays, 0, 365, 0)} Tage`),
    acts: W ? p => `<button class="check fert" data-fert="${esc(p.id)}" aria-label="${esc(nm(p))} gedüngt" title="Gedüngt">${IC.check}</button>` : null,
    footer: W && fert.length > 1 ? `<button class="btn block" data-fert-all>Alle ${fert.length} gedüngt</button>` : ""
  });
  cards += taskCard("photo", "Foto-Check", "Ganze Pflanze bei Tageslicht. Claude vergleicht mit dem letzten Foto.", photo, {
    meta: p => { const last = lastPhoto(p); return esc(last && validYmd(last.d) ? `Letztes Foto ${ago(last.d)}` : "Noch kein Zustandsfoto"); },
    acts: p => `<input id="pcq-${esc(p.id)}" class="vh" type="file" accept="image/*" capture="environment" data-photocheck="${esc(p.id)}"><label class="btn sm" for="pcq-${esc(p.id)}">${CAM_ICON}Foto</label>`
  });
  cards += taskCard("crit", "Braucht Aufmerksamkeit", "Zuletzt als schwach eingeschätzt", sick, {
    meta: p => esc(HEALTH[clampInt(p.health, 1, 5, 3)]),
    acts: S.sample ? p => `<button class="btn sm" data-doctor="${esc(p.id)}">Doktor</button>` : null
  });
  h += cards ? `<div class="tasks">${cards}</div>` : `<section class="calm"><p><strong>${isToday ? "Heute nichts zu tun." : "An diesem Tag ist nichts geplant."}</strong> ${isToday ? "Schau dir im Kalender die nächsten Tage an." : ""}</p></section>`;
  return h;
}
function card(p) {
  return `<button class="card" data-open="${esc(p.id)}"><span class="card-photo">${thumb(p, "card-img")}${hbar(p)}</span><span class="card-body"><span class="card-name">${esc(nm(p))}</span>${p.species ? `<span class="sp">${esc(str(p.species, 80))}</span>` : ""}<span class="chips">${dueChip(dueIn(p))}${healthChip(p.health)}</span></span></button>`;
}
function renderPlants() {
  const head = kicker("Sammlung");
  if (!S.plants.length) return `<header>${head}<h1 class="headline">Noch keine Pflanzen.</h1></header>` + emptyState();
  const rooms = [...new Set(S.plants.map(p => str(p.room, 60)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  if (S.filter.room && !rooms.includes(S.filter.room)) S.filter.room = "";
  const q = S.filter.q.toLowerCase();
  const shown = S.plants.filter(p => (!S.filter.room || str(p.room, 60) === S.filter.room) &&
    (!q || [p.name, p.species, p.room].some(v => str(v, 100).toLowerCase().includes(q))));
  const groups = {};
  shown.forEach(p => { const r = str(p.room, 60) || "Ohne Raum"; (groups[r] = groups[r] || []).push(p); });
  const order = Object.keys(groups).sort((a, b) => a === "Ohne Raum" ? 1 : b === "Ohne Raum" ? -1 : a.localeCompare(b, "de"));
  let h = `<header class="head-row"><div>${head}<h1 class="headline"><em class="ok">${S.plants.length}</em> ${S.plants.length === 1 ? "Pflanze" : "Pflanzen"} in ${plural(rooms.length || 1, "Raum", "Räumen")}.</h1></div>${S.canWrite ? `<button class="add-btn" data-add aria-label="Pflanzen hinzufügen" title="Pflanzen hinzufügen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>` : ""}</header>`;
  h += `<div class="toolbar">
    <label class="search"><span class="muted small" style="position:absolute;width:1px;height:1px;overflow:hidden">Pflanzen suchen</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input id="search" type="search" placeholder="Suchen nach Name, Art oder Raum" value="${esc(S.filter.q)}" autocomplete="off"></label>
    ${rooms.length > 1 ? `<div class="pills hscroll" data-keep="rooms" role="group" aria-label="Nach Raum filtern"><button class="pill" data-room="" aria-pressed="${!S.filter.room}">Alle</button>${rooms.map(r => `<button class="pill" data-room="${esc(r)}" aria-pressed="${S.filter.room === r}">${esc(r)}</button>`).join("")}</div>` : ""}
  </div>` + sketchPanel();
  let settingsHtml = "";
  if (canPhotoCheck()) {
    const cur = clampInt(S.settings.photoCheckDays, 0, 90, 14);
    settingsHtml = `<section class="panel compact"><p><strong>Foto-Check durch den Pflanzendoktor</strong></p><p class="muted small">So oft fragt die App pro Pflanze nach einem Zustandsfoto. Schwache Pflanzen doppelt so oft.</p><div class="pills pills-wrap" role="group" aria-label="Foto-Check Häufigkeit">${[7, 14, 30, 0].map(v => `<button class="pill" data-photo-every="${v}" aria-pressed="${cur === v}">${v ? `alle ${v} Tage` : "aus"}</button>`).join("")}</div></section>`;
  }
  if (!shown.length) return h + `<section class="calm"><p>Keine Pflanze passt zu dieser Suche.</p></section>` + settingsHtml;
  return h + order.map(r => section(r, groups[r].length, `<div class="grid">${groups[r].sort(byName).map(card).join("")}</div>`)).join("") + settingsHtml;
}
function finderPrompt(f) {
  return `Du bist Beraterin in einem Schweizer Pflanzengeschäft. Schlage 4 Zimmerpflanzen vor, die zu diesen Bedingungen passen.
Licht am Standort: ${f.light}. Pflegeaufwand: ${f.effort}. Grösse: ${f.size}. Raum: ${f.room || "egal"}.${f.pets ? " Muss für Katzen und Hunde ungiftig sein." : ""}
Wünsche: ${f.wish || "keine"}.
Schon vorhanden, nicht nochmals vorschlagen: ${S.plants.map(nm).slice(0, 40).join(", ") || "nichts"}.
Bevorzuge Pflanzen, die in der Schweiz gut erhältlich sind, etwa beim Onlineshop feey.
Antworte nur mit einem JSON-Array: [{"name": "deutscher Name", "species": "botanischer Name", "why": "warum sie passt, max. 120 Zeichen", "care": "Pflege in einem Satz", "difficulty": "leicht" | "mittel" | "anspruchsvoll", "petSafe": true | false}]
Schreibe Schweizer Hochdeutsch (ss statt ß).`;
}
async function runFinder() {
  const f = S.finder;
  if (f.busy || !S.sample) return;
  f.busy = true; f.error = ""; render();
  try {
    const a = await S.sample.json(finderPrompt(f), { modelTier: "default" });
    const arr = Array.isArray(a) ? a : (a && Array.isArray(a.plants) ? a.plants : []);
    f.result = arr.map(x => ({ name: str(x && x.name, 60), species: str(x && x.species, 80), why: str(x && x.why, 200), care: str(x && x.care, 200),
      difficulty: ["leicht", "mittel", "anspruchsvoll"].includes(x && x.difficulty) ? x.difficulty : "", petSafe: !!(x && x.petSafe === true) })).filter(x => x.name).slice(0, 6);
    if (!f.result.length) f.error = "Keine Vorschläge erhalten. Versuch es nochmals.";
  } catch (e) { f.error = aiErr(e); }
  f.busy = false; render();
}
function finderHtml(f) {
  if (f.busy) return `<p class="status" role="status">Claude sucht passende Pflanzen …</p>`;
  if (f.error) return `<p class="err">${esc(f.error)}</p>`;
  if (!f.result) return "";
  return `<div class="sugs">${f.result.map((x, i) => `<div class="sug">
    <p class="sug-name">${esc(x.name)}</p>${x.species ? `<p class="sp">${esc(x.species)}</p>` : ""}
    <div class="chips">${x.difficulty ? `<span class="chip ${x.difficulty === "leicht" ? "c-ok" : x.difficulty === "mittel" ? "c-mute" : "c-dry"}">${esc(x.difficulty)}</span>` : ""}<span class="chip ${x.petSafe ? "c-ok" : "c-mute"}">${x.petSafe ? "ungiftig für Tiere" : "nicht für Haustiere"}</span></div>
    ${x.why ? `<p>${esc(x.why)}</p>` : ""}${x.care ? `<p class="muted small">${esc(x.care)}</p>` : ""}
    <div class="btn-row"><a class="btn sm" href="${feeySearch(x.name)}" target="_blank" rel="noopener noreferrer">Bei feey suchen ↗</a><button class="btn sm" data-guide-name="${i}">Anleitung</button>${S.canWrite ? `<button class="btn ghost sm" data-adopt="${i}">Zur Sammlung</button>` : ""}</div>
  </div>`).join("")}</div>`;
}
function renderNew() {
  const f = S.finder;
  let h = `<header>${kicker("Neue Pflanzen")}<h1 class="headline">Eine <em>neue Pflanze</em> anschaffen.</h1><p class="lede">Claude schlägt Pflanzen vor, die zu deinem Standort passen, und erklärt, was nach dem Kauf zu tun ist: eingewöhnen, umtopfen und die richtige Erde.</p></header>`;
  if (!S.sample) return h + `<section class="panel"><p>Für Vorschläge und Anleitungen braucht die App den KI-Zugang. Richte ihn unter «Verlauf» bei «Einstellungen» ein.</p><div class="btn-row"><a class="btn" href="https://feey.ch/collections/bestseller" target="_blank" rel="noopener noreferrer">Beliebte Pflanzen bei feey ↗</a></div></section>`;
  const opt = (arr, v) => arr.map(o => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("");
  h += `<section class="panel">
    <h2>Pflanze finden</h2>
    <div class="two">
      <div class="field"><label for="n-light">Licht am Standort</label><select id="n-light">${opt(LIGHT, f.light)}</select></div>
      <div class="field"><label for="n-effort">Pflegeaufwand</label><select id="n-effort">${opt(["Möglichst wenig", "Normal", "Darf aufwendig sein"], f.effort)}</select></div>
      <div class="field"><label for="n-size">Grösse</label><select id="n-size">${opt(["Klein (Regal, Fensterbank)", "Mittel (Tisch, Kommode)", "Gross (am Boden)"], f.size)}</select></div>
      <div class="field"><label for="n-room">Raum (optional)</label><input id="n-room" list="n-rooms" maxlength="60" value="${esc(f.room)}" autocomplete="off"><datalist id="n-rooms">${roomList().map(r => `<option value="${esc(r)}"></option>`).join("")}</datalist></div>
    </div>
    <div class="field"><label for="n-wish">Wünsche (optional)</label><input id="n-wish" maxlength="160" value="${esc(f.wish)}" placeholder="z. B. hängend, grosse Blätter, blühend" autocomplete="off"></div>
    <label class="inline"><input type="checkbox" id="n-pets"${f.pets ? " checked" : ""}> Ungiftig für Katzen und Hunde</label>
    <button class="btn primary" data-find${f.busy ? " disabled" : ""}>${f.result ? "Neue Vorschläge holen" : "Vorschläge holen"}</button>
    <div id="n-out" aria-live="polite">${finderHtml(f)}</div>
  </section>
  <section class="panel">
    <h2>Schon gekauft?</h2>
    <p class="muted small">Gib den Namen ein. Claude erklärt die ersten Wochen, das Umtopfen und welche Erde passt.</p>
    <div class="field"><label for="n-have">Name der Pflanze</label><input id="n-have" maxlength="60" value="${esc(f.have)}" placeholder="z. B. Calathea orbifolia" autocomplete="off"></div>
    <div class="btn-row"><button class="btn" data-have>Anleitung zeigen</button></div>
  </section>`;
  if (S.plants.length) h += section("Umtopfen und Erde für deine Pflanzen", null, `<div class="pills pills-wrap">${[...S.plants].sort(byName).map(p => `<button class="pill" data-guide="${esc(p.id)}">${esc(nm(p))}</button>`).join("")}</div>`);
  return h;
}
function guidePrompt(x) {
  const se = season();
  return `Du bist erfahrene Gärtnerin. Erkläre für die Zimmerpflanze ${x.name}${x.species ? ` (${x.species})` : ""}${x.isNew ? ", die gerade neu gekauft wurde," : ""} was zu tun ist. Wohnung in der Schweiz, aktueller Monat: ${se.name}.${x.lastRepotted ? ` Zuletzt umgetopft: ${fmtDate(x.lastRepotted)}.` : ""}
Du darfst Produkte vom Schweizer Pflanzenshop feey empfehlen, aber nur aus dieser Liste:
${feeyList()}
Antworte nur mit JSON in dieser Form:
{"firstWeeks": ["Schritte für die ersten 2 bis 4 Wochen nach dem Kauf, höchstens 5"], "location": "idealer Standort, max. 120 Zeichen", "watering": "Giessen in einem Satz", "repotWhen": "wann umtopfen: Jahreszeit, Anzeichen, Abstand in Jahren, max. 160 Zeichen", "potSize": "welcher Topf: Grösse im Vergleich zum alten, Abzugsloch, Material, max. 140 Zeichen", "repotSteps": ["Anleitung zum Umtopfen, 4 bis 7 Schritte"], "soil": "welche Erde oder Mischung, mit Anteilen, max. 180 Zeichen", "soilWhy": "warum diese Erde, max. 120 Zeichen", "mistakes": ["häufige Fehler, höchstens 3"], "products": [{"id": "ID aus der feey-Liste", "why": "wofür, max. 80 Zeichen"}]}
products: höchstens 3. Schreibe Schweizer Hochdeutsch (ss statt ß), konkret und praktisch.`;
}
function normalizeGuide(o) {
  o = o && typeof o === "object" ? o : {};
  const list = (a, n) => (Array.isArray(a) ? a : []).map(x => str(x, 240)).filter(Boolean).slice(0, n);
  return { firstWeeks: list(o.firstWeeks, 5), location: str(o.location, 200), watering: str(o.watering, 200), repotWhen: str(o.repotWhen, 240), potSize: str(o.potSize, 220),
    repotSteps: list(o.repotSteps, 7), soil: str(o.soil, 260), soilWhy: str(o.soilWhy, 200), mistakes: list(o.mistakes, 3), products: normProducts(o.products), at: validYmd(o.at) ? o.at : today() };
}
function guideHtml(g) {
  const li = a => a.map(x => `<li>${esc(x)}</li>`).join("");
  return `<div class="guide">
    ${g.firstWeeks.length || g.location ? `<section class="ai"><h3>Die ersten Wochen</h3>${g.firstWeeks.length ? `<ol>${li(g.firstWeeks)}</ol>` : ""}${g.location ? `<p><strong>Standort:</strong> ${esc(g.location)}</p>` : ""}${g.watering ? `<p><strong>Giessen:</strong> ${esc(g.watering)}</p>` : ""}</section>` : ""}
    <section class="ai"><h3>Umtopfen</h3>${g.repotWhen ? `<p><strong>Wann:</strong> ${esc(g.repotWhen)}</p>` : ""}${g.potSize ? `<p><strong>Topf:</strong> ${esc(g.potSize)}</p>` : ""}${g.repotSteps.length ? `<ol>${li(g.repotSteps)}</ol>` : ""}</section>
    ${g.soil ? `<section class="ai"><h3>Erde</h3><p>${esc(g.soil)}</p>${g.soilWhy ? `<p class="muted small">${esc(g.soilWhy)}</p>` : ""}</section>` : ""}
    ${g.mistakes.length ? `<section class="ai"><h3>Häufige Fehler</h3><ul>${li(g.mistakes)}</ul></section>` : ""}
    ${g.products.length ? `<section class="ai">${productsHtml(g.products)}</section>` : ""}
  </div>`;
}
function sheetGuide(s) {
  const p = s.id ? getP(s.id) : null;
  const name = p ? nm(p) : s.name;
  const g = s.result || (p && p.guide && typeof p.guide === "object" ? normalizeGuide(p.guide) : null);
  let body = "";
  if (s.busy) body = `<p class="status" role="status">Claude stellt die Anleitung zusammen. Das dauert meist 10 bis 30 Sekunden …</p>`;
  else if (s.error) body = `<p class="err">${esc(s.error)}</p><div class="btn-row"><button class="btn" data-act="guide-run">Nochmals versuchen</button></div>`;
  if (g && !s.busy) body += guideHtml(g) + (p ? `<p class="muted small">Erstellt am ${fmtDate(g.at)}.</p>` : "");
  const btns = [];
  if (!p) btns.push(`<a class="btn" href="${feeySearch(name)}" target="_blank" rel="noopener noreferrer">Bei feey suchen ↗</a>`);
  if (!p && S.canWrite && !s.busy) btns.push(`<button class="btn primary" data-act="guide-adopt">Zur Sammlung hinzufügen</button>`);
  if (p && g && !s.busy) btns.push(`<button class="btn" data-act="guide-run">Neu erstellen</button>`);
  if (p) btns.push(`<button class="btn ghost" data-act="back">Zur Pflanze</button>`);
  return { title: `Anleitung: ${name}`, body: body + (btns.length ? `<div class="btn-row">${btns.join("")}</div>` : "") };
}
async function runGuide() {
  const s = S.sheet;
  if (!s || s.mode !== "guide" || !S.sample) return;
  s.busy = true; s.error = ""; renderSheet();
  const p = s.id ? getP(s.id) : null;
  try {
    const x = p ? { name: nm(p), species: str(p.species, 80), lastRepotted: p.lastRepotted } : { name: s.name, species: s.species || "", isNew: true };
    const o = await S.sample.json(guidePrompt(x), { modelTier: "default" });
    if (S.sheet !== s) return;
    s.result = normalizeGuide(o);
    if (p && S.canWrite) writePlant(p.id, () => ({ guide: s.result })).catch(() => {});
  } catch (e) { if (S.sheet !== s) return; s.error = aiErr(e); }
  s.busy = false;
  if (S.sheet === s) renderSheet();
}
function openGuide(data) {
  openSheet("guide", data);
  const p = data.id ? getP(data.id) : null;
  if (!(p && p.guide && typeof p.guide === "object")) runGuide();
}
function planRange() {
  if (!S.plan) S.plan = { from: today(), to: addDays(today(), 6) };
  let { from, to } = S.plan;
  if (!validYmd(from)) from = today();
  if (!validYmd(to) || to < from) to = from;
  if (diffDays(from, to) > 41) to = addDays(from, 41);
  return { from, to };
}
function planDays() {
  const { from, to } = planRange();
  const map = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) map.set(d, []);
  S.plants.forEach(p => occurrences(p, from, to).forEach(d => { if (map.has(d)) map.get(d).push(p); }));
  map.forEach(ps => ps.sort((a, b) => (str(a.room, 60)).localeCompare(str(b.room, 60), "de") || byName(a, b)));
  return map;
}
function planText() {
  const { from, to } = planRange();
  const map = planDays();
  const lines = [`Giessplan ${fmtDate(from)} bis ${fmtDate(to)}`, ""];
  map.forEach((ps, d) => {
    if (!ps.length) return;
    lines.push(`${dateFmt(d, { weekday: "long", day: "numeric", month: "numeric" })}:`);
    ps.forEach(p => lines.push(`• ${nm(p)}${p.room ? ` (${str(p.room, 60)})` : ""}, ${String(p.amount || "Mittel").toLowerCase()}`));
    lines.push("");
  });
  const notes = S.plants.filter(p => p.careNote).sort(byName);
  if (notes.length) { lines.push("Hinweise:"); notes.forEach(p => lines.push(`• ${nm(p)}: ${str(p.careNote, 300)}`)); }
  return lines.join("\n").trim();
}
function renderPlan() {
  const head = kicker("Für die Vertretung");
  let h = `<header>${head}<h1 class="headline">Ferien<em class="ok">plan</em>.</h1><p class="lede">Wähle den Zeitraum. Die Vertretung sieht dann pro Tag, was dran ist. Du kannst den Plan auch als Text kopieren und per Nachricht schicken.</p></header>`;
  if (!S.plants.length) return h + emptyState();
  const { from, to } = planRange();
  const map = planDays();
  const total = [...map.values()].reduce((s, ps) => s + ps.length, 0);
  h += `<div class="panel">
    <div class="two">
      <div class="field"><label for="plan-from">Von</label><input id="plan-from" type="date" value="${from}"></div>
      <div class="field"><label for="plan-to">Bis</label><input id="plan-to" type="date" min="${from}" value="${to}"></div>
    </div>
    <p class="muted small">${plural(total, "Giessgang", "Giessgänge")} in ${plural(diffDays(from, to) + 1, "Tag", "Tagen")}. Höchstens 6 Wochen.</p>
    <button class="btn primary" data-copy-plan>Plan als Text kopieren</button>
    <textarea id="plan-text" class="plan-text" readonly hidden aria-label="Plan als Text"></textarea>
  </div>`;
  let days = "";
  map.forEach((ps, d) => {
    if (!ps.length) return;
    days += `<section class="plan-day"><h2>${esc(dateFmt(d, { weekday: "long", day: "numeric", month: "long" }))}<span class="count">${ps.length}</span></h2><ul class="rows">${ps.map(p => row(p, { chip: `<span class="chip c-water">${esc(p.amount || "Mittel")}</span>`, note: true })).join("")}</ul></section>`;
  });
  return h + (days ? `<div>${days}</div>` : `<section class="calm"><p>In diesem Zeitraum ist nichts zu giessen.</p></section>`);
}
function renderHistory() {
  const head = kicker("Was du gemacht hast");
  const all = [];
  S.plants.forEach(p => logOf(p).forEach(e => all.push({ e, p })));
  all.sort((a, b) => String(b.e.t).localeCompare(String(a.e.t)));
  let h = `<header>${head}<h1 class="headline">Verlauf.</h1></header>`;
  if (!all.length) return h + `<section class="panel"><p>Sobald du giesst, düngst oder einen Check-in machst, erscheint es hier, mit Uhrzeit.</p></section>` + settingsPanel();
  const cut = addDays(today(), -30);
  const recent = all.filter(x => validYmd(x.e.d) && x.e.d >= cut);
  const waters = recent.filter(x => x.e.type === "water");
  const timed = waters.filter(x => typeof x.e.late === "number");
  const onTime = timed.length >= 3 ? Math.round(100 * timed.filter(x => x.e.late <= 1).length / timed.length) + " %" : "–";
  const checks = recent.filter(x => x.e.type === "check" || x.e.type === "doctor").length;
  const people = {};
  waters.forEach(x => { const k = typeof x.e.by === "string" ? x.e.by : "?"; people[k] = (people[k] || 0) + 1; });
  h += `<section class="stats" aria-label="Letzte 30 Tage">
    <div class="stat"><b>${waters.length}</b><span>Mal gegossen</span></div>
    <div class="stat"><b>${onTime}</b><span>pünktlich</span></div>
    <div class="stat"><b>${checks}</b><span>Check-ins</span></div>
  </section>`;
  const ppl = Object.entries(people).sort((a, b) => b[1] - a[1]);
  if (ppl.length > 1) h += `<div class="people">${ppl.map(([id, c]) => `<span class="chip c-water">${esc(id === "?" ? "Unbekannt" : who(id))}: ${c}×</span>`).join("")}</div>`;
  h += `<p class="muted small" style="margin-top:-12px">Letzte 30 Tage. Pünktlich heisst: höchstens einen Tag zu spät.</p>`;
  const byDay = new Map();
  all.slice(0, 80).forEach(x => { const k = validYmd(x.e.d) ? x.e.d : "?"; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); });
  return h + [...byDay].map(([d, xs]) => section(dayLabel(d), xs.length, `<ul class="rows">${xs.map(({ e, p }) => {
    const type = EV[e.type] ? e.type : "x";
    const hl = PHOTO_TYPES.includes(e.type) && e.health ? ` · ${HEALTH[clampInt(e.health, 1, 5, 3)]}` : "";
    const extra = (e.type === "skip" && e.days ? ` · ${plural(clampInt(e.days, 1, 14, 1), "Tag", "Tage")}` : "") + (TREND[e.trend] ? ` · ${TREND[e.trend]}` : "");
    return `<li class="row simple" data-open="${esc(p.id)}" tabindex="0">${tube(p)}${thumb(p)}<div class="row-main"><span class="row-name">${esc(EV[e.type] || "Eintrag")} · ${esc(nm(p))}</span><span class="row-meta">${esc(who(e.by))}, ${esc(timeOf(e.t))}${hl}${extra}</span>${e.note ? `<span class="row-note">${esc(str(e.note, 300))}</span>` : ""}</div><span class="dot ${type}" aria-hidden="true"></span></li>`;
  }).join("")}</ul>`)).join("") + settingsPanel();
}

/* ---------- settings: Haushalt, KI-Schlüssel, Konto, Sicherung, Installation ---------- */
function settingsPanel() {
  const me = window.PP.me;
  if (!me) return "";
  const hh = me.household, A = S.acct, busy = k => A.busy === k ? " disabled" : "";
  const solo = hh.members.length <= 1;
  const ai = hh.ai;
  const inviteUrl = A.invite ? `${location.origin}/#einladung=${A.invite.code}` : "";
  const legacyN = window.PP.legacy.done ? 0 : window.PP.legacy.count;

  const hhBody = `<div><h3>Haushalt</h3>
    ${A.nameEdit ? `<div class="field"><label for="hh-name">Name des Haushalts</label><input id="hh-name" data-keepval maxlength="60" value="${esc(hh.name)}"></div>
      <div class="btn-row"><button class="btn primary sm" data-acct="hh-name-save"${busy("hh-name-save")}>Speichern</button><button class="btn ghost sm" data-acct="hh-name-cancel">Abbrechen</button></div>`
    : `<p class="hh-name"><b>${esc(hh.name)}</b> <button class="btn ghost sm" data-acct="hh-name-edit">Umbenennen</button></p>`}
    <ul class="members">${hh.members.map(m => `<li><span class="avatar" aria-hidden="true">${esc((m.name || "?").slice(0, 1).toUpperCase())}</span>${esc(m.name)}${m.me ? ` <span class="muted small">du</span>` : ""}</li>`).join("")}</ul>
    <p class="muted">${solo ? "Lade die Person ein, mit der du die Pflanzen teilst. Ihr seht und pflegt dann dieselben Pflanzen, jede Person mit ihrem eigenen Konto und Gerät." : "Alle hier sehen und pflegen dieselben Pflanzen. Im Verlauf steht, wer was gemacht hat."}</p>
    ${A.invite ? `<div class="invite"><p>Einladungscode <b class="code">${esc(A.invite.code)}</b>, gültig ${A.invite.days} Tage.</p>
        <input id="inv-url" readonly value="${esc(inviteUrl)}" aria-label="Einladungslink">
        <div class="btn-row"><button class="btn primary sm" data-acct="inv-share">Link teilen</button><button class="btn sm" data-acct="inv-copy">Link kopieren</button></div></div>`
      : `<div class="btn-row"><button class="btn" data-acct="invite"${busy("invite")}>Person einladen</button></div>`}
    <details class="more"><summary>Einem anderen Haushalt beitreten</summary>
      <p class="muted small">${solo ? "Deine Pflanzen nimmst du mit in den neuen Haushalt." : "Deine Pflanzen bleiben bei den anderen in diesem Haushalt."}</p>
      <div class="field"><label for="join-code">Einladungscode</label><input id="join-code" data-keepval autocapitalize="characters" spellcheck="false" maxlength="12"></div>
      <div class="btn-row"><button class="btn sm" data-acct="join"${busy("join")}>Beitreten</button></div>
    </details>
    ${solo ? "" : `<div class="btn-row"><button class="btn danger sm" data-acct="leave"${busy("leave")}>${A.leave ? "Ja, Haushalt verlassen" : "Haushalt verlassen"}</button></div>${A.leave ? `<p class="muted small">Du startest dann mit einem leeren Haushalt. Die Pflanzen bleiben hier bei den anderen.</p>` : ""}`}
  </div>`;

  const keyForm = `<div class="field"><label for="key-in">Anthropic-API-Schlüssel</label><input id="key-in" data-keepval type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…"></div>
    <div class="btn-row"><button class="btn primary sm" data-acct="key-save"${busy("key-save")}>${A.busy === "key-save" ? "Wird geprüft …" : "Speichern"}</button>${ai ? `<button class="btn ghost sm" data-acct="key-cancel">Abbrechen</button>` : ""}</div>`;
  const aiBody = `<div><h3>KI-Zugang</h3>
    ${ai && !A.keyEdit ? `<p><span class="chip c-ok">Verbunden</span> Schlüssel <code>${esc(ai.hint)}</code>${ai.by ? `, hinterlegt von ${esc(ai.by)}` : ""}.</p>
      <p class="muted">Skizzen, Pflanzendoktor, Foto-Erkennung und Pflanzenfinder laufen über dieses Anthropic-Konto. Die Kosten gehen dorthin, für alle im Haushalt.</p>
      <div class="btn-row"><button class="btn sm" data-acct="key-edit">Schlüssel ersetzen</button><button class="btn danger sm" data-acct="key-remove"${busy("key-remove")}>Entfernen</button></div>`
    : `<p class="muted">Jeder Haushalt bezahlt seine KI-Anfragen selbst. Erstelle auf <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> einen API-Schlüssel, lade etwas Guthaben auf und trag den Schlüssel hier ein. Er wird verschlüsselt gespeichert und ist danach für niemanden mehr lesbar, auch nicht für dich.</p>${keyForm}`}
  </div>`;

  const acctBody = `<div><h3>Konto</h3>
    <p>Angemeldet als <b>${esc(me.user.name)}</b> <span class="muted">(${esc(me.user.login)})</span></p>
    ${A.pwEdit ? `<div class="field"><label for="pw-old">Bisheriges Passwort</label><input id="pw-old" data-keepval type="password" autocomplete="current-password"></div>
      <div class="field"><label for="pw-new">Neues Passwort</label><input id="pw-new" data-keepval type="password" autocomplete="new-password" minlength="8"></div>
      <div class="btn-row"><button class="btn primary sm" data-acct="pw-save"${busy("pw-save")}>Passwort ändern</button><button class="btn ghost sm" data-acct="pw-cancel">Abbrechen</button></div>`
    : `<div class="btn-row"><button class="btn sm" data-acct="pw-edit">Passwort ändern</button><button class="btn sm" data-acct="logout">Abmelden</button></div>`}
  </div>`;

  const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  return `<section class="panel" id="settings"><h2>Einstellungen</h2>
    ${A.err ? `<p class="err" role="alert">${esc(A.err)}</p>` : ""}
    ${hhBody}
    ${aiBody}
    ${acctBody}
    <div><h3>Daten sichern</h3><p class="muted">Die Pflanzen sind auf dem Server gespeichert und auf allen Geräten im Haushalt gleich. Eine Sicherung als Datei schadet trotzdem nicht. Beim Einlesen bleiben Pflanzen, die es schon gibt, unverändert.</p>
      <div class="btn-row" style="margin-top:10px"><button class="btn" data-export>Sicherung herunterladen</button><input id="imp-file" class="vh" type="file" accept="application/json,.json"><label class="btn" for="imp-file">Sicherung einlesen</label>${legacyN ? `<button class="btn" data-acct="legacy"${busy("legacy")}>${legacyN === 1 ? "1 Pflanze" : legacyN + " Pflanzen"} aus diesem Browser übernehmen</button>` : ""}</div></div>
    ${standalone ? "" : `<div><h3>Auf den Homescreen</h3><p class="muted">iPhone: In Safari auf «Teilen» tippen, dann «Zum Home-Bildschirm». Android: Im Chrome-Menü «App installieren» wählen.</p></div>`}
  </section>`;
}
async function acctAction(act, btn) {
  const A = S.acct, P = window.PP, acc = P.account;
  const val = id => { const el = $("#" + id); return el ? el.value.trim() : ""; };
  const run = async (fn, okMsg) => {
    A.busy = act; A.err = ""; render();
    try { const r = await fn(); A.busy = ""; if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg); render(); return r; }
    catch (e) { A.busy = ""; A.err = keyErr(e) || P.errText(e); render(); return undefined; }
  };
  if (act !== "leave") A.leave = false;
  switch (act) {
    case "hh-name-edit": A.nameEdit = true; render(); { const el = $("#hh-name"); if (el) el.focus(); } return;
    case "hh-name-cancel": A.nameEdit = false; render(); return;
    case "hh-name-save": { const v = val("hh-name"); if (!v) return; A.nameEdit = false; return run(() => acc.renameHousehold(v), "Haushalt umbenannt"); }
    case "invite": { const r = await run(() => acc.invite()); if (r) { A.invite = r; render(); } return; }
    case "inv-copy": {
      const el = $("#inv-url");
      try { await navigator.clipboard.writeText(el.value); toast("Link kopiert"); } catch { el.select(); toast("Link markiert. Jetzt kopieren."); }
      return;
    }
    case "inv-share": {
      const url = $("#inv-url").value;
      const text = `Komm in unseren Pflanzen-Haushalt «${P.me.household.name}». Öffne den Link und erstelle ein Konto (Code ${A.invite.code}):`;
      if (navigator.share) { try { await navigator.share({ title: "Pflanzenpflege", text, url }); } catch { /* abgebrochen */ } }
      else { try { await navigator.clipboard.writeText(text + " " + url); toast("Einladung kopiert"); } catch { toast("Teilen geht hier nicht. Kopiere den Link."); } }
      return;
    }
    case "join": {
      const code = val("join-code");
      if (!code) { const el = $("#join-code"); if (el) el.focus(); return; }
      const r = await run(() => acc.join(code));
      if (r) { toast(`Du bist jetzt im Haushalt «${r.household.name}»`); setTimeout(() => location.reload(), 900); }
      return;
    }
    case "leave": {
      if (!A.leave) { A.leave = true; render(); return; }
      A.leave = false;
      const r = await run(() => acc.leave());
      if (r) location.reload();
      return;
    }
    case "key-edit": A.keyEdit = true; render(); { const el = $("#key-in"); if (el) el.focus(); } return;
    case "key-cancel": A.keyEdit = false; render(); return;
    case "key-save": {
      const k = val("key-in");
      if (!k) { const el = $("#key-in"); if (el) el.focus(); return; }
      const ok = await run(() => acc.setKey(k).then(() => true));
      if (ok) { A.keyEdit = false; toast("KI-Zugang eingerichtet"); setTimeout(() => location.reload(), 700); }
      return;
    }
    case "key-remove": {
      const ok = await run(() => acc.removeKey().then(() => true));
      if (ok) { toast("Schlüssel entfernt"); setTimeout(() => location.reload(), 700); }
      return;
    }
    case "pw-edit": A.pwEdit = true; render(); { const el = $("#pw-old"); if (el) el.focus(); } return;
    case "pw-cancel": A.pwEdit = false; render(); return;
    case "pw-save": {
      const o = ($("#pw-old") || {}).value || "", n = ($("#pw-new") || {}).value || "";
      if (n.length < 8) { A.err = "Das neue Passwort braucht mindestens 8 Zeichen."; render(); return; }
      const ok = await run(() => acc.password(o, n).then(() => true), "Passwort geändert");
      if (ok) { A.pwEdit = false; render(); }
      return;
    }
    case "logout": btn.disabled = true; return acc.logout();
    case "legacy":
      return run(() => P.migrateLegacy(), r => r.skipped ? `${plural(r.added, "Pflanze", "Pflanzen")} übernommen, ${r.skipped} waren schon da` : `${plural(r.added, "Pflanze", "Pflanzen")} übernommen`);
  }
}
function keyErr(e) {
  const c = e && e.code;
  if (c === "key_invalid") return "Das sieht nicht wie ein Anthropic-Schlüssel aus. Er beginnt mit «sk-ant-».";
  if (c === "key_rejected") return "Anthropic kennt diesen Schlüssel nicht. Prüfe, ob du ihn vollständig kopiert hast.";
  if (c === "wrong_login") return "Das bisherige Passwort stimmt nicht.";
  if (c === "last_member") return "Du bist allein in diesem Haushalt.";
  return "";
}
async function doExport(btn) {
  btn.disabled = true;
  try {
    const data = await window.PP.exportData();
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pflanzenpflege-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Sicherung heruntergeladen");
  } catch { toast("Die Sicherung hat nicht geklappt."); }
  btn.disabled = false;
}
async function doImport(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { toast("Diese Datei ist keine gültige Sicherung."); return; }
  try {
    toast("Sicherung wird eingelesen …");
    const n = await window.PP.importData(obj);
    toast(`${plural(n, "Pflanze", "Pflanzen")} eingelesen`);
  } catch (e) { toast(e && e.code === "bad_file" ? "Diese Datei ist keine gültige Sicherung." : writeMsg(e)); }
}
function render() {
  const v = view();
  document.querySelectorAll("nav.bottom a").forEach(a => {
    if (a.getAttribute("href") === "#" + v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const ae = document.activeElement;
  const fid = ae && app.contains(ae) && ae.id ? ae.id : null;
  let sel = null;
  try { if (fid && typeof ae.selectionStart === "number") sel = [ae.selectionStart, ae.selectionEnd]; } catch { sel = null; }
  let h = banner();
  if (!S.loaded) h += `<p class="muted">Pflanzen werden geladen …</p>`;
  else if (!S.dbMissing) h += ({ heute: renderToday, pflanzen: renderPlants, neu: renderNew, plan: renderPlan, verlauf: renderHistory })[v]();
  const keep = {};
  app.querySelectorAll("[data-keep]").forEach(el => { keep[el.dataset.keep] = el.scrollLeft; });
  const vals = {};
  app.querySelectorAll("input[data-keepval]").forEach(el => { vals[el.id] = el.value; });
  app.innerHTML = h;
  app.querySelectorAll("input[data-keepval]").forEach(el => { if (vals[el.id]) el.value = vals[el.id]; });
  app.querySelectorAll("[data-keep]").forEach(el => { if (keep[el.dataset.keep] != null) el.scrollLeft = keep[el.dataset.keep]; });
  if (fid) {
    const el = document.getElementById(fid);
    if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } } }
  }
  if (S.sheet && S.sheet.mode === "detail") renderSheet();
  fillMeters();
  needNames();
}
function needNames() {
  if (!S.user || typeof S.user.profiles !== "function") return;
  const ids = new Set();
  S.plants.forEach(p => logOf(p).forEach(e => { if (typeof e.by === "string" && e.by !== S.uid && !(e.by in S.names)) ids.add(e.by); }));
  if (!ids.size) return;
  const list = [...ids];
  list.forEach(id => { S.names[id] = ""; });
  Promise.resolve(S.user.profiles(list)).then(ps => {
    list.forEach(id => { S.names[id] = (ps && ps[id] && ps[id].name) || ""; });
    render();
  }).catch(() => {});
}

/* ---------- sheet ---------- */
const sheetEl = $("#sheet"), panel = $("#sheet-panel");
function openSheet(mode, data) {
  if (S.sheet && S.sheet.ctl) S.sheet.ctl.abort();
  const wasOpen = !!S.sheet;
  S.sheet = Object.assign({ mode }, data || {});
  sheetEl.hidden = false;
  if (wasOpen) panel.style.animation = "none"; else panel.style.animation = "";
  document.body.classList.add("locked");
  document.documentElement.classList.add("locked");
  renderSheet();
  panel.scrollTop = 0;
  panel.focus({ preventScroll: true });
}
function closeSheet() {
  if (S.sheet && S.sheet.ctl) S.sheet.ctl.abort();
  S.sheet = null;
  sheetEl.hidden = true;
  document.body.classList.remove("locked");
  document.documentElement.classList.remove("locked");
}
function renderSheet() {
  const s = S.sheet;
  if (!s) return;
  const fn = { add: sheetAdd, detail: sheetDetail, form: sheetForm, bulk: sheetBulk, doctor: sheetDoctor, checkin: sheetCheckin, snooze: sheetSnooze, scan: sheetScan, photocheck: sheetPhotoCheck, guide: sheetGuide }[s.mode];
  const r = fn(s);
  const top = panel.scrollTop;
  panel.innerHTML = `<div class="sheet-head"><h2 id="sheet-title">${esc(r.title)}</h2><button class="icon-btn" data-close aria-label="Schliessen">✕</button></div><div class="sheet-body">${r.body}</div>`;
  if (s.mode === "detail") panel.scrollTop = top;
  if (r.bind) r.bind();
  fillMeters();
}
function fact(label, value) { return `<div class="fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`; }
function spark(hs) {
  const w = 280, h = 64, px = 8, py = 8, n = hs.length;
  const x = i => px + (n === 1 ? 0 : i * (w - 2 * px) / (n - 1));
  const y = v => py + (5 - v) * (h - 2 * py) / 4;
  const hv = e => clampInt(e.health, 1, 5, 3);
  const pts = hs.map((e, i) => `${x(i).toFixed(1)},${y(hv(e)).toFixed(1)}`).join(" ");
  const grid = [1, 3, 5].map(v => `<line x1="0" x2="${w}" y1="${y(v)}" y2="${y(v)}" class="sp-grid" vector-effect="non-scaling-stroke"/>`).join("");
  const last = hs[n - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Gesundheit der letzten ${n} Check-ins">${grid}<polyline points="${pts}" class="sp-line" vector-effect="non-scaling-stroke"/><circle cx="${x(n - 1)}" cy="${y(hv(last))}" r="4.5" class="sp-dot"/></svg>
    <p class="muted small">Skala 1 kritisch bis 5 prächtig · zuletzt ${fmtDate(last.d)}: ${HEALTH[hv(last)]}</p>`;
}
function logItem(e) {
  const type = EV[e.type] ? e.type : "x";
  const hl = PHOTO_TYPES.includes(e.type) && e.health ? ` · ${HEALTH[clampInt(e.health, 1, 5, 3)]}` : "";
  const extra = (e.type === "skip" && e.days ? ` um ${plural(clampInt(e.days, 1, 14, 1), "Tag", "Tage")}` : "") + (TREND[e.trend] ? ` · ${TREND[e.trend]}` : "");
  return `<li><span class="dot ${type}" aria-hidden="true"></span><div><strong>${esc(EV[e.type] || "Eintrag")}${extra}${hl}</strong> <span class="muted small">${fmtDate(e.d)}, ${esc(who(e.by))}</span>${e.note ? `<p class="small">${esc(str(e.note, 500))}</p>` : ""}</div></li>`;
}
function sheetDetail(s) {
  const p = getP(s.id);
  if (!p) return { title: "Pflanze", body: `<p class="muted">Wird geladen …</p>` };
  const d = dueIn(p), log = logOf(p), W = S.canWrite, m = moisture(p);
  const hs = log.filter(e => PHOTO_TYPES.includes(e.type) && e.health).slice(0, 12).reverse();
  const fd = clampInt(p.fertilizeDays, 0, 365, 0);
  const photos = [];
  const seen = new Set();
  log.forEach(e => {
    const ids = [e.photoId].concat(Array.isArray(e.photoIds) ? e.photoIds : []);
    ids.forEach(pid => { if (typeof pid === "string" && !seen.has(pid)) { seen.add(pid); photos.push({ id: pid, d: e.d }); } });
  });
  const hint = W ? snoozeHint(p) : null;
  const acts = [];
  if (W) acts.push(`<button class="btn water" data-act="water">Gegossen</button>`, `<button class="btn" data-act="snooze">Erde noch feucht</button>`, `<button class="btn" data-act="checkin">Check-in</button>`);
  if (canPhotoCheck()) acts.push(`<button class="btn" data-act="photocheck">Foto-Check</button>`);
  if (S.sample) acts.push(`<button class="btn" data-act="doctor">Pflanzendoktor</button>`, `<button class="btn" data-act="guide">Umtopfen &amp; Erde</button>`);
  if (W) acts.push(`<button class="btn" data-act="fert">Gedüngt</button>`, `<button class="btn" data-act="repot">Umgetopft</button>`);
  const meterText = !validYmd(p.lastWatered) ? "Noch nie gegossen erfasst" : d <= 0 ? "Substrat trocken: giessen" : `Noch etwa ${plural(d, "Tag", "Tage")} feucht`;
  const body = `
    ${p.photoId ? `<img class="hero" src="${esc(photoUrl(p.photoId))}" alt="Foto von ${esc(nm(p))}">` : ""}
    <div>
      ${p.species ? `<p class="sp" style="font-size:1.375rem;margin:0">${esc(str(p.species, 80))}</p>` : ""}
      <p class="muted">${esc(str(p.room, 60) || "Kein Raum erfasst")}</p>
      <div class="chips">${dueChip(d)}${healthChip(p.health)}${validYmd(p.snoozeUntil) && p.snoozeUntil > today() ? `<span class="chip c-dry">verschoben bis ${fmtDate(p.snoozeUntil)}</span>` : ""}</div>
    </div>
    <div class="meter">
      <div class="meter-row"><strong>${esc(meterText)}</strong><span class="muted">${Math.round(m * 100)} %</span></div>
      <div class="meter-bar" data-m="${m.toFixed(3)}" data-id="${esc(p.id)}" role="img" aria-label="Substratfeuchte ${Math.round(m * 100)} Prozent"><i style="width:${((S.prevM[p.id] ?? 0) * 100).toFixed(1)}%"></i></div>
    </div>
    ${p.careNote ? `<p class="note"><strong>Hinweis:</strong> ${esc(str(p.careNote, 300))}</p>` : ""}
    ${hint ? `<div class="hint"><p><strong>Die Erde war ${hint.skips}× noch feucht.</strong> Giess lieber alle ${hint.suggest} statt alle ${interval(p)} Tage.</p><div class="btn-row"><button class="btn primary sm" data-act="hint-accept" data-days="${hint.suggest}">Auf ${hint.suggest} Tage ändern</button><button class="btn ghost sm" data-act="hint-dismiss">Passt so</button></div></div>` : ""}
    ${acts.length ? `<div class="actions">${acts.join("")}</div>` : ""}
    <dl class="facts">
      ${fact("Giessen", `alle ${interval(p)} Tage`)}
      ${fact("Menge", p.amount || "–")}
      ${fact("Zuletzt gegossen", validYmd(p.lastWatered) ? `${fmtDate(p.lastWatered)}, ${ago(p.lastWatered)}` : "noch nie")}
      ${fact("Nächstes Mal", d <= 0 ? "jetzt" : `${fmtDate(nextWater(p))}, ${dueText(d)}`)}
      ${fact("Lichtbedarf", p.light || "–")}
      ${canPhotoCheck() && photoDueIn(p) !== null ? fact("Foto-Check", photoDueIn(p) <= 0 ? "fällig" : dueText(photoDueIn(p))) : ""}
      ${fact("Düngen", fd ? `alle ${fd} Tage${validYmd(p.lastFertilized) ? `, zuletzt ${fmtDate(p.lastFertilized)}` : ""}` : "pausiert")}
    </dl>
    ${hs.length >= 2 ? `<section><h3>Gesundheit</h3>${spark(hs)}</section>` : ""}
    ${photos.length ? `<section><h3>Fotoverlauf</h3><div class="gallery hscroll">${photos.slice(0, 12).map(x => `<figure><img src="${esc(photoUrl(x.id))}" alt="Foto vom ${fmtDate(x.d)}" loading="lazy"><figcaption>${fmtDate(x.d)}</figcaption></figure>`).join("")}</div></section>` : ""}
    <section><h3>Verlauf</h3>${log.length ? `<ul class="log">${log.slice(0, 15).map(logItem).join("")}</ul>` : `<p class="muted">Noch keine Einträge.</p>`}</section>
    ${W ? `<div class="btn-row"><button class="btn" data-act="edit">Bearbeiten</button>${S.sample ? `<button class="btn" data-act="resketch"${sketchJobs.has(p.id) ? " disabled" : ""}>${sketchJobs.has(p.id) ? "Skizze wird gezeichnet …" : (cleanSketch(p.sketch) ? "Skizze neu zeichnen" : "Skizze zeichnen")}</button>` : ""}<button class="btn danger" data-act="delete">${s.confirmDel ? "Ja, endgültig löschen" : "Löschen"}</button></div>` : ""}`;
  return { title: nm(p), body };
}
function sheetSnooze(s) {
  const p = getP(s.id) || {};
  return {
    title: "Erde noch feucht?",
    body: `<p class="muted">Dann warte mit ${esc(nm(p))}. Steck einen Finger 2 bis 3 cm tief in die Erde: Fühlt sie sich kühl und feucht an, braucht die Pflanze noch kein Wasser.</p>
      <div class="actions">
        <button class="btn primary" data-act="snooze-n" data-days="1">Morgen nochmals prüfen</button>
        <button class="btn" data-act="snooze-n" data-days="2">In 2 Tagen</button>
        <button class="btn" data-act="snooze-n" data-days="3">In 3 Tagen</button>
      </div>
      <p class="muted small">Wenn du öfter verschiebst, schlägt die App ein längeres Giessintervall vor.</p>`
  };
}
function sheetForm(s) {
  const p = (s.id && getP(s.id)) || s.prefill || {};
  const rooms = [...new Set(S.plants.map(x => str(x.room, 60)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const opt = (arr, v) => arr.map(o => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("");
  const last = validYmd(p.lastWatered) ? p.lastWatered : (s.id ? "" : today());
  return {
    title: s.id ? `${nm(p)} bearbeiten` : "Neue Pflanze",
    body: `<form class="form" id="pform" novalidate>
      <div class="field"><label for="f-name">Name</label><input id="f-name" maxlength="60" value="${esc(p.name)}" placeholder="z. B. Monstera" autocomplete="off"></div>
      <div class="two">
        <div class="field"><label for="f-species">Art</label><input id="f-species" maxlength="80" value="${esc(p.species)}" placeholder="z. B. Monstera deliciosa" autocomplete="off"></div>
        <div class="field"><label for="f-room">Raum</label><input id="f-room" list="f-rooms" maxlength="60" value="${esc(p.room)}" placeholder="z. B. Wohnzimmer" autocomplete="off"><datalist id="f-rooms">${rooms.map(r => `<option value="${esc(r)}"></option>`).join("")}</datalist></div>
      </div>
      ${S.sample ? `<div class="suggest"><button type="button" class="btn" data-act="suggest">Pflege von Claude vorschlagen lassen</button><span id="sug-status" class="muted small" role="status"></span></div>` : ""}
      <div class="two">
        <div class="field"><label for="f-interval">Giessen alle … Tage</label><input id="f-interval" type="number" inputmode="numeric" min="1" max="90" value="${esc(p.intervalDays ?? 7)}"></div>
        <div class="field"><label for="f-amount">Menge</label><select id="f-amount">${opt(AMOUNT, p.amount || "Mittel")}</select></div>
        <div class="field"><label for="f-light">Lichtbedarf</label><select id="f-light">${opt(LIGHT, p.light || "Hell, indirekt")}</select></div>
        <div class="field"><label for="f-fert">Düngen alle … Tage (0 = pausiert)</label><input id="f-fert" type="number" inputmode="numeric" min="0" max="365" value="${esc(p.fertilizeDays ?? 0)}"></div>
      </div>
      <div class="field"><label for="f-last">Zuletzt gegossen</label><input id="f-last" type="date" max="${today()}" value="${esc(last)}"></div>
      <div class="field"><label for="f-note">Hinweis für die Vertretung</label><textarea id="f-note" maxlength="300" placeholder="z. B. Nur von unten giessen, Untersetzer nach 15 Minuten leeren.">${esc(p.careNote)}</textarea></div>
      ${S.assets ? `<div class="field"><label for="f-photo">${p.photoId ? "Foto ersetzen" : "Foto"}</label><input id="f-photo" type="file" accept="image/*"></div>` : ""}
      <p id="f-err" class="err" role="alert"></p>
      <div class="btn-row"><button class="btn primary" type="submit" id="f-save">Speichern</button>${s.id ? `<button class="btn" type="button" data-act="back">Abbrechen</button>` : `<button class="btn" type="button" data-close>Abbrechen</button>`}</div>
    </form>`,
    bind: () => $("#pform").addEventListener("submit", saveForm)
  };
}
async function saveForm(e) {
  e.preventDefault();
  const s = S.sheet, btn = $("#f-save"), err = $("#f-err");
  const name = str($("#f-name").value, 60);
  if (!name) { err.textContent = "Bitte gib der Pflanze einen Namen."; $("#f-name").focus(); return; }
  const data = {
    name, species: str($("#f-species").value, 80), room: str($("#f-room").value, 60),
    intervalDays: clampInt($("#f-interval").value, 1, 90, 7),
    amount: AMOUNT.includes($("#f-amount").value) ? $("#f-amount").value : "Mittel",
    light: LIGHT.includes($("#f-light").value) ? $("#f-light").value : "Hell, indirekt",
    fertilizeDays: clampInt($("#f-fert").value, 0, 365, 0),
    careNote: str($("#f-note").value, 300)
  };
  const last = $("#f-last").value;
  btn.disabled = true; btn.textContent = "Speichere …"; err.textContent = "";
  try {
    const file = $("#f-photo") && $("#f-photo").files[0];
    if (file) { btn.textContent = "Lade Foto hoch …"; data.photoId = await uploadPhoto(file); }
    if (s.id) {
      const cur = getP(s.id);
      data.lastWatered = validYmd(last) ? last : { __delete__: true };
      if (cur && interval(cur) !== data.intervalDays) data.intervalSetAt = new Date().toISOString();
      if (cur && cur.lastWatered !== last) data.snoozeUntil = { __delete__: true };
      await writePlant(s.id, () => data);
      if (S.sheet === s) openSheet("detail", { id: s.id });
      toast("Gespeichert");
    } else {
      if (validYmd(last)) data.lastWatered = last;
      const id = await createPlant(data);
      if (S.sheet === s) openSheet("detail", { id });
      toast(`${name} hinzugefügt`);
    }
  } catch (ex) {
    if (ex && ex.code === "invalid_argument") { S.canWrite = false; render(); }
    if (S.sheet !== s) return;
    btn.disabled = false; btn.textContent = "Speichern";
    err.textContent = ex && ex.code ? writeMsg(ex) : "Das Foto konnte nicht hochgeladen werden. Versuch es ohne Foto oder mit einem anderen.";
  }
}
async function formSuggest() {
  const s = S.sheet, st = $("#sug-status");
  const name = str($("#f-name").value, 60), species = str($("#f-species").value, 80);
  if (!name && !species) { st.textContent = "Gib zuerst Name oder Art ein."; return; }
  st.textContent = "Claude überlegt …";
  try {
    const o = await S.sample.json(profilePrompt([{ name: name || species, species, room: str($("#f-room").value, 60) }]), { modelTier: "quick" });
    if (S.sheet !== s) return;
    const r = normalizeProfile(Array.isArray(o) ? o[0] : o, { name, species });
    if (!species && r.species) $("#f-species").value = r.species;
    $("#f-interval").value = r.intervalDays;
    $("#f-amount").value = r.amount;
    $("#f-light").value = r.light;
    $("#f-fert").value = r.fertilizeDays;
    if (!$("#f-note").value.trim() && r.careNote) $("#f-note").value = r.careNote;
    st.textContent = `Vorschlag eingesetzt: alle ${r.intervalDays} Tage, Menge ${r.amount.toLowerCase()}. Du kannst alles anpassen.`;
  } catch (e) { if (S.sheet === s) st.textContent = aiErr(e); }
}

function sheetBulk(s) {
  return {
    title: "Mehrere erfassen",
    body: `<div class="form">
      <div class="field"><label for="b-text">Eine Pflanze pro Zeile, optional mit Raum nach einem Komma</label>
        <textarea id="b-text" rows="8" placeholder="Monstera, Wohnzimmer&#10;Geigenfeige, Wohnzimmer&#10;Bogenhanf, Schlafzimmer&#10;Basilikum, Küche">${esc(s.text || "")}</textarea></div>
      <div class="field"><label for="b-last">Wann hast du sie zuletzt gegossen?</label>
        <select id="b-last"><option value="today">Heute: erste Erinnerung nach dem Intervall</option><option value="due">Weiss nicht: heute alle prüfen</option></select></div>
      <button class="btn primary" type="button" data-act="bulk-suggest" id="b-go">${S.sample ? "Pflege vorschlagen lassen" : "Vorschau"}</button>
      <div id="b-out" aria-live="polite"></div>
    </div>`
  };
}
function parseLine(l) {
  const i = l.indexOf(",");
  return { name: str(i < 0 ? l : l.slice(0, i), 60), room: i < 0 ? "" : str(l.slice(i + 1), 60) };
}
function bulkPreview(items) {
  return `<p class="muted small">Prüfe die Vorschläge. Alles lässt sich später pro Pflanze anpassen.</p>
    <ul class="rows">${items.map((x, i) => `<li class="row check"><input type="checkbox" id="b-${i}" checked><div class="row-main"><label for="b-${i}" class="row-name">${esc(x.name)}</label>${x.species ? `<span class="sp">${esc(x.species)}</span>` : ""}<span class="row-meta">${esc([x.room, `alle ${x.intervalDays} Tage`, x.amount, x.light].filter(Boolean).join(" · "))}${x.fertilizeDays ? ` · düngen alle ${x.fertilizeDays} Tage` : ""}</span>${x.careNote ? `<span class="row-note">${esc(x.careNote)}</span>` : ""}</div></li>`).join("")}</ul>
    <button class="btn primary block" type="button" data-act="bulk-create" id="b-create" style="margin-top:12px">${plural(items.length, "Pflanze", "Pflanzen")} anlegen</button>`;
}
async function bulkSuggest() {
  const s = S.sheet, out = $("#b-out"), go = $("#b-go");
  s.text = $("#b-text").value;
  const lines = s.text.split("\n").map(l => l.trim()).filter(Boolean).map(parseLine).filter(x => x.name).slice(0, 40);
  if (!lines.length) { out.innerHTML = `<p class="err">Schreib mindestens eine Pflanze ins Feld.</p>`; return; }
  if (!S.sample) { s.items = lines.map(x => normalizeProfile({}, x)); out.innerHTML = bulkPreview(s.items); return; }
  go.disabled = true;
  out.innerHTML = `<p class="status">Claude stellt ${lines.length} Pflegeprofile zusammen …</p>`;
  try {
    const arr = await S.sample.json(profilePrompt(lines), { modelTier: "quick" });
    if (S.sheet !== s) return;
    const a = Array.isArray(arr) ? arr : [];
    s.items = lines.map((x, i) => normalizeProfile(a[i], x));
    out.innerHTML = bulkPreview(s.items);
  } catch (e) {
    if (S.sheet === s) out.innerHTML = `<p class="err">${esc(aiErr(e))}</p>`;
  } finally { if (S.sheet === s) go.disabled = false; }
}
async function bulkCreate() {
  const s = S.sheet, btn = $("#b-create");
  if (!s.items) return;
  const chosen = s.items.filter((_, i) => $("#b-" + i) && $("#b-" + i).checked);
  if (!chosen.length) return;
  const mode = $("#b-last").value;
  btn.disabled = true;
  let n = 0;
  try {
    for (const x of chosen) {
      btn.textContent = `Lege an … ${n + 1} von ${chosen.length}`;
      const data = Object.assign({}, x);
      if (mode === "today") data.lastWatered = today();
      await createPlant(data);
      n++;
    }
    closeSheet();
    location.hash = mode === "due" ? "#heute" : "#pflanzen";
    toast(`${plural(n, "Pflanze", "Pflanzen")} angelegt`);
  } catch (e) {
    if (e && e.code === "invalid_argument") { S.canWrite = false; render(); }
    if (S.sheet !== s) return;
    s.items = chosen.slice(n);
    $("#b-out").innerHTML = `<p class="err">${n} von ${chosen.length} angelegt. ${esc(writeMsg(e))}</p>` + bulkPreview(s.items);
  }
}

function sheetDoctor(s) {
  const p = getP(s.id) || {};
  const img = !!S.imgLimits;
  return {
    title: "Pflanzendoktor",
    body: `<div class="form">
      <p class="muted">${img ? `Fotografiere ${esc(nm(p))} ganz und nah beim Problem, etwa Blätter oder Erde. ` : ""}Beschreib kurz, was dir auffällt. Claude bezieht Giessverlauf, Standort und Jahreszeit mit ein.</p>
      ${img ? `<div class="field"><span class="flabel" id="d-count">${docCountText(s)}</span>
        <div class="thumbs" id="d-thumbs">${docThumbs(s)}</div>
        <div class="btn-row" id="d-add"${(s.photos || []).length >= docMax() ? " hidden" : ""}>
          <input id="d-cam" class="vh" type="file" accept="image/*" capture="environment"><label class="btn primary" for="d-cam">${CAM_ICON}Foto aufnehmen</label>
          <input id="d-lib" class="vh" type="file" accept="image/*" multiple><label class="btn" for="d-lib">Aus Fotos wählen</label>
        </div></div>` : ""}
      <div class="field"><label for="d-text">Was fällt dir auf?</label><textarea id="d-text" rows="3" placeholder="z. B. Untere Blätter werden gelb, Erde riecht muffig."></textarea></div>
      <div class="btn-row"><button class="btn primary" type="button" data-act="doc-run" id="d-go">Diagnose starten</button><button class="btn" type="button" data-act="doc-stop" id="d-stop" hidden>Stopp</button><button class="btn ghost" type="button" data-act="back">Zurück</button></div>
      <div id="d-out" aria-live="polite"></div>
    </div>`
  };
}
function docMax() { return Math.max(1, Math.min(4, (S.imgLimits && S.imgLimits.maxCount) || 1)); }
function docCountText(s) {
  const n = (s.photos || []).length, max = docMax();
  return n ? `Fotos: ${n} von ${max}${n < max ? ". Du kannst weitere aufnehmen." : ""}` : `Fotos (bis zu ${max})`;
}
function docThumbs(s) {
  return (s.photos || []).map((x, i) => `<figure><img src="${esc(x.url)}" alt="Foto ${i + 1}"><button class="del" type="button" data-act="doc-photo-del" data-i="${i}" aria-label="Foto ${i + 1} entfernen">✕</button></figure>`).join("");
}
function docPhotosUpdate(s) {
  if (S.sheet !== s) return;
  const t = $("#d-thumbs"), add = $("#d-add"), c = $("#d-count");
  if (t) t.innerHTML = docThumbs(s);
  if (add) add.hidden = (s.photos || []).length >= docMax();
  if (c) c.textContent = docCountText(s);
}
async function docAddFiles(files) {
  const s = S.sheet;
  if (!s || s.mode !== "doctor") return;
  s.photos = s.photos || [];
  const room = docMax() - s.photos.length;
  const pick = [...files].slice(0, Math.max(0, room));
  for (const f of pick) {
    const blob = await shrink(f, 1600);
    if (S.sheet !== s) return;
    if (s.photos.length >= docMax()) break;
    s.photos.push({ blob, url: URL.createObjectURL(blob) });
    docPhotosUpdate(s);
  }
  if (files.length > pick.length) toast(`Höchstens ${docMax()} Fotos pro Diagnose`);
}
function diagHtml(r, p) {
  const urg = r.urgency === "hoch" ? "c-crit" : r.urgency === "mittel" ? "c-dry" : "c-ok";
  const showInt = r.intervalDays && r.intervalDays !== interval(p);
  return `<div class="ai">
    <div class="chips">${healthChip(r.health)}<span class="chip ${urg}">Dringlichkeit ${esc(r.urgency)}</span></div>
    <p>${esc(r.summary)}</p>
    ${r.causes.length ? `<div><h3>Mögliche Ursachen</h3><ul>${r.causes.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    ${r.actions.length ? `<div><h3>Das kannst du tun</h3><ol>${r.actions.map(c => `<li>${esc(c)}</li>`).join("")}</ol></div>` : ""}
    ${productsHtml(r.products)}
    ${S.canWrite ? `<div class="btn-row"><button class="btn primary" type="button" data-act="doc-save" id="d-save">Im Verlauf speichern</button>${showInt ? `<button class="btn" type="button" data-act="doc-interval" id="d-int">Giessen alle ${r.intervalDays} statt ${interval(p)} Tage</button>` : ""}</div>` : ""}
  </div>`;
}
async function doctorRun() {
  const s = S.sheet, p = getP(s.id);
  if (!p) return;
  const out = $("#d-out"), go = $("#d-go"), stop = $("#d-stop");
  const blobs = (s.photos || []).map(x => x.blob).slice(0, docMax());
  const text = str($("#d-text").value, 600);
  if (!blobs.length && !text) { out.innerHTML = `<p class="err">Füge ein Foto hinzu oder beschreib, was dir auffällt.</p>`; return; }
  go.disabled = true; stop.hidden = false;
  out.innerHTML = `<p class="status">Claude schaut sich die Pflanze an. Das kann bis zu einer Minute dauern …</p>`;
  s.ctl = new AbortController();
  try {
    s.blobs = blobs;
    const opts = { modelTier: "default", signal: s.ctl.signal, cache: false };
    if (blobs.length) opts.images = blobs;
    const r = await S.sample.json(doctorPrompt(p, text, blobs.length), opts);
    if (S.sheet !== s) return;
    s.result = normalizeDiag(r);
    out.innerHTML = diagHtml(s.result, getP(s.id) || p);
  } catch (e) {
    if (S.sheet !== s) return;
    out.innerHTML = e && e.code === "cancelled" ? "" : `<p class="err">${esc(aiErr(e))}</p>`;
  } finally {
    if (S.sheet === s) { go.disabled = false; go.textContent = "Nochmals analysieren"; stop.hidden = true; }
  }
}
async function doctorSave() {
  const s = S.sheet, r = s.result, btn = $("#d-save");
  if (!r || !getP(s.id)) return;
  btn.disabled = true; btn.textContent = "Speichere …";
  try {
    const ids = [];
    if (s.blobs && S.assets) {
      for (const b of s.blobs) { try { ids.push(await uploadPhoto(b, true)); } catch { /* skip this photo */ } }
    }
    const photoId = ids[0] || null;
    const extra = { health: r.health, note: r.summary + (r.actions[0] ? ` Nächster Schritt: ${r.actions[0]}` : "") };
    if (photoId) extra.photoId = photoId;
    if (ids.length > 1) extra.photoIds = ids;
    const entry = mkEntry("doctor", extra);
    await writePlant(s.id, cur => {
      const patch = { health: r.health, log: pushLog(cur, entry) };
      if (photoId && !cur.photoId) patch.photoId = photoId;
      return patch;
    });
    if (S.sheet === s) btn.textContent = "Gespeichert";
    toast("Diagnose im Verlauf gespeichert");
  } catch (e) {
    if (S.sheet === s) { btn.disabled = false; btn.textContent = "Im Verlauf speichern"; }
    writeErr(e);
  }
}
async function setInterval_(id, days, btn, doneText) {
  if (btn) btn.disabled = true;
  try {
    await writePlant(id, () => ({ intervalDays: days, intervalSetAt: new Date().toISOString() }));
    if (btn && doneText) btn.textContent = doneText;
    toast(`Giessintervall jetzt alle ${days} Tage`);
  } catch (e) { if (btn) btn.disabled = false; writeErr(e); }
}

function sheetCheckin(s) {
  const p = getP(s.id) || {};
  const h = clampInt(p.health, 0, 5, 0) || 3;
  return {
    title: "Check-in",
    body: `<form class="form" id="cform" novalidate>
      <fieldset class="field"><legend>Wie geht es ${esc(nm(p))}?</legend>
        <div class="seg">${[1, 2, 3, 4, 5].map(i => `<input type="radio" name="health" id="h-${i}" value="${i}"${i === h ? " checked" : ""}><label for="h-${i}">${HEALTH[i]}</label>`).join("")}</div>
      </fieldset>
      <div class="field"><label for="c-note">Notiz</label><textarea id="c-note" rows="3" maxlength="500" placeholder="z. B. Neues Blatt, Spitzen braun, Schädlinge gesehen"></textarea></div>
      ${S.assets ? `<div class="field"><label for="c-photo">Foto für den Fotoverlauf</label><input id="c-photo" type="file" accept="image/*"></div>
      <label class="inline"><input type="checkbox" id="c-cover"${p.photoId ? "" : " checked"}> Als Titelbild verwenden</label>` : ""}
      <p id="c-err" class="err" role="alert"></p>
      <div class="btn-row"><button class="btn primary" type="submit" id="c-save">Check-in speichern</button><button class="btn ghost" type="button" data-act="back">Zurück</button></div>
    </form>`,
    bind: () => $("#cform").addEventListener("submit", saveCheckin)
  };
}
async function saveCheckin(e) {
  e.preventDefault();
  const s = S.sheet, btn = $("#c-save"), err = $("#c-err");
  const sel = $('#cform input[name="health"]:checked');
  const health = clampInt(sel ? sel.value : 3, 1, 5, 3);
  const note = str($("#c-note").value, 500);
  btn.disabled = true; btn.textContent = "Speichere …"; err.textContent = "";
  try {
    let photoId = null;
    const file = $("#c-photo") && $("#c-photo").files[0];
    if (file) { btn.textContent = "Lade Foto hoch …"; photoId = await uploadPhoto(file); }
    const cover = photoId && $("#c-cover") && $("#c-cover").checked;
    const extra = { health };
    if (note) extra.note = note;
    if (photoId) extra.photoId = photoId;
    const entry = mkEntry("check", extra);
    await writePlant(s.id, cur => {
      const patch = { health, log: pushLog(cur, entry) };
      if (cover) patch.photoId = photoId;
      return patch;
    });
    if (S.sheet === s) openSheet("detail", { id: s.id });
    toast("Check-in gespeichert");
  } catch (ex) {
    if (ex && ex.code === "invalid_argument") { S.canWrite = false; render(); }
    if (S.sheet !== s) return;
    btn.disabled = false; btn.textContent = "Check-in speichern";
    err.textContent = ex && ex.code ? writeMsg(ex) : "Das Foto konnte nicht hochgeladen werden. Versuch es ohne Foto.";
  }
}

/* ---------- add by photo ---------- */
function sheetAdd() {
  return {
    title: "Pflanzen hinzufügen",
    body: `<div class="pick">
      ${canScan() ? `<button class="btn primary big" data-act="add-scan">${CAM_ICON}Mit Foto erfassen</button><p class="muted small">Claude erkennt die Art und schlägt die Pflege vor. Du wählst nur den Raum.</p>` : ""}
      <button class="btn" data-act="add-manual">Ohne Foto erfassen</button>
      <button class="btn" data-act="add-bulk">Mehrere als Liste erfassen</button>
    </div>`
  };
}
function roomList() { return [...new Set(S.plants.map(x => str(x.room, 60)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")); }
function sheetScan(s) {
  const stage = s.stage || "pick";
  if (stage === "pick") return {
    title: "Pflanze fotografieren",
    body: `<div class="camera-hero">
      <p>Fotografiere die ganze Pflanze bei Tageslicht, Blätter gut sichtbar. Claude erkennt die Art und schlägt die Pflege vor.</p>
      <div class="pick">${camButtons("scan")}</div>
    </div>
    ${s.count ? `<p class="muted small">In dieser Runde erfasst: ${plural(s.count, "Pflanze", "Pflanzen")}.</p>` : ""}`
  };
  if (stage === "busy") return {
    title: "Pflanze wird erkannt",
    body: `<div class="preview busy">${s.preview ? `<img src="${esc(s.preview)}" alt="Dein Foto">` : ""}<span class="scanline" aria-hidden="true"></span></div>
      <p class="status" role="status">Claude bestimmt Art und Pflege. Das dauert meist 10 bis 40 Sekunden …</p>
      <div class="btn-row"><button class="btn ghost" data-act="scan-stop">Abbrechen</button></div>`
  };
  if (stage === "error") return {
    title: "Nicht erkannt",
    body: `${s.preview ? `<div class="preview"><img src="${esc(s.preview)}" alt="Dein Foto"></div>` : ""}
      <p class="err">${esc(s.error || "Das hat nicht geklappt.")}</p>
      <div class="pick">${camButtons("scan")}</div>
      <button class="btn ghost" data-act="scan-manual">Ohne Foto-Erkennung erfassen</button>`
  };
  const d = s.draft, rooms = roomList();
  const conf = { hoch: ["c-ok", "Sicher erkannt"], mittel: ["c-dry", "Ziemlich sicher"], tief: ["c-crit", "Unsicher"] }[d.confidence];
  const opt = (arr, v) => arr.map(o => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("");
  return {
    title: "Neue Pflanze",
    body: `<div class="preview"><img src="${esc(s.preview)}" alt="Dein Foto"></div>
    <div class="panel">
      <div class="chips"><span class="chip ${conf[0]}">${conf[1]}</span>${healthChip(d.health)}</div>
      <div class="field"><label for="s-name">Name</label><input id="s-name" maxlength="60" value="${esc(d.name)}" autocomplete="off"></div>
      ${d.species ? `<p class="sp" style="font-size:1.25rem">${esc(d.species)}</p>` : ""}
      ${d.alternatives.length ? `<p class="muted small">Oder ist es eher …</p><div class="pills pills-wrap">${d.alternatives.map((a, i) => `<button class="pill" type="button" data-act="scan-alt" data-i="${i}">${esc(a.name)}</button>`).join("")}</div><p id="s-alt-status" class="muted small" role="status"></p>` : ""}
      ${d.healthNote ? `<p class="note">${esc(d.healthNote)}</p>` : ""}
    </div>
    <fieldset class="field"><legend style="font-size:1.0625rem">In welchem Raum steht sie?</legend>
      ${rooms.length ? `<div class="pills pills-wrap" id="s-rooms">${rooms.map(r => `<button type="button" class="pill" data-act="scan-room" data-room="${esc(r)}" aria-pressed="${d.room === r}">${esc(r)}</button>`).join("")}</div>` : ""}
      <input id="s-room" maxlength="60" placeholder="${rooms.length ? "Oder neuen Raum eintippen" : "z. B. Wohnzimmer"}" value="${esc(rooms.includes(d.room) ? "" : d.room)}" autocomplete="off" aria-label="Raum">
    </fieldset>
    <div class="panel compact">
      <p><strong>Claude schlägt vor</strong></p>
      <div class="profile-line" id="s-profile">${profileChips(d)}</div>
      ${d.careNote ? `<p class="small">${esc(d.careNote)}</p>` : ""}
    </div>
    <details class="adjust"><summary>Vorschlag anpassen</summary>
      <div class="form">
        <div class="two">
          <div class="field"><label for="s-interval">Giessen alle … Tage</label><input id="s-interval" type="number" inputmode="numeric" min="1" max="90" value="${d.intervalDays}"></div>
          <div class="field"><label for="s-amount">Menge</label><select id="s-amount">${opt(AMOUNT, d.amount)}</select></div>
          <div class="field"><label for="s-light">Lichtbedarf</label><select id="s-light">${opt(LIGHT, d.light)}</select></div>
          <div class="field"><label for="s-fert">Düngen alle … Tage (0 = pausiert)</label><input id="s-fert" type="number" inputmode="numeric" min="0" max="365" value="${d.fertilizeDays}"></div>
        </div>
        <div class="field"><label for="s-note">Hinweis für die Vertretung</label><textarea id="s-note" maxlength="300">${esc(d.careNote)}</textarea></div>
      </div>
    </details>
    <div class="field"><label for="s-last">Zuletzt gegossen</label><select id="s-last"><option value="today">Heute</option><option value="due">Weiss nicht: heute prüfen</option></select></div>
    <p id="s-err" class="err" role="alert"></p>
    <div class="actions"><button class="btn primary" data-act="scan-save" data-next="1">Speichern und nächste</button><button class="btn" data-act="scan-save">Speichern</button></div>`
  };
}
function profileChips(d) {
  return `<span class="chip c-water">alle ${d.intervalDays} Tage giessen</span><span class="chip c-mute">Menge ${esc(d.amount.toLowerCase())}</span><span class="chip c-mute">${esc(d.light)}</span><span class="chip c-mute">${d.fertilizeDays ? `düngen alle ${d.fertilizeDays} Tage` : "Düngen pausiert"}</span>`;
}
function syncScan(s) {
  const d = s.draft;
  if (!d || !$("#s-name")) return;
  d.name = str($("#s-name").value, 60) || d.name;
  const typed = str($("#s-room").value, 60);
  if (typed) d.room = typed;
  d.intervalDays = clampInt($("#s-interval").value, 1, 90, d.intervalDays);
  d.amount = AMOUNT.includes($("#s-amount").value) ? $("#s-amount").value : d.amount;
  d.light = LIGHT.includes($("#s-light").value) ? $("#s-light").value : d.light;
  d.fertilizeDays = clampInt($("#s-fert").value, 0, 365, d.fertilizeDays);
  d.careNote = str($("#s-note").value, 300);
}
async function startScan(file) {
  const s = S.sheet;
  if (!s || !file) return;
  if (s.preview) { try { URL.revokeObjectURL(s.preview); } catch { /* ignore */ } }
  s.stage = "busy"; s.blob = null; s.preview = "";
  renderSheet();
  s.blob = await shrink(file, 1600);
  if (S.sheet !== s) return;
  s.preview = URL.createObjectURL(s.blob);
  renderSheet();
  s.ctl = new AbortController();
  try {
    const r = await S.sample.json(identifyPrompt(), { modelTier: "default", images: [s.blob], signal: s.ctl.signal, cache: false });
    if (S.sheet !== s) return;
    if (r && typeof r === "object" && r.error && !r.species) {
      s.stage = "error"; s.error = `Auf dem Foto ist keine Pflanze zu erkennen (${str(r.error, 140)}). Versuch es mit mehr Abstand und Licht.`;
    } else {
      s.draft = normalizeScan(r); s.stage = "result";
    }
  } catch (e) {
    if (S.sheet !== s) return;
    s.stage = "error"; s.error = e && e.code === "cancelled" ? "Abgebrochen." : aiErr(e);
  }
  renderSheet();
}
async function scanAlt(i, btn) {
  const s = S.sheet, d = s.draft, a = d && d.alternatives[i];
  if (!a) return;
  syncScan(s);
  const st = $("#s-alt-status");
  btn.disabled = true;
  if (st) st.textContent = `Lade Pflege für ${a.name} …`;
  try {
    const o = await S.sample.json(profilePrompt([{ name: a.name, species: a.species }]), { modelTier: "quick" });
    if (S.sheet !== s) return;
    const prof = normalizeProfile(Array.isArray(o) ? o[0] : o, { name: a.name, species: a.species, room: d.room });
    const old = { name: d.name, species: d.species };
    Object.assign(d, prof, { confidence: "hoch" });
    d.alternatives = d.alternatives.filter((_, j) => j !== i).concat(old.name ? [old] : []).slice(0, 2);
    renderSheet();
  } catch (e) {
    if (S.sheet !== s) return;
    btn.disabled = false;
    if (st) st.textContent = aiErr(e);
  }
}
async function scanSave(next, btn) {
  const s = S.sheet, d = s.draft, err = $("#s-err");
  syncScan(s);
  const name = str($("#s-name").value, 60);
  if (!name) { err.textContent = "Bitte gib der Pflanze einen Namen."; $("#s-name").focus(); return; }
  if (!d.room) { err.textContent = "Wähl noch einen Raum."; ($("#s-rooms .pill") || $("#s-room")).focus(); return; }
  panel.querySelectorAll('[data-act="scan-save"]').forEach(b => { b.disabled = true; });
  btn.textContent = "Speichere …"; err.textContent = "";
  try {
    let photoId = null;
    if (S.assets && s.blob) { btn.textContent = "Lade Foto hoch …"; photoId = await uploadPhoto(s.blob, true); }
    const data = { name, species: d.species, room: d.room, intervalDays: d.intervalDays, amount: d.amount, light: d.light, fertilizeDays: d.fertilizeDays, careNote: d.careNote };
    if (photoId) data.photoId = photoId;
    if (d.health) data.health = d.health;
    if ($("#s-last").value === "today") data.lastWatered = today();
    const extra = {};
    if (d.health) extra.health = d.health;
    if (d.healthNote) extra.note = d.healthNote;
    if (photoId) extra.photoId = photoId;
    const id = await createPlant(data, [mkEntry("scan", extra)]);
    if (S.sample) makeSketch(id, s.blob).catch(() => {});
    S.lastRoom = d.room;
    if (s.preview) { try { URL.revokeObjectURL(s.preview); } catch { /* ignore */ } }
    if (S.sheet !== s) return;
    if (next) { openSheet("scan", { count: (s.count || 0) + 1 }); toast(`${name} gespeichert`); }
    else { openSheet("detail", { id }); toast(`${name} hinzugefügt`); }
  } catch (ex) {
    if (ex && ex.code === "invalid_argument") { S.canWrite = false; render(); }
    if (S.sheet !== s) return;
    panel.querySelectorAll('[data-act="scan-save"]').forEach(b => { b.disabled = false; });
    btn.textContent = btn.dataset.next ? "Speichern und nächste" : "Speichern";
    err.textContent = ex && ex.code ? writeMsg(ex) : "Das Foto konnte nicht hochgeladen werden. Versuch es nochmals.";
  }
}

/* ---------- regular photo check ---------- */
function photoQueue(exceptId) {
  return S.plants.filter(p => p.id !== exceptId && (photoDueIn(p) ?? 1) <= 0).sort((a, b) => photoDueIn(a) - photoDueIn(b) || byName(a, b));
}
function sheetPhotoCheck(s) {
  const p = getP(s.id) || {};
  const stage = s.stage || "pick";
  if (stage === "pick" || stage === "error") {
    const last = lastPhoto(p);
    return {
      title: `Foto-Check: ${nm(p)}`,
      body: `<div class="camera-hero">
        ${last && typeof last.photoId === "string" ? `<div class="preview"><img src="${esc(photoUrl(last.photoId))}" alt="Letztes Foto vom ${fmtDate(last.d)}"></div><p class="muted small">Letztes Foto vom ${fmtDate(last.d)}. Fotografiere möglichst aus dem gleichen Winkel.</p>` : `<p>Fotografiere die ganze Pflanze bei Tageslicht. Claude beurteilt den Zustand und sagt dir, was zu tun ist.</p>`}
        ${stage === "error" ? `<p class="err">${esc(s.error || "Das hat nicht geklappt.")}</p>` : ""}
        <div class="field"><label for="pc-text">Ist dir etwas aufgefallen? (optional)</label><textarea id="pc-text" rows="2" placeholder="z. B. Blattspitzen braun">${esc(s.text || "")}</textarea></div>
        <div class="pick">${camButtons("pc")}</div>
      </div>`
    };
  }
  if (stage === "busy") return {
    title: `Foto-Check: ${nm(p)}`,
    body: `<div class="preview busy">${s.preview ? `<img src="${esc(s.preview)}" alt="Dein Foto">` : ""}<span class="scanline" aria-hidden="true"></span></div>
      <p class="status" role="status">Der Pflanzendoktor vergleicht mit dem letzten Foto. Das dauert meist bis zu einer Minute …</p>
      <div class="btn-row"><button class="btn ghost" data-act="pc-stop">Abbrechen</button></div>`
  };
  const r = s.result;
  const urg = r.urgency === "hoch" ? "c-crit" : r.urgency === "mittel" ? "c-dry" : "c-ok";
  const tr = { besser: "c-ok", gleich: "c-mute", schlechter: "c-crit" }[r.trend];
  const queue = photoQueue(s.id);
  const showInt = r.intervalDays && r.intervalDays !== interval(p);
  return {
    title: `Foto-Check: ${nm(p)}`,
    body: `<div class="preview"><img src="${esc(s.preview)}" alt="Dein Foto"></div>
    <div class="ai">
      <div class="chips">${healthChip(r.health)}${tr ? `<span class="chip ${tr}">${esc(TREND[r.trend])}</span>` : ""}<span class="chip ${urg}">Dringlichkeit ${esc(r.urgency)}</span></div>
      <p>${esc(r.summary)}</p>
      ${r.causes.length ? `<div><h3>Mögliche Ursachen</h3><ul>${r.causes.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
      ${r.actions.length ? `<div><h3>Das kannst du tun</h3><ol>${r.actions.map(c => `<li>${esc(c)}</li>`).join("")}</ol></div>` : ""}
      ${productsHtml(r.products)}
      ${showInt ? `<button class="btn" type="button" data-act="doc-interval">Giessen alle ${r.intervalDays} statt ${interval(p)} Tage</button>` : ""}
      <p class="muted small" id="pc-save" role="status">${s.saved === true ? `Im Verlauf gespeichert. Nächster Foto-Check in ${plural(photoEvery(Object.assign({}, p, { health: r.health })), "Tag", "Tagen")}.` : s.saved === false ? "Speichern hat nicht geklappt." : "Wird im Verlauf gespeichert …"}</p>
    </div>
    <div class="actions">${queue.length ? `<button class="btn primary" data-act="pc-next">Nächste: ${esc(nm(queue[0]))}</button>` : ""}<button class="btn" data-act="back">Zur Pflanze</button></div>`
  };
}
async function runPhotoCheck(file) {
  const s = S.sheet, p = getP(s && s.id);
  if (!s || !p || !file) return;
  const ta = $("#pc-text");
  s.text = ta ? str(ta.value, 400) : (s.text || "");
  s.stage = "busy"; s.preview = "";
  renderSheet();
  const cur = await shrink(file, 1600);
  if (S.sheet !== s) return;
  s.blob = cur;
  s.preview = URL.createObjectURL(cur);
  renderSheet();
  const images = [cur];
  const last = lastPhoto(p);
  let prevDate = null;
  const max = (S.imgLimits && S.imgLimits.maxCount) || 1;
  if (last && typeof last.photoId === "string" && max > 1) {
    try {
      const res = await fetch(photoUrl(last.photoId));
      if (res.ok) { images.push(await res.blob()); prevDate = last.d; }
    } catch { /* compare without the previous photo */ }
  }
  s.ctl = new AbortController();
  try {
    const raw = await S.sample.json(doctorPrompt(p, s.text, images.length, prevDate), { modelTier: "default", images, signal: s.ctl.signal, cache: false });
    if (S.sheet !== s) return;
    s.result = normalizeDiag(raw);
    s.stage = "result";
    renderSheet();
    savePhotoCheck(s, p.id);
  } catch (e) {
    if (S.sheet !== s) return;
    s.stage = "error";
    s.error = e && e.code === "cancelled" ? "Abgebrochen. Du kannst es nochmals versuchen." : aiErr(e);
    renderSheet();
  }
}
async function savePhotoCheck(s, id) {
  const r = s.result;
  try {
    const photoId = await uploadPhoto(s.blob, true);
    const extra = { health: r.health, photoId, note: r.summary + (r.actions[0] ? ` Nächster Schritt: ${r.actions[0]}` : "") };
    if (r.trend !== "unklar") extra.trend = r.trend;
    const entry = mkEntry("doctor", extra);
    await writePlant(id, cur => ({ health: r.health, photoId, log: pushLog(cur, entry) }));
    s.saved = true;
  } catch (e) {
    s.saved = false;
    if (e && e.code) writeErr(e);
  }
  if (S.sheet === s) {
    const el = $("#pc-save");
    if (el) el.textContent = s.saved ? `Im Verlauf gespeichert. Nächster Foto-Check in ${plural(photoEvery(Object.assign({}, getP(id) || {}, { health: r.health })), "Tag", "Tagen")}.` : "Speichern hat nicht geklappt. Prüfe die Verbindung.";
  }
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ""}`;
  t.hidden = false;
  if (actionLabel) t.querySelector("button").onclick = () => { t.hidden = true; clearTimeout(toastTimer); action(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, actionLabel ? 6000 : 3000);
}

/* ---------- events ---------- */
async function copyPlan(btn) {
  const text = planText();
  const ta = $("#plan-text");
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Kopiert. Jetzt in eine Nachricht einfügen";
    setTimeout(() => { if (btn.isConnected) btn.textContent = "Plan als Text kopieren"; }, 3000);
  } catch {
    if (ta) { ta.hidden = false; ta.value = text; ta.focus(); ta.select(); }
    btn.textContent = "Text unten markieren und kopieren";
  }
}
app.addEventListener("click", e => {
  if (e.target.closest("label, input, select, textarea")) return;
  if (e.target.closest("summary")) return;
  const st = e.target.closest("[data-export],[data-acct]");
  if (st) {
    if (st.hasAttribute("data-export")) return doExport(st);
    return acctAction(st.dataset.acct, st);
  }
  const t = e.target.closest("[data-find],[data-have],[data-guide],[data-guide-name],[data-adopt],[data-fert-all],[data-water],[data-snooze],[data-fert],[data-doctor],[data-water-all],[data-new],[data-bulk],[data-scan],[data-add],[data-sketch-all],[data-sketch-stop],[data-photo-every],[data-day],[data-room],[data-copy-plan],[data-open]");
  if (!t) return;
  if (t.hasAttribute("data-find")) return runFinder();
  if (t.hasAttribute("data-have")) { const n = str(S.finder.have, 60); if (n) openGuide({ name: n }); else { const el = $("#n-have"); if (el) el.focus(); } return; }
  if (t.hasAttribute("data-guide")) return openGuide({ id: t.dataset.guide });
  if (t.hasAttribute("data-guide-name") || t.hasAttribute("data-adopt")) {
    const x = S.finder.result && S.finder.result[clampInt(t.dataset.guideName ?? t.dataset.adopt, 0, 9, 0)];
    if (!x) return;
    return t.hasAttribute("data-adopt") ? openSheet("form", { prefill: { name: x.name, species: x.species, room: S.finder.room } }) : openGuide({ name: x.name, species: x.species });
  }
  if (t.hasAttribute("data-fert-all")) return fertAll();
  if (t.hasAttribute("data-scan")) return openSheet("scan", {});
  if (t.hasAttribute("data-add")) return openSheet("add", {});
  if (t.hasAttribute("data-sketch-all")) return sketchAll();
  if (t.hasAttribute("data-sketch-stop")) { if (S.batch) { S.batch.stop = true; render(); } return; }
  if (t.hasAttribute("data-photo-every")) return savePhotoEvery(clampInt(t.dataset.photoEvery, 0, 90, 14));
  if (t.hasAttribute("data-water")) return water(t.dataset.water);
  if (t.hasAttribute("data-snooze")) return openSheet("snooze", { id: t.dataset.snooze });
  if (t.hasAttribute("data-fert")) return fertilize(t.dataset.fert);
  if (t.hasAttribute("data-doctor")) return openSheet("doctor", { id: t.dataset.doctor });
  if (t.hasAttribute("data-water-all")) return waterAll();
  if (t.hasAttribute("data-new")) return openSheet("form", {});
  if (t.hasAttribute("data-bulk")) return openSheet("bulk", {});
  if (t.hasAttribute("data-day")) {
    S.day = clampInt(t.dataset.day, 0, CAL_DAYS - 1, 0);
    render();
    const b = app.querySelector(`.strip [data-day="${S.day}"]`);
    if (b && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return;
  }
  if (t.hasAttribute("data-room")) { S.filter.room = t.dataset.room; return render(); }
  if (t.hasAttribute("data-copy-plan")) return copyPlan(t);
  if (t.hasAttribute("data-open")) return openSheet("detail", { id: t.dataset.open });
});
app.addEventListener("keydown", e => {
  const enterAct = { "key-in": "key-save", "join-code": "join", "hh-name": "hh-name-save", "pw-new": "pw-save" }[e.target.id];
  if (e.key === "Enter" && enterAct) { e.preventDefault(); acctAction(enterAct, e.target); return; }
  if (e.key === "Enter" && e.target.id === "n-have") { e.preventDefault(); const n = str(e.target.value, 60); if (n) openGuide({ name: n }); return; }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("li[data-open]")) { e.preventDefault(); openSheet("detail", { id: e.target.dataset.open }); }
});
app.addEventListener("input", e => {
  if (e.target.id === "search") { S.filter.q = e.target.value; render(); }
  syncFinder(e.target);
});
const FINDER_KEYS = { "n-light": "light", "n-effort": "effort", "n-size": "size", "n-room": "room", "n-wish": "wish", "n-have": "have" };
function syncFinder(el) {
  if (!el || !el.id) return;
  if (FINDER_KEYS[el.id]) S.finder[FINDER_KEYS[el.id]] = str(el.value, 160);
  if (el.id === "n-pets") S.finder.pets = !!el.checked;
}
document.addEventListener("wheel", e => {
  const el = e.target.closest && e.target.closest(".hscroll");
  if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0) return;
  const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
  if (next === el.scrollLeft) return;
  el.scrollLeft = next;
  e.preventDefault();
}, { passive: false });
app.addEventListener("change", e => {
  syncFinder(e.target);
  if (e.target.id === "imp-file") { const f = e.target.files && e.target.files[0]; if (f) doImport(f); e.target.value = ""; return; }
  if (e.target.dataset && e.target.dataset.photocheck) {
    const file = e.target.files && e.target.files[0];
    if (file) { openSheet("photocheck", { id: e.target.dataset.photocheck }); runPhotoCheck(file); }
    e.target.value = "";
    return;
  }
  if (e.target.id === "plan-from" || e.target.id === "plan-to") {
    const r = planRange();
    S.plan = { from: $("#plan-from").value || r.from, to: $("#plan-to").value || r.to };
    if (S.plan.to < S.plan.from) S.plan.to = S.plan.from;
    render();
  }
});
panel.addEventListener("click", e => {
  if (e.target.closest("[data-close]")) return closeSheet();
  const a = e.target.closest("[data-act]");
  const s = S.sheet;
  if (!a || !s) return;
  const id = s.id;
  switch (a.dataset.act) {
    case "water": water(id); break;
    case "snooze": openSheet("snooze", { id, from: "detail" }); break;
    case "snooze-n": snooze(id, clampInt(a.dataset.days, 1, 14, 1)); if (s.from === "detail") openSheet("detail", { id }); else closeSheet(); break;
    case "fert": fertilize(id); break;
    case "repot": repot(id); break;
    case "checkin": openSheet("checkin", { id }); break;
    case "doctor": openSheet("doctor", { id }); break;
    case "guide": openGuide({ id }); break;
    case "guide-run": runGuide(); break;
    case "guide-adopt": openSheet("form", { prefill: { name: s.name, species: s.species || "", room: S.finder.room } }); break;
    case "edit": openSheet("form", { id }); break;
    case "back": openSheet("detail", { id }); break;
    case "delete":
      if (!s.confirmDel) { s.confirmDel = true; renderSheet(); } else deletePlant(id);
      break;
    case "hint-accept": setInterval_(id, clampInt(a.dataset.days, 1, 90, 7), a); break;
    case "hint-dismiss":
      a.disabled = true;
      writePlant(id, () => ({ intervalSetAt: new Date().toISOString() })).catch(writeErr);
      break;
    case "suggest": formSuggest(); break;
    case "photocheck": openSheet("photocheck", { id }); break;
    case "add-scan": openSheet("scan", {}); break;
    case "add-manual": openSheet("form", {}); break;
    case "add-bulk": openSheet("bulk", {}); break;
    case "resketch":
      a.disabled = true; a.textContent = "Skizze wird gezeichnet …";
      makeSketch(id).then(() => toast("Neue Skizze gespeichert")).catch(e => toast(e && e.code === "bad_svg" ? "Die Skizze ist nicht gelungen. Versuch es nochmals." : aiErr(e)));
      break;
    case "pc-next": { const q = photoQueue(id); if (q.length) openSheet("photocheck", { id: q[0].id }); break; }
    case "pc-stop": case "scan-stop": if (s.ctl) s.ctl.abort(); break;
    case "scan-manual": openSheet("form", {}); break;
    case "scan-room":
      s.draft.room = a.dataset.room;
      $("#s-room").value = "";
      panel.querySelectorAll("#s-rooms .pill").forEach(b => b.setAttribute("aria-pressed", String(b === a)));
      $("#s-err").textContent = "";
      break;
    case "scan-alt": scanAlt(clampInt(a.dataset.i, 0, 1, 0), a); break;
    case "scan-save": scanSave(!!a.dataset.next, a); break;
    case "bulk-suggest": bulkSuggest(); break;
    case "bulk-create": bulkCreate(); break;
    case "doc-run": doctorRun(); break;
    case "doc-photo-del": {
      const i = clampInt(a.dataset.i, 0, 3, 0);
      const x = s.photos && s.photos[i];
      if (x) { try { URL.revokeObjectURL(x.url); } catch { /* ignore */ } s.photos.splice(i, 1); docPhotosUpdate(s); }
      break;
    }
    case "doc-stop": if (s.ctl) s.ctl.abort(); break;
    case "doc-save": doctorSave(); break;
    case "doc-interval": if (s.result && s.result.intervalDays) setInterval_(id, s.result.intervalDays, a, `Giessintervall jetzt ${s.result.intervalDays} Tage`); break;
  }
});
panel.addEventListener("change", e => {
  const s = S.sheet, id = e.target.id;
  if (!s) return;
  const file = e.target.files && e.target.files[0];
  if ((id === "scan-cam" || id === "scan-lib") && file) startScan(file);
  if ((id === "pc-cam" || id === "pc-lib") && file) runPhotoCheck(file);
  if ((id === "d-cam" || id === "d-lib") && e.target.files.length) { docAddFiles([...e.target.files]); e.target.value = ""; }
});
panel.addEventListener("input", e => {
  const s = S.sheet;
  if (s && s.mode === "scan" && e.target.id === "s-room" && e.target.value.trim()) {
    s.draft.room = str(e.target.value, 60);
    panel.querySelectorAll("#s-rooms .pill").forEach(b => b.setAttribute("aria-pressed", "false"));
  }
  if (s && s.mode === "scan" && /^s-(interval|amount|light|fert)$/.test(e.target.id)) {
    syncScan(s);
    const pr = $("#s-profile");
    if (pr) pr.innerHTML = profileChips(s.draft);
  }
});
async function savePhotoEvery(v) {
  if (!S.canWrite) return;
  const prev = S.settings.photoCheckDays;
  S.settings = Object.assign({}, S.settings, { photoCheckDays: v });
  render();
  try { await S.db.doc("settings/app").set({ photoCheckDays: v }); toast(v ? `Foto-Check alle ${v} Tage` : "Foto-Check ausgeschaltet"); }
  catch (e) { S.settings = Object.assign({}, S.settings, { photoCheckDays: prev }); render(); writeErr(e); }
}
sheetEl.addEventListener("click", e => { if (e.target === sheetEl) closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.sheet) closeSheet(); });
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.loaded) render(); });

/* ---------- start ---------- */
(async function init() {
  render();
  const timer = setTimeout(() => { S.stale = true; if (!S.loaded) S.loaded = true; render(); }, 10000);
  const use = n => (window.claude && typeof window.claude.use === "function") ? window.claude.use(n).catch(() => null) : Promise.resolve(null);
  const [db, user, assets, sample] = await Promise.all([use("db"), use("user"), use("assets"), use("sample")]);
  S.db = db; S.user = user; S.assets = assets; S.sample = sample;
  if (user) {
    try { S.uid = await user.id(); } catch { S.uid = null; }
    try { const c = await user.can("data.write"); if (c === false) S.canWrite = false; } catch { /* keep inputs */ }
  }
  if (sample) { try { const l = await sample.limits(); S.imgLimits = (l && l.images) || null; } catch { S.imgLimits = null; } }
  if (!db) { clearTimeout(timer); S.dbMissing = true; S.canWrite = false; S.loaded = true; render(); return; }
  db.doc("settings/app").onSnapshot(snap => {
    const d = snap.exists ? snap.data() : {};
    S.settings = { photoCheckDays: clampInt(d && d.photoCheckDays, 0, 90, 14) };
    if (S.loaded) render();
  }, () => {});
  db.collection("plants").onSnapshot(snap => {
    S.plants = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    S.loaded = true;
    if (!snap.metadata.fromCache) { clearTimeout(timer); S.stale = false; }
    render();
  }, err => {
    clearTimeout(timer);
    S.loaded = true; S.stale = false;
    S.dbError = (err && err.code) || "unavailable";
    render();
  });
})();
