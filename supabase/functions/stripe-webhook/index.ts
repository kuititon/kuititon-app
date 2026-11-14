// kuititon: receives Stripe events and keeps the user's plan in step with their subscription.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Stripe endpoint: https://<project>.supabase.co/functions/v1/stripe-webhook
//   events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted
import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// Stripe-Signature: t=timestamp,v1=hmac_sha256(secret, `${t}.${payload}`)
export async function verifyStripe(payload: string, header: string, secret: string, toleranceSec = 300, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const sigs = header.split(",").map((p) => p.trim()).filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts["t"]);
  if (!t || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`)));
  return sigs.some((s) => s.length === mac.length && s.split("").reduce((d, c, i) => d | (c.charCodeAt(0) ^ mac.charCodeAt(i)), 0) === 0);
}

// maps a Stripe subscription object onto the profile columns
// prices maps a Stripe price id to its plan, e.g. { price_123: "business" }; it wins over the checkout metadata,
// so a plan change made in the customer portal is picked up too
export function profileFromSubscription(sub: any, prices: Record<string, string> = {}) {
  const live = ["active", "trialing", "past_due"].includes(sub.status);
  const item = sub.items?.data?.[0];
  const byPrice = prices[item?.price?.id ?? item?.plan?.id ?? ""];
  const meta = sub.metadata?.plan;
  const plan = byPrice === "projects" || byPrice === "business" ? byPrice : meta === "projects" ? "projects" : meta === "business" ? "business" : null;
  const interval = item?.plan?.interval ?? item?.price?.recurring?.interval ?? sub.metadata?.interval ?? null;
  const end = sub.current_period_end ?? item?.current_period_end ?? null;
  return {
    ...(live && plan ? { plan } : {}),
    ...(!live ? { plan: "trial" } : {}),
    stripe_subscription_id: live ? sub.id : null,
    sub_status: sub.status,
    sub_interval: live ? interval : null,
    sub_period_end: live && end ? new Date(end * 1000).toISOString() : null,
    sub_cancel_at_end: live ? !!sub.cancel_at_period_end || !!sub.cancel_at : false,
  };
}

function priceMap() {
  const m: Record<string, string> = {};
  for (const p of ["BUSINESS", "PROJECTS"]) for (const i of ["MONTH", "YEAR"]) {
    const id = Deno.env.get(`STRIPE_PRICE_${p}_${i}`);
    if (id) m[id] = p.toLowerCase();
  }
  return m;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("not configured", { status: 503 });
  const payload = await req.text();
  if (!(await verifyStripe(payload, req.headers.get("stripe-signature") ?? "", secret))) {
    return new Response("bad signature", { status: 400 });
  }
  try {
    const event = JSON.parse(payload);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const obj = event.data?.object;

    if (event.type === "checkout.session.completed" && obj?.mode === "subscription") {
      const uid = obj.client_reference_id || obj.metadata?.user_id;
      if (uid && obj.customer) await admin.from("profiles").update({ stripe_customer_id: obj.customer }).eq("user_id", uid);
      // the subscription event carries the plan; fetch it now so the app updates without waiting
      if (uid && obj.subscription) {
        const r = await fetch("https://api.stripe.com/v1/subscriptions/" + obj.subscription, {
          headers: { authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY") },
        });
        if (r.ok) await admin.from("profiles").update(profileFromSubscription(await r.json(), priceMap())).eq("user_id", uid);
      }
    } else if (event.type?.startsWith("customer.subscription.")) {
      const uid = obj.metadata?.user_id;
      const patch = event.type === "customer.subscription.deleted" ? profileFromSubscription({ ...obj, status: "canceled" }, priceMap()) : profileFromSubscription(obj, priceMap());
      const q = admin.from("profiles").update(patch);
      const { error } = uid ? await q.eq("user_id", uid) : await q.eq("stripe_customer_id", obj.customer);
      if (error) { console.error("profile update failed", JSON.stringify(error)); return new Response("db error", { status: 500 }); }
    }
    return new Response(JSON.stringify({ received: true }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
