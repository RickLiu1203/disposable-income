-- Run this in the Supabase SQL Editor for the bdkqgaxeitzervjialdr project,
-- after 20260711062939_create_events_and_models.sql and
-- 20260711064249_add_markets_and_history.sql have already been applied.
--
-- Adds the actual experiment layer on top of ingested Kalshi data: each
-- model in `models` gets a hypothetical $10 bankroll per event, places
-- `predictions` on that event's markets with reasoning attached, gets scored
-- by percent-change once the event settles (`model_event_results`), and a
-- real reward pot gets redistributed by rank across models — half by that
-- event's performance, half by lifetime performance (`event_payouts`).
--
-- Continues the LLM/MCP-parseability conventions from the previous
-- migration: comment on every table/column, real foreign keys, convenience
-- views for common reads. See "Supabase schema" in CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Let a prediction's market be validated against its event via a single
-- composite foreign key, instead of two independent single-column FKs that
-- could point at mismatched event/market pairs.
-- ---------------------------------------------------------------------------

alter table markets
  add constraint markets_ticker_event_ticker_key unique (ticker, event_ticker);

-- ---------------------------------------------------------------------------
-- predictions: one row per prediction a model places on a specific market
-- within an event. Settlement (see CLAUDE.md) fills in outcome/payout/
-- settled_at once Kalshi reports a result for the underlying market.
-- ---------------------------------------------------------------------------

create table predictions (
  id bigint generated always as identity primary key,
  model_name text not null references models (model_name),
  event_ticker text not null references events (event_ticker),
  market_ticker text not null,
  side text not null check (side in ('yes', 'no')),
  stake numeric not null check (stake > 0),
  entry_price numeric not null check (entry_price > 0 and entry_price < 1),
  justification text not null,
  outcome text not null default 'pending' check (outcome in ('pending', 'win', 'loss', 'void')),
  payout numeric,
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  foreign key (market_ticker, event_ticker) references markets (ticker, event_ticker)
);

create index predictions_model_event_idx on predictions (model_name, event_ticker);
create index predictions_market_ticker_idx on predictions (market_ticker);

comment on table predictions is
  'One row per prediction a model places on a specific market within an event, funded from that model''s $10 per-event bankroll. Settled by matching side against the market''s Kalshi result once available.';
comment on column predictions.model_name is
  'Model that placed this prediction. References models.model_name.';
comment on column predictions.event_ticker is
  'Event this prediction belongs to. References events.event_ticker.';
comment on column predictions.market_ticker is
  'Specific market (prop) within the event this prediction is on. Composite FK with event_ticker guarantees this market actually belongs to that event.';
comment on column predictions.side is
  'Which side of the market the model backed: ''yes'' or ''no''.';
comment on column predictions.stake is
  'Dollars from the model''s $10 per-event bankroll allocated to this prediction. Sum of a model''s stakes within one event must not exceed 10 — enforced by ingestion code, not the database.';
comment on column predictions.entry_price is
  'Price paid per contract at prediction time, 0-1 scale. Contracts bought = stake / entry_price.';
comment on column predictions.justification is
  'This specific prediction''s reasoning, as given by the model. For the model''s overall per-event strategy (as opposed to one prediction), see model_event_strategies.';
comment on column predictions.outcome is
  'pending until settlement. win/loss determined by comparing side to the market''s Kalshi result; void if the market was cancelled/never resolved (stake returned, no profit or loss).';
comment on column predictions.payout is
  'Dollars returned at settlement: stake/entry_price if win, stake if void, 0 if loss, null while pending.';
comment on column predictions.placed_at is
  'When this prediction was written (ingestion time).';
comment on column predictions.settled_at is
  'When this prediction''s outcome/payout were filled in by settlement. Null while pending.';

-- ---------------------------------------------------------------------------
-- model_event_results: aggregate bankroll performance per model per event.
-- percent_change is a generated column so it can never drift from the two
-- balances it's derived from.
-- ---------------------------------------------------------------------------

create table model_event_results (
  model_name text not null references models (model_name),
  event_ticker text not null references events (event_ticker),
  starting_balance numeric not null default 10 check (starting_balance = 10),
  ending_balance numeric,
  percent_change numeric generated always as (
    ((ending_balance - starting_balance) / starting_balance) * 100
  ) stored,
  primary key (model_name, event_ticker)
);

comment on table model_event_results is
  'One row per model per event: that model''s bankroll performance for the event, used for both the event leaderboard and the lifetime leaderboard.';
comment on column model_event_results.starting_balance is
  'Always 10 — every model starts each event with a $10 hypothetical bankroll.';
comment on column model_event_results.ending_balance is
  'Balance after all of this model''s predictions for the event are settled: 10 + sum(predictions.payout - predictions.stake). Null until every prediction for this model+event is no longer pending.';
comment on column model_event_results.percent_change is
  'Performance metric used for ranking: (ending_balance - starting_balance) / starting_balance * 100. This is what event_leaderboard, lifetime_leaderboard, and event_payouts all rank on — not raw dollar totals — so differing stake sizes across models/events stay comparable.';

