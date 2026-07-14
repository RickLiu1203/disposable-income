-- Run this in the Supabase SQL Editor for the bdkqgaxeitzervjialdr project,
-- after 20260711120000_top_3_and_previous_3.sql has already been applied.
--
-- Supports the agent decision pipeline (see CLAUDE.md "Agent decision
-- pipeline" routes and backend/prediction-market-agent-system-prompt.md):
-- a one-sentence strategy headline alongside the existing full strategy
-- notes, and a traceability table recording which of the 9 pipeline steps
-- a model actually performed for a given event, in run order.

-- ---------------------------------------------------------------------------
-- model_event_strategies.strategy_headline: a one-sentence thesis the model
-- writes alongside its existing full strategy_notes, surfaced by
-- GET /agent/leaderboard and GET /agent/past-performance instead of the
-- fuller notes. Nullable: rows written before this migration have no
-- headline, and endpoints reading this column must treat null gracefully
-- rather than as an error.
-- ---------------------------------------------------------------------------

alter table model_event_strategies
  add column strategy_headline text;

comment on column model_event_strategies.strategy_headline is
  'One-sentence thesis for this model''s strategy on this event, distinct from the fuller strategy_notes. Nullable: rows written before this migration have no headline; endpoints must handle that gracefully, not treat it as an error.';

-- ---------------------------------------------------------------------------
-- model_event_pipeline_steps: one row per pipeline step a model actually
-- performed for an event, in run order. This is the traceability record
-- called for in CLAUDE.md's "Next steps" (no viewer is built for it here --
-- it's meant to be queried directly via SQL/Supabase MCP for audit).
-- ---------------------------------------------------------------------------

create table model_event_pipeline_steps (
  model_name text not null references models (model_name) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  step_order integer not null,
  step_name text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  primary key (model_name, event_id, step_order)
);

comment on table model_event_pipeline_steps is
  'Traceability record of the agent decision pipeline: one row per step a model actually performed for an event, in run order. Written by POST /predictions/place from the caller-supplied pipeline_trace array. Queryable directly via SQL/Supabase MCP for audit -- no UI is built for this table.';
comment on column model_event_pipeline_steps.model_name is 'Model that performed this pipeline step.';
comment on column model_event_pipeline_steps.event_id is 'Reference to the parent consolidated event this step''s research was for.';
comment on column model_event_pipeline_steps.step_order is 'Position of this step within the model''s pipeline run for this event (1-8, matching the numbered steps in CLAUDE.md; step 9 -- POST /predictions/place itself -- is not logged as a row here since it is the write that creates these rows).';
comment on column model_event_pipeline_steps.step_name is 'Short name of the pipeline step, e.g. "fetch_bankroll", "search_web_forum".';
comment on column model_event_pipeline_steps.summary is 'The model''s own summary of what it found or did during this step.';
comment on column model_event_pipeline_steps.created_at is 'Timestamp this step was logged (at POST /predictions/place submission time, not necessarily when the step was actually performed).';
