# kuititon – Stripe setup

The app, database migration and three Edge Functions (`stripe-checkout`, `stripe-portal`, `stripe-webhook`) are already in place. What remains is configuration in Stripe and Supabase. Do everything in **Stripe test mode** first.

## 1. Stripe account
Create an account at stripe.com (business: Innotate, Finland). Complete business verification before going live.

## 2. Products and prices
Create two products, each with a monthly and a yearly recurring price (EUR, VAT included):

| Product | Monthly | Yearly |
|---|---|---|
| kuititon Business | 7,90 € | 79 € |
| kuititon Projects | 3,90 € | 39 € |

Set tax behavior to *Inclusive*. Enable Stripe Tax if you want VAT handled automatically. Copy the four price IDs (`price_...`).

## 3. Supabase secrets
Supabase → Edge Functions → Secrets. Add:

- `STRIPE_SECRET_KEY` (test key `sk_test_...` first)
- `STRIPE_WEBHOOK_SECRET` (from step 4)
- `STRIPE_PRICE_BUSINESS_MONTH`
- `STRIPE_PRICE_BUSINESS_YEAR`
- `STRIPE_PRICE_PROJECTS_MONTH`
- `STRIPE_PRICE_PROJECTS_YEAR`
- `APP_URL` (optional, defaults to https://app.kuititon.com)

## 4. Webhook
Stripe → Developers → Webhooks → Add endpoint:

- URL: `https://lffzbaftsewbxcejmevz.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

## 5. Customer portal
Stripe → Settings → Billing → Customer portal. Activate it and allow: cancel subscription, switch plan (add both products' prices), update payment method, invoice history.

## 6. Test
In the app: Asetukset → Tilaus → choose a plan, pay with card `4242 4242 4242 4242`, any future date and CVC. The plan should switch after returning to the app. Then try "Hallinnoi tilausta" (portal) and cancel.

## 7. Going live
Repeat steps 2–5 with live-mode keys and prices (replace the secrets), then re-test with a real card and refund it.

## Notes
- All three functions must have "Verify JWT with legacy secret" **off**.
- Soft-launch users can still be given free access by setting `profiles.plan` manually; a Stripe event for that user would overwrite it.
