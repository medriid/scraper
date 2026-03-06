-- AI Scraper — Supabase schema
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)

create table if not exists public.scraper_sessions (
  id uuid primary key default gen_random_uuid(),
  website_url text not null,
  instructions text not null,
  model_id text not null,
  suggested_schema jsonb,
  refined_prompt text,
  generated_api_file text,
  agent_log jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for recent sessions query
create index if not exists scraper_sessions_created_at_idx
  on public.scraper_sessions (created_at desc);

-- Enable RLS (Row Level Security)
alter table public.scraper_sessions enable row level security;

-- Allow service role full access (used by the server)
create policy "service_role full access"
  on public.scraper_sessions
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- Optional: allow anon read for the history endpoint
-- Remove this if you want sessions to be private
create policy "anon read"
  on public.scraper_sessions
  as permissive
  for select
  to anon
  using (true);
