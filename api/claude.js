// Serverfunktion für die KI-Funktionen der App (Skizzen, Pflanzendoktor, Foto-Erkennung, Pflanzenfinder).
// Jeder Haushalt hinterlegt seinen eigenen Anthropic-API-Schlüssel und bezahlt damit seine Anfragen selbst.
// Der Schlüssel liegt verschlüsselt auf dem Server und geht nie zurück an den Browser.
import Anthropic from "@anthropic-ai/sdk";
import { send, wrap, requireAuth, decrypt } from "../lib/core.js";
import { record } from "../lib/usage.js";

export const config = { maxDuration: 300 };

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
// Skizzen sind lange SVG-Ausgaben und mit Opus teuer. Haiku zeichnet sie für einen Bruchteil.
const SKETCH_MODEL = process.env.CLAUDE_SKETCH_MODEL || "claude-haiku-5-5";
const MAX_IMAGES = 4;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const SYSTEM_TEXT = "Du hilfst in einer App für Zimmerpflanzen in der Schweiz. Schreibe auf Schweizer Hochdeutsch (ss statt ß).";
const SYSTEM_JSON = SYSTEM_TEXT + " Antworte ausschliesslich mit gültigem JSON, ohne Markdown-Codeblock und ohne Text davor oder danach.";

function parseJson(text) {
  let t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* try to cut out the JSON value */ }
  const starts = [t.indexOf("{"), t.indexOf("[")].filter(i => i >= 0);
  if (!starts.length) return null;
  const s = Math.min(...starts);
  const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

export default wrap(async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  const a = await requireAuth(req, res);
  if (!a) return;
  const apiKey = a.hh.key ? decrypt(a.hh.key.enc) : null;
  if (!apiKey) return send(res, 403, { code: "no_key" });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.ping) return send(res, 200, { ok: true });

  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 20000) : "";
  if (!prompt) return send(res, 400, { code: "bad_request" });
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  for (const im of images) {
    if (!im || !IMAGE_TYPES.has(im.media_type) || typeof im.data !== "string") return send(res, 400, { code: "image_rejected" });
  }
  const json = !!body.json;
  const quick = body.tier === "quick";
  const sketch = body.feature === "sketch";
  const model = sketch ? SKETCH_MODEL : MODEL;

  const content = [
    ...images.map(im => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: prompt }
  ];

  const client = new Anthropic({ apiKey });
  try {
    const params = {
      model,
      max_tokens: sketch ? 20000 : quick ? 8000 : 32000,
      output_config: { effort: sketch || quick ? "low" : "medium" },
      system: json ? SYSTEM_JSON : SYSTEM_TEXT,
      messages: [{ role: "user", content }]
    };
    // Haiku kennt keinen serverseitigen Ersatz bei Ablehnung, die Opus-Anfragen schon
    const stream = model.startsWith("claude-haiku")
      ? client.messages.stream(params)
      : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    const msg = await stream.finalMessage();
    // Kosten mitschreiben (auch bei abgelehnten Anfragen, die Tokens werden trotzdem verrechnet)
    try { await record(a.hh.id, msg.model || model, msg.usage, String(body.feature || "")); } catch (e) { console.warn("Kosten nicht erfasst:", e && e.message); }
    if (msg.stop_reason === "refusal") return send(res, 422, { code: "refused" });
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    if (!json) return send(res, 200, { text });
    const parsed = parseJson(text);
    if (parsed === null) return send(res, 502, { code: "invalid_json" });
    return send(res, 200, { json: parsed });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { code: "rate_limited" });
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return send(res, 403, { code: "key_rejected" });
    if (err && err.status === 402) return send(res, 402, { code: "no_credit" });
    if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(String(err.message))) return send(res, 402, { code: "no_credit" });
    if (err instanceof Anthropic.BadRequestError) {
      const m = String(err.message || "");
      return send(res, 400, { code: /image/i.test(m) ? "image_rejected" : "bad_request" });
    }
    console.error("Claude-Anfrage fehlgeschlagen:", err && err.message);
    return send(res, 502, { code: "error" });
  }
});
