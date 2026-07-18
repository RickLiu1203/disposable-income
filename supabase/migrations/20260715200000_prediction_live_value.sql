-- Run this in the Supabase SQL Editor for the bdkqgaxeitzervjialdr project,
-- after 20260714160000_match_start_time.sql has already been applied.
--
-- The frontend's per-prediction "current value" display used to be
-- recomputed independently in the browser from GET /events/market-snapshot's
-- price (see frontend-v2/src/lib/predictionValue.ts), which is a *different*
-- read path than the one backing the model-list/chart numbers
-- (model_event_value_snapshots, written by the value poller). The two could
-- silently disagree whenever market_price_history lagged behind the
-- poller's own live Kalshi fetch for that cycle. These columns let the
-- poller persist the exact per-prediction number it already computes while
-- building each model's unrealized_balance, so the frontend can read it
-- directly instead of re-deriving a second, potentially-stale estimate.

alter table predictions
  add column live_value numeric,
  add column live_value_as_of timestamptz;

comment on column predictions.live_value is
  'Live mark-to-market dollar value of this prediction as of live_value_as_of, written by the value poller (backend/src/agent/valuePoller.ts) on the same cycle -- and from the same live Kalshi fetch -- as the model''s aggregate model_event_value_snapshots row. Null until the poller runs at least once for this prediction''s event. Only meaningful while outcome = ''pending''; once settled, payout is the real, final number.';
comment on column predictions.live_value_as_of is
  'When live_value was last written. Null until the poller runs at least once for this prediction''s event.';
