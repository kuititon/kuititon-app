-- Stripe subscription columns (run once; safe to re-run)
alter table public.profiles add column if not exists stripe_customer_id     text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists sub_status             text;        -- active, trialing, past_due, canceled ...
alter table public.profiles add column if not exists sub_interval           text;        -- month | year
alter table public.profiles add column if not exists sub_period_end         timestamptz; -- end of the paid period (renewal date)
alter table public.profiles add column if not exists sub_cancel_at_end      boolean not null default false;
create unique index if not exists profiles_stripe_customer_idx on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
