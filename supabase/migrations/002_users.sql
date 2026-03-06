-- Scrapex — Users schema (migration 002)
-- Run this in your Supabase SQL editor after 001_init.sql

-- Public user profiles (extends Supabase Auth users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for lookups
create index if not exists users_email_idx on public.users (email);

-- Enable RLS
alter table public.users enable row level security;

-- Service role has full access
create policy "service_role full access on users"
  on public.users
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- Users can read their own profile
create policy "users read own profile"
  on public.users
  as permissive
  for select
  to authenticated
  using (auth.uid() = id);

-- Users can update their own profile (but not is_owner)
create policy "users update own profile"
  on public.users
  as permissive
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Allow new users to insert their own profile row on sign-up
create policy "users insert own profile"
  on public.users
  as permissive
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Trigger: auto-create user profile on Supabase Auth sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Add user_id FK to scraper_sessions (nullable for backwards compat)
alter table public.scraper_sessions
  add column if not exists user_id uuid references public.users(id) on delete set null;

create index if not exists scraper_sessions_user_id_idx
  on public.scraper_sessions (user_id);

-- Policy: authenticated users can see only their own sessions
create policy "users read own sessions"
  on public.scraper_sessions
  as permissive
  for select
  to authenticated
  using (user_id = auth.uid());

-- Policy: authenticated users can insert sessions for themselves
create policy "users insert own sessions"
  on public.scraper_sessions
  as permissive
  for insert
  to authenticated
  with check (user_id = auth.uid());
