-- Run this in the Supabase SQL Editor for the bdkqgaxeitzervjialdr project,
-- after 20260711130000_agent_pipeline.sql has already been applied.
--
-- Backs the server-side live-value poller (backend/src/agent/valuePoller.ts):
-- every 10 minutes, for each consolidated event that (a) has started per its
-- Kalshi-sourced open_time, (b) has at least one prediction placed, and (c)
-- still has at least one pending prediction, the poller live-fetches Kalshi
-- for that event's markets and writes one row per model here with that
-- model's current mark-to-market bankroll for the event (real settled
-- payouts for predictions that have already resolved, live estimated payout
-- for predictions still pending). This is what lets an event's "how has
-- each model's bet moved" chart keep working after you've left the page and
-- come back, instead of only reflecting whatever was on screen at the time.

create table model_event_value_snapshots (
  model_name text not null references models (model_name) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  snapshot_ts timestamptz not null default now(),
  unrealized_balance numeric not null,
  primary key (model_name, event_id, snapshot_ts)
);

create index model_event_value_snapshots_event_id_idx on model_event_value_snapshots (event_id);

comment on table model_event_value_snapshots is
  'Time-series of each model''s live mark-to-market bankroll for a consolidated event, written every ~10 minutes by the server-side value poller while the event is live (started, has bets, not fully settled). Lets a per-event "value over time" chart survive navigating away and back, unlike a purely on-demand live computation. Distinct from model_event_results.ending_balance, which is the one true final value written once at settlement -- this table is a running estimate that stops updating (but is not deleted) once the event settles.';
comment on column model_event_value_snapshots.model_name is
  'Model this snapshot belongs to. References models.model_name.';
comment on column model_event_value_snapshots.event_id is
  'Consolidated event this snapshot belongs to. References events.id.';
comment on column model_event_value_snapshots.snapshot_ts is
  'When this snapshot was captured (poll time, not any Kalshi-reported timestamp).';
comment on column model_event_value_snapshots.unrealized_balance is
  'This model''s estimated bankroll for the event as of snapshot_ts: starting_balance + sum across all of the model''s predictions in this event of (payout - stake) for already-settled predictions, plus (live mark-to-market value - stake) for predictions still pending. Live mark-to-market value for a pending prediction is stake * current_side_price / entry_price, i.e. what the position would be worth if cashed out at the current live Kalshi price instead of waiting for settlement.';
