// KI-Kosten pro Haushalt und Monat, geschätzt aus den Tokens, die Anthropic pro Anfrage meldet.
// Gespeichert als Mikro-US-Dollar (1 USD = 1 000 000), damit Redis ganze Zahlen addieren kann.
import { pipe, pairs } from "./store.js";

// US-Dollar pro Million Tokens: [Eingabe, Ausgabe, aus dem Cache gelesen]. Schreiben in den Cache kostet 1,25 × Eingabe.
// Stand November 2026, aktuelle Preise: https://www.anthropic.com/pricing
const PRICES = {
  "claude-fable-5-2": [8, 40, 0.2],
  "claude-fable-5-1": [10, 50, 1],
  "claude-fable-5": [10, 50, 1],
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-opus-5": [5, 25, 0.5],
  "claude-opus-4-8": [5, 25, 0.5],
  "claude-opus-4-7": [5, 25, 0.5],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-sonnet-5": [2, 10, 0.2],
  "claude-sonnet-4-6": [3, 15, 0.3],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-haiku-4-5": [1, 5, 0.1]
};
const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);
const priceOf = model => PRICES[KEYS.find(k => String(model || "").startsWith(k))] || PRICES["claude-opus-5-5"];

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const FEATURES = new Set(["sketch", "doctor", "photocheck", "compare", "scan", "profile", "finder", "guide", "other"]);

/** Kosten einer Antwort in Mikro-Dollar */
export function costOf(model, u) {
  const [pin, pout, pcr] = priceOf(model);
  const n = k => Math.max(0, Number(u && u[k]) || 0);
  const usd = (n("input_tokens") * pin + n("cache_creation_input_tokens") * pin * 1.25 + n("cache_read_input_tokens") * pcr + n("output_tokens") * pout) / 1e6;
  return Math.round(usd * 1e6);
}

export async function record(hhId, model, usage, feature) {
  const f = FEATURES.has(feature) ? feature : "other";
  const micro = costOf(model, usage);
  const key = `hh:${hhId}:usage:${monthKey()}`;
  const n = k => Math.max(0, Math.round(Number(usage && usage[k]) || 0));
  await pipe(
    ["HINCRBY", key, "usd", micro],
    ["HINCRBY", key, "req", 1],
    ["HINCRBY", key, "in", n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens")],
    ["HINCRBY", key, "out", n("output_tokens")],
    ["HINCRBY", key, `f:${f}:usd`, micro],
    ["HINCRBY", key, `f:${f}:req`, 1],
    ["EXPIRE", key, 420 * 86400]
  );
}

function view(raw) {
  const h = pairs(raw);
  const num = k => Number(h[k]) || 0;
  const features = {};
  for (const k of Object.keys(h)) {
    const m = k.match(/^f:([a-z]+):(usd|req)$/);
    if (!m) continue;
    features[m[1]] = features[m[1]] || { usd: 0, req: 0 };
    features[m[1]][m[2]] = m[2] === "usd" ? num(k) / 1e6 : num(k);
  }
  return { usd: num("usd") / 1e6, req: num("req"), in: num("in"), out: num("out"), features };
}

/** Diesen und letzten Monat, dazu der Platz, den die Fotos belegen */
export async function usageView(hhId) {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const [cur, last, sizes] = await pipe(
    ["HGETALL", `hh:${hhId}:usage:${monthKey(now)}`],
    ["HGETALL", `hh:${hhId}:usage:${monthKey(prev)}`],
    ["HVALS", `hh:${hhId}:phs`]
  );
  const vals = Array.isArray(sizes) ? sizes : Object.values(sizes || {});
  return {
    month: monthKey(now), current: view(cur),
    prevMonth: monthKey(prev), previous: view(last),
    photos: { count: vals.length, bytes: vals.reduce((s, v) => s + (Number(v) || 0), 0) }
  };
}