-- ---------------------------------------------------------------------------
-- model_event_strategies: high-level per-event reasoning, separate from
-- per-prediction justification since it's written by the model as its
-- overall plan, not tied to any one prediction.
-- ---------------------------------------------------------------------------

create table model_event_strategies (
  model_name text not null references models (model_name),
  event_ticker text not null references events (event_ticker),
  strategy_notes text not null,
  created_at timestamptz not null default now(),
  primary key (model_name, event_ticker)
);

comment on table model_event_strategies is
  'One row per model per event: that model''s overall strategy/reasoning for the event as a whole, distinct from the per-prediction justification on individual predictions rows. Intended to be readable by other models as context for future events (peer learning).';
comment on column model_event_strategies.strategy_notes is
  'Free-text high-level strategy narrative for this model''s approach to this event.';

-- ---------------------------------------------------------------------------
-- event_payouts: the actual reward-pot distribution record, one row per
-- model per event. Ranks here are frozen at computation time via row_number()
-- (not the tie-allowing rank() used by the leaderboard views below), so the
-- linear-weight payout formula always gets a clean 1..n ranking and a later
-- event's results can never retroactively change what was already paid out.
-- ---------------------------------------------------------------------------

create table event_payouts (
  event_ticker text not null references events (event_ticker),
  model_name text not null references models (model_name),
  pot_total numeric not null,
  event_rank int not null,
  event_half_payout numeric not null,
  lifetime_rank int not null,
  lifetime_half_payout numeric not null,
  total_payout numeric generated always as (event_half_payout + lifetime_half_payout) stored,
  computed_at timestamptz not null default now(),
  primary key (event_ticker, model_name)
);

create index event_payouts_model_name_idx on event_payouts (model_name);

comment on table event_payouts is
  'Reward-pot distribution for one event, one row per participating model. pot_total = (number of models with a settled result this event) x $10, split into two equal halves distributed by inverse-rank linear weighting: half by this event''s rank, half by lifetime average-percent-change rank. Weight for rank i of n is (n - i + 1); payout = half-pot * weight / (n*(n+1)/2). A permanent record of what was actually paid — not recomputed retroactively as later events happen.';
comment on column event_payouts.pot_total is
  'Total reward pot for this event = participating model count x $10.';
comment on column event_payouts.event_rank is
  '1 = best percent_change in this event. Computed via row_number() with a deterministic tiebreak (percent_change desc, model_name asc), not rank(), so weights always sum correctly.';
comment on column event_payouts.event_half_payout is
  'This model''s share of the first half of the pot, from event_rank.';
comment on column event_payouts.lifetime_rank is
  '1 = best lifetime average percent_change as of this event''s settlement. A snapshot at computation time, not a live value — see table comment.';
comment on column event_payouts.lifetime_half_payout is
  'This model''s share of the second half of the pot, from lifetime_rank.';
comment on column event_payouts.total_payout is
  'event_half_payout + lifetime_half_payout — this model''s total reward for this event.';

-- ---------------------------------------------------------------------------
-- Convenience views.
-- ---------------------------------------------------------------------------

create view event_leaderboard as
select
  r.event_ticker,
  r.model_name,
  r.starting_balance,
  r.ending_balance,
  r.percent_change,
  rank() over (partition by r.event_ticker order by r.percent_change desc nulls last) as event_rank,
  (
    select count(*) from predictions p
    where p.model_name = r.model_name and p.event_ticker = r.event_ticker
  ) as prediction_count
from model_event_results r;

comment on view event_leaderboard is
  'Models ranked by percent_change within each event, for display. Uses rank() (ties allowed) — for the exact ranks money was actually divided on, see event_payouts instead.';

create view lifetime_leaderboard as
select
  r.model_name,
  count(*) as events_participated,
  avg(r.percent_change) as avg_percent_change,
  sum(coalesce(r.ending_balance, r.starting_balance) - r.starting_balance) as total_pnl,
  coalesce(
    (select sum(p.total_payout) from event_payouts p where p.model_name = r.model_name),
    0
  ) as total_rewards_earned,
  rank() over (order by avg(r.percent_change) desc) as lifetime_rank
from model_event_results r
where r.ending_balance is not null
group by r.model_name;

comment on view lifetime_leaderboard is
  'One row per model: overall standing across every settled event. avg_percent_change is the same metric used for the lifetime half of event_payouts. total_rewards_earned sums actual reward-pot payouts received across all events.';

create view event_overall_performance as
select
  event_ticker,
  count(*) as models_participated,
  avg(percent_change) as avg_percent_change,
  min(percent_change) as worst_percent_change,
  max(percent_change) as best_percent_change,
  sum(starting_balance) as combined_starting_balance,
  sum(ending_balance) as combined_ending_balance
from model_event_results
where ending_balance is not null
group by event_ticker;

comment on view event_overall_performance is
  'All models combined, per event: how the group as a whole performed, not any single model. Useful for "was this event easy/hard to predict overall" style questions.';
