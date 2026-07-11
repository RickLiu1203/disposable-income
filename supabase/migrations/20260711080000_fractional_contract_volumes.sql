-- Run this in the Supabase SQL Editor for the bdkqgaxeitzervjialdr project,
-- after 20260711072333_add_predictions_and_payouts.sql has already been
-- applied.
--
-- Kalshi has moved to fractional-contract trading: markets/candlesticks now
-- report volume/open_interest only via the "_fp" fields (e.g. volume_fp,
-- open_interest_fp), which come back as non-integer numbers (observed e.g.
-- 6014.27, 16072519.66) — the old integer volume/open_interest fields are
-- always null now. toCompactBundle() in kalshiEvents.ts already reads from
-- the _fp fields via parseNum(), so CompactMarket.volume/volume_24h/
-- open_interest and CompactPricePoint.volume/open_interest are floats, not
-- integers. The bigint columns below can't hold that — discovered when
-- POST /kalshi/add-event (backend/src/kalshi/kalshiIngest.ts) failed
-- inserting a real event's markets. Widen to numeric (matching yes_price/
-- yes_bid/yes_ask's existing type) rather than truncating to preserve what
-- Kalshi actually reports.

-- event_summary selects markets.volume/volume_24h/open_interest directly, so
-- Postgres blocks the type change while the view's rule still references
-- those columns at their old type. Drop and recreate around the alter.
drop view event_summary;

alter table markets
  alter column volume type numeric,
  alter column volume_24h type numeric,
  alter column open_interest type numeric;

alter table market_price_history
  alter column volume type numeric,
  alter column open_interest type numeric;

create view event_summary as
select
  e.event_ticker,
  e.event_name,
  e.sub_title,
  e.competition,
  e.competition_scope,
  e.status as event_status,
  e.open_time as event_open_time,
  e.close_time as event_close_time,
  m.ticker as market_ticker,
  m.label as market_label,
  m.status as market_status,
  m.result as market_result,
  m.yes_price,
  m.yes_bid,
  m.yes_ask,
  m.volume,
  m.volume_24h,
  m.open_interest
from events e
join markets m on m.event_ticker = e.event_ticker;

comment on view event_summary is
  'One row per market, flattened with its parent event''s details and current price snapshot. Use this instead of manually joining events + markets for "what are the current odds on this match" style questions.';

comment on column markets.volume is
  'Total number of contracts traded on this market up to ingestion time. Numeric (not integer): Kalshi reports this via fractional-contract fields (volume_fp), so this can be a non-whole number.';
comment on column markets.volume_24h is
  'Number of contracts traded in the 24 hours before ingestion time. Numeric (not integer) for the same fractional-contract reason as markets.volume.';
comment on column markets.open_interest is
  'Number of contracts currently open (not yet settled/closed) at ingestion time. Numeric (not integer) for the same fractional-contract reason as markets.volume.';
comment on column market_price_history.volume is
  'Contracts traded during this bucket. Numeric (not integer) for the same fractional-contract reason as markets.volume.';
comment on column market_price_history.open_interest is
  'Open interest as of the end of this bucket. Numeric (not integer) for the same fractional-contract reason as markets.volume.';
