-- kuititon: Supabase setup, step 1. Safe to run more than once (it rebuilds the kuititon tables from scratch).
-- WARNING: this deletes everything in public.docs and public.profiles first. Fine for a new, empty project.

drop trigger if exists docs_account_limits on public.docs;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.enforce_account_limits();
drop function if exists public.handle_new_user();
drop table if exists public.docs cascade;
drop table if exists public.profiles cascade;
drop policy if exists "receipts: own folder, read" on storage.objects;
drop policy if exists "receipts: own folder, insert" on storage.objects;
drop policy if exists "receipts: own folder, update" on storage.objects;
drop policy if exists "receipts: own folder, delete" on storage.objects;

-- Everything is closed by default: only signed-in users, and only their own rows.

-- 1. App data. One row per document, mirroring how the app already stores data
--    (settings, clients, invoices, receipts, account list).
create table public.docs (
  owner      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  path       text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (owner, path)
);
create index docs_path_idx on public.docs (owner, path text_pattern_ops);
alter table public.docs enable row level security;
alter table public.docs replica identity full;

create policy "docs: own rows, read"   on public.docs for select to authenticated using (owner = auth.uid());
create policy "docs: own rows, insert" on public.docs for insert to authenticated with check (owner = auth.uid());
create policy "docs: own rows, update" on public.docs for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "docs: own rows, delete" on public.docs for delete to authenticated using (owner = auth.uid());

revoke all on public.docs from anon, authenticated;
grant select, insert, update, delete on public.docs to authenticated;

-- 2. Plan, trial and scan counter. Users can read their row but never change it;
--    only the server (Stripe webhook, receipt-reading function) writes here.
create table public.profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  plan           text        not null default 'trial' check (plan in ('trial','business','projects')),
  trial_start    timestamptz not null default now(),
  scan_month     text        not null default to_char(now(), 'YYYY-MM'),
  scans_month    integer     not null default 0,
  scans_trial    integer     not null default 0,
  created_at     timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles: read own" on public.profiles for select to authenticated using (user_id = auth.uid());
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Create the profile row automatically when someone signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Account limits, enforced on the server.
--    trial: 1 business + 1 project | business plan: 1 business + 3 projects | projects plan: 3 projects
create function public.enforce_account_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p text; max_biz int; max_proj int;
  new_biz int; new_proj int; old_biz int := 0; old_proj int := 0;
begin
  if new.path <> 'meta/accounts' then return new; end if;
  select plan into p from public.profiles where user_id = new.owner;
  p := coalesce(p, 'trial');
  if p = 'projects' then max_biz := 0; max_proj := 3;
  elsif p = 'business' then max_biz := 1; max_proj := 3;
  else max_biz := 1; max_proj := 1; end if;

  select count(*) filter (where coalesce(e->>'type','account') = 'account'),
         count(*) filter (where e->>'type' = 'project')
    into new_biz, new_proj
    from jsonb_array_elements(coalesce(new.data->'list','[]'::jsonb)) e;

  if tg_op = 'UPDATE' then
    select count(*) filter (where coalesce(e->>'type','account') = 'account'),
           count(*) filter (where e->>'type' = 'project')
      into old_biz, old_proj
      from jsonb_array_elements(coalesce(old.data->'list','[]'::jsonb)) e;
  end if;

  if new_biz > max_biz and new_biz > old_biz then
    raise exception 'ACCOUNT_LIMIT_BUSINESS' using errcode = 'P0001';
  end if;
  if new_proj > max_proj and new_proj > old_proj then
    raise exception 'ACCOUNT_LIMIT_PROJECT' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_account_limits() from public, anon, authenticated;
create trigger docs_account_limits before insert or update on public.docs
  for each row execute function public.enforce_account_limits();

-- 4. Live updates for the app.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

-- Profiles for anyone who already signed up before this script ran.
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;

-- 5. Private file storage for receipt photos and PDFs. Each user only sees their own folder (<user id>/...).
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;
create policy "receipts: own folder, read"   on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: own folder, insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: own folder, update" on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: own folder, delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- The Edge Function (service_role) reads and updates profiles
grant usage on schema public to service_role;
grant all on public.profiles to service_role;
grant all on public.docs to service_role;
