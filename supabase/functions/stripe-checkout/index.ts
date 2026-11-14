// kuititon: starts a Stripe Checkout session for the signed-in user.
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_BUSINESS_MONTH, STRIPE_PRICE_BUSINESS_YEAR,
//          STRIPE_PRICE_PROJECTS_MONTH, STRIPE_PRICE_PROJECTS_YEAR, APP_URL (default https://app.kuititon.com)
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

async function stripe(path: string, params: Record<string, string>) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: { authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("stripe " + r.status + " " + JSON.stringify(j.error ?? j));
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { code: "method" });
  try {
    if (!Deno.env.get("STRIPE_SECRET_KEY")) return json(503, { code: "not_configured" });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json(401, { code: "unauthorized" });
    const user = u.user;

    let body: { plan?: string; interval?: string; lang?: string };
    try { body = await req.json(); } catch { return json(400, { code: "bad_request" }); }
    const plan = body.plan === "projects" ? "projects" : body.plan === "business" ? "business" : "";
    const interval = body.interval === "year" ? "year" : body.interval === "month" ? "month" : "";
    if (!plan || !interval) return json(400, { code: "bad_request" });
    const price = Deno.env.get(`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`);
    if (!price) return json(503, { code: "not_configured" });

    const { data: p } = await admin.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
    if (!p) return json(403, { code: "no_profile" });
    // already has a live subscription: send them to the portal instead of creating a second one
    if (p.stripe_subscription_id && ["active", "trialing", "past_due"].includes(p.sub_status ?? "")) {
      return json(409, { code: "already_subscribed" });
    }

    let customer = p.stripe_customer_id as string | null;
    if (!customer) {
      const c = await stripe("customers", { email: user.email ?? "", "metadata[user_id]": user.id });
      customer = c.id as string;
      await admin.from("profiles").update({ stripe_customer_id: customer }).eq("user_id", user.id);
    }

    const app = (Deno.env.get("APP_URL") ?? "https://app.kuititon.com").replace(/\/$/, "");
    const s = await stripe("checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][user_id]": user.id,
      "subscription_data[metadata][plan]": plan,
      "subscription_data[metadata][interval]": interval,
      "metadata[user_id]": user.id,
      locale: body.lang === "en" ? "en" : "fi",
      allow_promotion_codes: "true",
      success_url: app + "/?checkout=success",
      cancel_url: app + "/?checkout=cancel",
    });
    return json(200, { url: s.url });
  } catch (e) {
    console.error(e);
    return json(500, { code: "server" });
  }
});
