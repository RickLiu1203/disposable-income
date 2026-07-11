-- Run this in the Supabase SQL Editor for the bdkqgaxeitzervjialdr project
-- (https://supabase.com/dashboard/project/bdkqgaxeitzervjialdr/sql/new).
-- The Supabase CLI isn't linked to this project yet, so this migration isn't
-- applied automatically — it's tracked here as the source of truth for the
-- schema, and future schema changes should be added as new migration files
-- alongside this one rather than edited in place.

create table models (
  model_name text primary key
);

create table events (
  event_ticker text primary key,
  series_ticker text not null,
  event_name text not null,
  sub_title text,
  competition text,
  open_time timestamptz,
  close_time timestamptz,
  status text,
  created_at timestamptz not null default now()
);

insert into models (model_name) values
  ('opus-4.8'),
  ('sonnet-5'),
  ('gpt-5.6-luna'),
  ('gemini-3.5-flash'),
  ('grok-4.5');
