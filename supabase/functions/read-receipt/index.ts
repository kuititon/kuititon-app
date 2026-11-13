// kuititon: automatic receipt reading.
// Checks the signed-in user, enforces the scan limits (trial: 10 in total, paid: 100 per month),
// asks Claude Haiku to read the receipt photo, and returns the JSON result.
// Secrets needed: ANTHROPIC_API_KEY (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically).
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";
const TRIAL_SCANS = 10, MONTHLY_SCANS = 100, TRIAL_DAYS = 30;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const msg = (lang: string, en: string, fi: string) => (lang === "fi" ? fi : en);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { code: "method", message: "POST only" });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json(401, { code: "unauthorized", message: "Sign in again." });
    const uid = u.user.id;

    let body: { prompt?: string; image?: string; mediaType?: string; lang?: string };
    try { body = await req.json(); } catch { return json(400, { code: "bad_request", message: "Bad request" }); }
    const lang = body.lang === "fi" ? "fi" : "en";
    const types = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!body.prompt || body.prompt.length > 6000 || !body.image || body.image.length > 7_000_000 || !types.includes(body.mediaType ?? ""))
      return json(400, { code: "bad_request", message: "Bad request" });

    // limits
    const month = new Date().toISOString().slice(0, 7);
    const { data: p } = await admin.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    if (!p) return json(403, { code: "no_profile", message: "No profile." });
    const scansMonth = p.scan_month === month ? p.scans_month : 0;
    if (p.plan === "trial") {
      if (Date.now() > new Date(p.trial_start).getTime() + TRIAL_DAYS * 864e5)
        return json(403, { code: "trial_over", message: msg(lang, "Your free trial has ended.", "Ilmainen kokeilujaksosi on päättynyt.") });
      if (p.scans_trial >= TRIAL_SCANS)
        return json(429, { code: "scan_limit", message: msg(lang, "The free trial includes 10 receipt scans. Enter the details yourself.", "Ilmaiseen kokeiluun sisältyy 10 kuittiskannausta. Syötä tiedot itse.") });
    } else if (scansMonth >= MONTHLY_SCANS) {
      return json(429, { code: "scan_limit", message: msg(lang, "You have reached this month's limit of 100 receipt scans. Enter the details yourself.", "Kuukauden 100 kuittiskannauksen raja on täynnä. Syötä tiedot itse.") });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1500,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: body.mediaType, data: body.image } },
          { type: "text", text: body.prompt },
        ] }],
      }),
    });
    if (!r.ok) {
      console.error("anthropic", r.status, await r.text());
      return json(502, { code: "read_failed", message: "Reading failed" });
    }
    const out = await r.json();
    const text: string = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    let result: unknown = {};
    if (a >= 0 && b > a) { try { result = JSON.parse(text.slice(a, b + 1)); } catch { result = {}; } }

    // count the scan only after a successful read
    await admin.from("profiles").update(
      p.plan === "trial"
        ? { scans_trial: p.scans_trial + 1 }
        : { scan_month: month, scans_month: scansMonth + 1 },
    ).eq("user_id", uid);
    return json(200, { result });
  } catch (e) {
    console.error(e);
    return json(500, { code: "server", message: "Server error" });
  }
});
