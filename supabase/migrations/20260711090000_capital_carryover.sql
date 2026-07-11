-- Run this in the Supabase SQL Editor for the bdkqgaxeitzervjialdr project,
-- after 20260711080000_fractional_contract_volumes.sql has already been
-- applied.
--
-- Switches model bankrolls from a fixed $10-per-event reset to a
-- continuously-compounding pool: models.current_balance is the single
-- source of truth for a model's live spendable capital, seeded once as
-- model_event_results.starting_balance the first time that model
-- participates in a given event, and updated by computeEventPayouts()
-- (backend/src/kalshi/kalshiSettle.ts) after each event settles, so a
-- model's reward-pot payout becomes its starting bankroll for whatever
-- event it plays next. See "Supabase schema" in CLAUDE.md.

-- ---------------------------------------------------------------------------
-- models.current_balance: single source of truth for a model's live
-- spendable capital. New models (and the 5 already seeded) bootstrap at 10;
-- thereafter this is only ever updated by computeEventPayouts().
-- ---------------------------------------------------------------------------

alter table models
  add column current_balance numeric not null default 10 check (current_balance >= 0);

comment on table models is
  'One row per LLM being evaluated on prediction-market events. current_balance is that model''s live spendable capital, carried over event to event via event_payouts redistribution rather than reset to a fixed bankroll each time.';
comment on column models.current_balance is
  'This model''s current available capital, updated by computeEventPayouts() after each event''s payouts are computed. Starts at 10 for a new model with no settled event history; thereafter it equals that model''s most recent event_payouts.total_payout (event_half_payout + lifetime_half_payout). Ingestion code should read this before staking new predictions; model_event_results.starting_balance for a model''s next event is seeded from this value the first time that model''s row for that event is created.';

-- ---------------------------------------------------------------------------
-- model_event_results.starting_balance: was pinned to exactly 10. Now it's
-- a per-model, per-event snapshot of models.current_balance taken once (by
-- recomputeModelEventResult() on first insert for that model+event) and
-- never overwritten afterward — dropping the default forces application
-- code to always supply it explicitly, so a forgotten value fails loudly
-- (not-null violation) instead of silently defaulting back to $10.
-- ---------------------------------------------------------------------------

alter table model_event_results
  drop constraint model_event_results_starting_balance_check;
alter table model_event_results
  alter column starting_balance drop default;
alter table model_event_results
  add constraint model_event_results_starting_balance_check check (starting_balance >= 0);

comment on column model_event_results.starting_balance is
  'This model''s available capital at the start of this event: models.current_balance at the moment this row was first created (carried over from the payout of this model''s prior settled event), or 10 if this is the model''s first event ever. Set once on first insert by recomputeModelEventResult() and never modified afterward — later recompute calls for the same model+event only touch ending_balance.';
comment on column model_event_results.ending_balance is
  'Balance after all of this model''s predictions for the event are settled: starting_balance + sum(predictions.payout - predictions.stake). Null until every prediction for this model+event is no longer pending.';

-- ---------------------------------------------------------------------------
-- predictions: bankroll language updated to reflect that the per-event
-- budget is no longer a fixed $10.
-- ---------------------------------------------------------------------------

comment on table predictions is
  'One row per prediction a model places on a specific market within an event, funded from that model''s current per-event bankroll (model_event_results.starting_balance for that model+event — carried over from its prior event''s payout, not a fixed $10). Settled by matching side against the market''s Kalshi result once available.';
comment on column predictions.stake is
  'Dollars from the model''s per-event bankroll (model_event_results.starting_balance for this model+event) allocated to this prediction. Sum of a model''s stakes within one event must not exceed that event''s starting_balance — enforced by ingestion code, not the database.';

-- ---------------------------------------------------------------------------
-- event_payouts: pot_total now reflects the group's actual combined capital
-- rather than a fixed count x $10, and total_payout is written back to
-- models.current_balance immediately after computation.
-- ---------------------------------------------------------------------------

comment on table event_payouts is
  'Reward-pot distribution for one event, one row per participating model. pot_total = sum of participating models'' ending_balance for this event (the group''s combined capital going into redistribution), split into two equal halves distributed by inverse-rank linear weighting: half by this event''s rank, half by lifetime average-percent-change rank. Weight for rank i of n is (n - i + 1); payout = half-pot * weight / (n*(n+1)/2) — zero-sum by construction, sum(total_payout) over an event''s participants always equals pot_total. Each participating model''s total_payout is written back to models.current_balance immediately after this event settles, becoming that model''s starting_balance for whatever event it participates in next. A permanent record of what was actually paid — not recomputed retroactively as later events happen.';
comment on column event_payouts.pot_total is
  'Total reward pot for this event = sum of participating models'' ending_balance (their combined capital carried into this redistribution) — a continuously-compounding pool, not a fixed count x $10.';
comment on column event_payouts.total_payout is
  'event_half_payout + lifetime_half_payout — this model''s total reward for this event, and (written by computeEventPayouts()) this model''s new models.current_balance immediately after this event settles, which becomes its starting_balance for its next event.';

-- ---------------------------------------------------------------------------
-- View comments: clarify how carry-over changes what these numbers mean.
-- No view SQL changes — all three already read starting_balance/
-- ending_balance/percent_change/total_payout generically.
-- ---------------------------------------------------------------------------

comment on view lifetime_leaderboard is
  'One row per model: overall standing across every settled event. avg_percent_change is the same metric used for the lifetime half of event_payouts. total_pnl is this model''s raw dollar gain/loss from its own predictions (ending_balance - starting_balance, summed) and total_rewards_earned sums actual reward-pot payouts received (event_payouts.total_payout) across all events — now that starting_balance varies per model with carried-over capital instead of a flat $10, these two totals diverge more meaningfully than before (a model can post strong total_pnl from good calls but a smaller total_rewards_earned if it still ranks low relative to peers each event, or vice versa).';
comment on view event_overall_performance is
  'All models combined, per event: how the group as a whole performed, not any single model. Useful for "was this event easy/hard to predict overall" style questions. combined_starting_balance equals the prior event''s pot_total for the same set of participants (capital carries over via event_payouts, not a fixed per-model amount); combined_ending_balance is this event''s own pot_total feeding the next redistribution.';
