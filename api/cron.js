// Täglicher Job (Vercel Cron, siehe vercel.json): schickt am Morgen die Giess-Erinnerungen.
// Ist CRON_SECRET gesetzt, schickt Vercel es mit, und nur dann läuft der Job.
import { cmd } from "../lib/store.js";
import { send, wrap } from "../lib/core.js";
import { sendMorning, TZ } from "../lib/push.js";
import "../public/schedule.js";

export const config = { maxDuration: 60 };

export default wrap(async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { code: "unauthorized" });
  // Höchstens einmal pro Tag, auch wenn der Aufruf wiederholt wird
  const day = globalThis.PPSchedule.todayIn(TZ);
  if ((await cmd("SET", "cron:morning:" + day, "1", "NX", "EX", 2 * 86400)) !== "OK") return send(res, 200, { skipped: "already_sent", day });
  const r = await sendMorning();
  console.log("Erinnerungen", day, JSON.stringify(r));
  return send(res, 200, Object.assign({ day }, r));
});
