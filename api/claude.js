// Serverfunktion für die KI-Funktionen der App (Skizzen, Pflanzendoktor, Foto-Erkennung, Pflanzenfinder).
// Der Anthropic-API-Schlüssel bleibt auf dem Server. Damit niemand mit dem Link deinen Schlüssel
// verbraucht, braucht jede Anfrage das App-Passwort (Umgebungsvariable APP_PASSWORD).
import Anthropic from "@anthropic-ai/sdk";
import { createHash, timingSafeEqual } from "node:crypto";

export const config = { maxDuration: 300 };

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_IMAGES = 4;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const SYSTEM_TEXT = "Du hilfst in einer App für Zimmerpflanzen in der Schweiz. Schreibe auf Schweizer Hochdeutsch (ss statt ß).";
const SYSTEM_JSON = SYSTEM_TEXT + " Antworte ausschliesslich mit gültigem JSON, ohne Markdown-Codeblock und ohne Text davor oder danach.";

const sha = s => createHash("sha256").update(String(s)).digest();
function passwordOk(given) {
  const want = process.env.APP_PASSWORD;
  if (!want) return false;
  return timingSafeEqual(sha(given || ""), sha(want));
}

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

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  const configured = !!process.env.ANTHROPIC_API_KEY && !!process.env.APP_PASSWORD;
  if (req.method === "GET") return send(res, 200, { configured });
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  if (!configured) return send(res, 503, { code: "sampling_disabled" });
  if (!passwordOk(req.headers["x-app-password"])) return send(res, 401, { code: "not_granted" });

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

  const content = [
    ...images.map(im => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: prompt }
  ];

  const client = new Anthropic();
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: quick ? 8000 : 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: quick ? "low" : "medium" },
      system: json ? SYSTEM_JSON : SYSTEM_TEXT,
      messages: [{ role: "user", content }]
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") return send(res, 422, { code: "refused" });
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    if (!json) return send(res, 200, { text });
    const parsed = parseJson(text);
    if (parsed === null) return send(res, 502, { code: "invalid_json" });
    return send(res, 200, { json: parsed });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { code: "rate_limited" });
    if (err instanceof Anthropic.AuthenticationError) return send(res, 503, { code: "sampling_disabled" });
    if (err instanceof Anthropic.BadRequestError) {
      const m = String(err.message || "");
      return send(res, 400, { code: /image/i.test(m) ? "image_rejected" : "bad_request" });
    }
    console.error("Claude-Anfrage fehlgeschlagen:", err && err.message);
    return send(res, 502, { code: "error" });
  }
}
