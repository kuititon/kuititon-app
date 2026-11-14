-- kuititon: admin flag. Read-only for the app (clients only have select on profiles).
alter table public.profiles add column if not exists is_admin boolean not null default false;
-- make a user admin (replace the email):
-- update public.profiles set is_admin = true where user_id = (select id from auth.users where email = 'you@example.com');

-- Admin-only plan switcher for testing (used by the Developer section in Settings).
create or replace function public.admin_set_plan(p_plan text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_admin) then
    raise exception 'not allowed';
  end if;
  if p_plan in ('business','projects') then
    update public.profiles set plan = p_plan where user_id = auth.uid();
  elsif p_plan = 'trial' then
    update public.profiles set plan = 'trial', trial_start = now(), scans_trial = 0 where user_id = auth.uid();
  elsif p_plan = 'none' then
    update public.profiles set plan = 'trial', trial_start = now() - interval '31 days' where user_id = auth.uid();
  else
    raise exception 'bad plan';
  end if;
end $$;
revoke all on function public.admin_set_plan(text) from public, anon;
grant execute on function public.admin_set_plan(text) to authenticated;
