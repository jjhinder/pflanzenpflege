/*
 * Pflegeplan: wann gegossen, gedüngt und umgetopft wird.
 * Läuft im Browser (als normales Skript, setzt window.PPSchedule) und auf dem Server
 * (import "../public/schedule.js" setzt globalThis.PPSchedule), damit die Erinnerungen am Morgen
 * genau dasselbe rechnen wie die App.
 *
 * Alle Funktionen bekommen "heute" (t, als "JJJJ-MM-TT") und die Haushalts-Einstellungen (o) übergeben.
 */
"use strict";
(function (g) {
  const pad = n => String(n).padStart(2, "0");
  const validYmd = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const utc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  const addDays = (s, n) => { const d = new Date(utc(s) + n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const addMonths = (s, n) => {
    const [y, m, d] = s.split("-").map(Number);
    const x = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
  };
  const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
  const month = s => Number(s.slice(5, 7)) - 1; // 0 = Januar
  const day10 = v => (typeof v === "string" && validYmd(v.slice(0, 10)) ? v.slice(0, 10) : "");

  /* Wie viel länger die Erde im Vergleich zum Sommer feucht bleibt (weniger Licht, kühler, langsameres Wachstum). */
  const SEASON = [1.35, 1.3, 1.15, 1.05, 1, 1, 1, 1, 1.05, 1.15, 1.3, 1.35];
  /* Düngepause in der Winterruhe (November bis Februar) */
  const restMonth = m => m >= 10 || m <= 1;
  function afterRest(s) {
    const m = month(s), y = Number(s.slice(0, 4));
    if (m >= 10) return `${y + 1}-03-01`;
    if (m <= 1) return `${y}-03-01`;
    return s;
  }
  /* Umtopfen am besten im Frühling und Sommer (März bis August) */
  function inRepotSeason(s) {
    const m = month(s), y = Number(s.slice(0, 4));
    if (m >= 8) return `${y + 1}-03-01`;
    if (m <= 1) return `${y}-03-01`;
    return s;
  }

  const opts = o => ({ seasonal: !(o && o.seasonal === false) });
  const inWater = p => p && p.stage === "wasser";
  /** Ab wann das Giessintervall gilt: Es wurde in diesem Monat festgelegt, also passt es zu dieser Jahreszeit. */
  const intervalRef = p => day10(p.intervalRef) || day10(p.createdAt) || "";

  /** Giessintervall am Tag d (bei Ablegern im Wasser: alle 7 Tage Wasser wechseln) */
  function intervalAt(p, d, o) {
    if (inWater(p)) return 7;
    const base = clampInt(p.intervalDays, 1, 90, 7);
    if (!opts(o).seasonal || !validYmd(d)) return base;
    const ref = intervalRef(p) || d;
    return clampInt(base * SEASON[month(d)] / SEASON[month(ref)], 1, 120, base);
  }
  function baseNext(p, t, o) {
    if (!validYmd(p.lastWatered)) return t;
    return addDays(p.lastWatered, intervalAt(p, t, o));
  }
  function nextWater(p, t, o) { const b = baseNext(p, t, o); return validYmd(p.snoozeUntil) && p.snoozeUntil > b ? p.snoozeUntil : b; }
  const dueIn = (p, t, o) => diffDays(t, nextWater(p, t, o));
  function waterOcc(p, from, to, t, o) {
    const out = [];
    let d = nextWater(p, t, o);
    if (d < from) d = from;
    for (let i = 0; d <= to && i < 120; i++) { out.push(d); d = addDays(d, intervalAt(p, d, o)); }
    return out;
  }

  const fertEvery = p => (inWater(p) ? 0 : clampInt(p.fertilizeDays, 0, 365, 0));
  function fertNext(p, t, o) {
    const f = fertEvery(p);
    if (!f) return null;
    let d = validYmd(p.lastFertilized) ? addDays(p.lastFertilized, f) : t;
    if (opts(o).seasonal && restMonth(month(d < t ? t : d))) d = afterRest(d < t ? t : d);
    return d;
  }
  function fertDue(p, t, o) {
    const d = fertNext(p, t, o);
    return d === null ? null : diffDays(t, d);
  }
  function fertOcc(p, from, to, t, o) {
    const f = fertEvery(p);
    if (!f) return [];
    let d = fertNext(p, t, o);
    if (d < from) d = from;
    const out = [];
    for (let i = 0; d <= to && i < 60; i++) {
      if (opts(o).seasonal && restMonth(month(d))) { d = afterRest(d); continue; }
      out.push(d);
      d = addDays(d, f);
    }
    return out;
  }

  /** Umtopfen alle … Monate (0 = keine Erinnerung). Ohne Angabe: alle 24 Monate. */
  const repotEvery = p => (inWater(p) ? 0 : p.repotMonths === undefined || p.repotMonths === null ? 24 : clampInt(p.repotMonths, 0, 60, 24));
  /** Nächstes Umtopfen. Mit t: Überfälliges rückt auf heute, ausserhalb der Saison auf den nächsten März. */
  function repotNext(p, t) {
    const every = repotEvery(p);
    if (!every) return null;
    const ref = (validYmd(p.lastRepotted) && p.lastRepotted) || day10(p.createdAt);
    if (!ref) return null;
    let d = addMonths(ref, every);
    if (validYmd(p.repotAfter) && p.repotAfter > d) d = p.repotAfter;
    if (validYmd(t) && d < t) d = t;
    return inRepotSeason(d);
  }
  function repotDue(p, t) {
    const d = repotNext(p, t);
    return d === null ? null : diffDays(t, d);
  }

  /** Was heute ansteht, für die Erinnerung am Morgen. */
  function summary(plants, t, o) {
    const water = [], fert = [], repot = [];
    for (const p of plants) {
      if (!p || typeof p !== "object") continue;
      if (dueIn(p, t, o) <= 0) water.push(p);
      const f = fertDue(p, t, o);
      if (f !== null && f <= 0) fert.push(p);
      const r = repotDue(p, t);
      if (r !== null && r <= 0) repot.push(p);
    }
    return { water, fert, repot };
  }

  /** Heutiges Datum in einer Zeitzone (für den Server) */
  function todayIn(tz) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  }

  g.PPSchedule = {
    SEASON, validYmd, diffDays, addDays, addMonths, clampInt,
    intervalAt, intervalRef, nextWater, dueIn, waterOcc,
    fertEvery, fertNext, fertDue, fertOcc, restMonth: d => restMonth(month(d)),
    repotEvery, repotNext, repotDue, summary, todayIn, inWater
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
