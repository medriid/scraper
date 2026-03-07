-- Scrapex — Teams + Rate Limiting (migration 003)
-- Run this after 001_init.sql and 002_users.sql

-- ─── Per-user rate limiting columns on users ──────────────────────────────────
alter table public.users
  add column if not exists daily_prompts_used integer not null default 0,
  add column if not exists last_prompt_date date;

-- ─── Teams ────────────────────────────────────────────────────────────────────
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists teams_owner_id_idx on public.teams (owner_id);

alter table public.teams enable row level security;

-- Service role has full access
create policy "service_role full access on teams"
  on public.teams
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- Owners can manage their own teams
create policy "team owners full access"
  on public.teams
  as permissive
  for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Members can view teams they belong to
create policy "team members can view"
  on public.teams
  as permissive
  for select
  to authenticated
  using (
    id in (
      select team_id from public.team_members where user_id = auth.uid()
    )
  );

-- ─── Team Members ─────────────────────────────────────────────────────────────
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(team_id, user_id)
);

create index if not exists team_members_team_id_idx on public.team_members (team_id);
create index if not exists team_members_user_id_idx on public.team_members (user_id);

alter table public.team_members enable row level security;

-- Service role has full access
create policy "service_role full access on team_members"
  on public.team_members
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- Team owners can manage members
create policy "team owners manage members"
  on public.team_members
  as permissive
  for all
  to authenticated
  using (
    team_id in (
      select id from public.teams where owner_id = auth.uid()
    )
  )
  with check (
    team_id in (
      select id from public.teams where owner_id = auth.uid()
    )
  );

-- Members can view their own membership rows
create policy "members view own membership"
  on public.team_members
  as permissive
  for select
  to authenticated
  using (user_id = auth.uid());
