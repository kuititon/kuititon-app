// kuititon: opens the Stripe customer portal (change plan, cancel, update card, receipts) for the signed-in user.
// Secrets: STRIPE_SECRET_KEY, APP_URL (default https://app.kuititon.com)
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { code: "method" });
  try {
    if (!Deno.env.get("STRIPE_SECRET_KEY")) return json(503, { code: "not_configured" });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json(401, { code: "unauthorized" });
    const { data: p } = await admin.from("profiles").select("stripe_customer_id").eq("user_id", u.user.id).maybeSingle();
    if (!p?.stripe_customer_id) return json(404, { code: "no_customer" });

    const app = (Deno.env.get("APP_URL") ?? "https://app.kuititon.com").replace(/\/$/, "");
    const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY"), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer: p.stripe_customer_id, return_url: app + "/?checkout=portal" }),
    });
    const j = await r.json();
    if (!r.ok) { console.error("stripe portal", r.status, JSON.stringify(j.error ?? j)); return json(502, { code: "portal_failed" }); }
    return json(200, { url: j.url });
  } catch (e) {
    console.error(e);
    return json(500, { code: "server" });
  }
});
