-- kuititon: admin flag. Read-only for the app (clients only have select on profiles).
alter table public.profiles add column if not exists is_admin boolean not null default false;
-- make a user admin (replace the email):
-- update public.profiles set is_admin = true where user_id = (select id from auth.users where email = 'you@example.com');
