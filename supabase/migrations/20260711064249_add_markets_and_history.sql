-- Run this in the Supabase SQL Editor for the bdkqgaxeitzervjialdr project,
-- after 20260711062939_create_events_and_models.sql has already been applied.
--
-- This migration assumes all ingestion writes come from the COMPACT Kalshi
-- bundle (toCompactBundle() in backend/src/kalshi/kalshiEvents.ts,
-- GET /kalshi/event-bundle?...&compact=true), not the raw bundle. That's why
-- market_price_history stores one `price` per bucket instead of full
-- open/high/low/close for price/yes_bid/yes_ask — the compact bundle only
-- ever gives you a close-style price per bucket, so extra OHLC columns would
-- just be permanently-null dead weight. If raw-bundle ingestion is ever
-- added later, that's a new migration, not a rewrite of this one.
--
-- This schema is designed to be read by LLMs through a (read-only) Supabase
-- MCP connection, not just by application code — see "Supabase schema" in
-- CLAUDE.md for the conventions this follows (comments on every
-- table/column, real foreign keys, convenience views for common joins).

-- ---------------------------------------------------------------------------
-- events / models: retrofit comments, add the one compact-bundle field
-- (competition_scope) that migration 1 missed.
-- ---------------------------------------------------------------------------

alter table events add column competition_scope text;

comment on table events is
  'One row per Kalshi prediction-market event (e.g. one sports match or one real-world occurrence). Populated once at ingestion time from the compact Kalshi event bundle; not updated afterward.';
comment on column events.event_ticker is
  'Kalshi''s own event identifier, used as the primary key (e.g. KXWCADVANCE-26JUL11NORENG). Pass this back to Kalshi''s /events/{event_ticker} to refetch live data.';
comment on column events.series_ticker is
  'Kalshi''s series identifier for the competition this event belongs to (e.g. all matches in a tournament share one series_ticker). Required to call Kalshi''s per-series candlestick/forecast endpoints.';
comment on column events.event_name is
  'Human-readable event title, e.g. "Chelsea vs PSG winner".';
comment on column events.sub_title is
  'Shorter/secondary title Kalshi shows alongside event_name, when present.';
comment on column events.competition is
  'Competition name, e.g. "FIFA Club World Cup".';
comment on column events.competition_scope is
  'Scope of the competition, e.g. "international" vs "club". From the compact bundle''s event.competition_scope.';
comment on column events.open_time is
  'Earliest open_time across this event''s markets — when trading on this event first became possible. Computed by the app at ingestion, not a raw Kalshi field.';
comment on column events.close_time is
  'Latest close_time across this event''s markets — when trading on this event fully stopped. Computed by the app at ingestion, not a raw Kalshi field.';
comment on column events.status is
  'App-assigned lifecycle marker for the event (e.g. open/closed/settled), derived from its markets'' statuses at ingestion time — not a raw Kalshi passthrough field.';
comment on column events.created_at is
  'When this row was written to Supabase (ingestion time), not when the Kalshi event itself was created.';

comment on table models is
  'One row per LLM being evaluated against Kalshi prediction-market events. Static reference list, not written to by ingestion.';
comment on column models.model_name is
  'Identifier for the model, e.g. opus-4.8, sonnet-5, gpt-5.6-luna, gemini-3.5-flash, grok-4.5.';

-- ---------------------------------------------------------------------------
-- markets: one row per Kalshi market nested under an event.
-- Column set matches CompactMarket in kalshiEvents.ts exactly.
-- ---------------------------------------------------------------------------

create table markets (
  ticker text primary key,
  event_ticker text not null references events (event_ticker),
  label text,
  status text,
  result text,
  yes_price numeric,
  yes_bid numeric,
  yes_ask numeric,
  volume bigint,
  volume_24h bigint,
  open_interest bigint,
  open_time timestamptz,
  close_time timestamptz,
  rules text,
  created_at timestamptz not null default now()
);

create index markets_event_ticker_idx on markets (event_ticker);

comment on table markets is
  'One row per Kalshi market nested under an event (e.g. one specific yes/no question within a match). Snapshot as of ingestion time — prices/volume/open_interest here are NOT kept live-updated; time-series movement lives in market_price_history.';
comment on column markets.ticker is
  'Kalshi''s own market identifier, primary key (e.g. an event_ticker + suffix).';
comment on column markets.event_ticker is
  'Parent event this market belongs to. References events.event_ticker.';
comment on column markets.label is
  'Short human-readable label for this specific market, e.g. "Chelsea" for a moneyline market''s yes_sub_title.';
comment on column markets.status is
  'Market lifecycle status as of ingestion, e.g. open/closed/settled.';
comment on column markets.result is
  'Settlement outcome (e.g. "yes"/"no"), only set once the market has resolved; null while still open.';
comment on column markets.yes_price is
  'Last traded price of the "Yes" side at ingestion time, expressed as a decimal between 0 and 1 — read this as the market-implied probability of "Yes".';
comment on column markets.yes_bid is
  'Best available bid price for "Yes" at ingestion time (0-1 scale).';
comment on column markets.yes_ask is
  'Best available ask price for "Yes" at ingestion time (0-1 scale).';
comment on column markets.volume is
  'Total number of contracts traded on this market up to ingestion time.';
comment on column markets.volume_24h is
  'Number of contracts traded in the 24 hours before ingestion time.';
comment on column markets.open_interest is
  'Number of contracts currently open (not yet settled/closed) at ingestion time.';
comment on column markets.open_time is
  'When this specific market opened for trading.';
comment on column markets.close_time is
  'When this specific market stopped trading.';
comment on column markets.rules is
  'Plain-language rules describing exactly what this market resolves on.';
comment on column markets.created_at is
  'When this row was written to Supabase (ingestion time).';

-- ---------------------------------------------------------------------------
-- market_price_history: one row per market per candlestick bucket.
-- Column set matches CompactPricePoint in kalshiEvents.ts — a single
-- `price` per bucket, not full OHLC (see file-level comment above).
-- ---------------------------------------------------------------------------

create table market_price_history (
  market_ticker text not null references markets (ticker),
  period_end_ts timestamptz not null,
  period_interval integer not null,
  price numeric,
  volume bigint,
  open_interest bigint,
  primary key (market_ticker, period_end_ts)
);

comment on table market_price_history is
  'Time-series price history for a market ("candlesticks"), one row per bucket. Read as a stock-chart-style series ordered by period_end_ts for a given market_ticker.';
comment on column market_price_history.market_ticker is
  'Market this price point belongs to. References markets.ticker.';
comment on column market_price_history.period_end_ts is
  'Timestamp marking the end of this bucket''s time window.';
comment on column market_price_history.period_interval is
  'Width of each bucket in minutes (e.g. 60 = hourly buckets), so this row can be interpreted without joining back to another table.';
comment on column market_price_history.price is
  'Price of the "Yes" side at the end of this bucket, 0-1 scale (market-implied probability).';
comment on column market_price_history.volume is
  'Contracts traded during this bucket.';
comment on column market_price_history.open_interest is
  'Open interest as of the end of this bucket.';

-- ---------------------------------------------------------------------------
-- event_forecast_snapshots / event_forecast_percentiles: Kalshi's own
-- percentile-based forecast over time for numeric-scalar events. Not
-- trimmed by the compact bundle, so this mirrors the raw shape.
-- Split into two tables (rather than pivoting percentiles into columns)
-- because the set of percentiles requested is a caller parameter, not fixed.
-- ---------------------------------------------------------------------------

create table event_forecast_snapshots (
  event_ticker text not null references events (event_ticker),
  end_period_ts timestamptz not null,
  period_interval integer not null,
  primary key (event_ticker, end_period_ts)
);

comment on table event_forecast_snapshots is
  'One row per point in time Kalshi''s forecast model was checked for a given event. Only exists for events made of true numeric-scalar markets (most sports events won''t have any rows here, since they''re binary threshold markets).';
comment on column event_forecast_snapshots.event_ticker is
  'Event this forecast snapshot belongs to. References events.event_ticker.';
comment on column event_forecast_snapshots.end_period_ts is
  'Timestamp this forecast snapshot was taken as of.';
comment on column event_forecast_snapshots.period_interval is
  'Width of the bucket in minutes this snapshot represents.';

create table event_forecast_percentiles (
  event_ticker text not null,
  end_period_ts timestamptz not null,
  percentile integer not null,
  numerical_forecast numeric,
  raw_numerical_forecast numeric,
  formatted_forecast text,
  primary key (event_ticker, end_period_ts, percentile),
  foreign key (event_ticker, end_period_ts)
    references event_forecast_snapshots (event_ticker, end_period_ts)
);

comment on table event_forecast_percentiles is
  'One row per percentile point within an event_forecast_snapshots row. E.g. percentile=5000 is the 50th percentile (median) forecast.';
comment on column event_forecast_percentiles.percentile is
  'Percentile out of 10000, e.g. 5000 = 50th percentile (median), 9000 = 90th percentile.';
comment on column event_forecast_percentiles.numerical_forecast is
  'Forecast value at this percentile, in the event''s underlying numeric units.';
comment on column event_forecast_percentiles.raw_numerical_forecast is
  'Unrounded version of numerical_forecast, as returned by Kalshi.';
comment on column event_forecast_percentiles.formatted_forecast is
  'Human-readable formatted version of the forecast value, as returned by Kalshi.';

-- ---------------------------------------------------------------------------
-- event_related_events: linked multivariate/combo events, when present.
-- related_event_ticker intentionally has no foreign key — Kalshi can return
-- a linked event here that this database hasn't ingested itself.
-- ---------------------------------------------------------------------------

create table event_related_events (
  event_ticker text not null references events (event_ticker),
  related_event_ticker text not null,
  related_title text,
  primary key (event_ticker, related_event_ticker)
);

comment on table event_related_events is
  'Linked multivariate/combo events Kalshi returns alongside a given event (e.g. parlay-style combined markets). related_event_ticker is not guaranteed to have its own row in the events table.';
comment on column event_related_events.event_ticker is
  'The event this relationship was found on. References events.event_ticker.';
comment on column event_related_events.related_event_ticker is
  'Ticker of the linked event, as returned by Kalshi. May not exist in this database''s events table.';
comment on column event_related_events.related_title is
  'Title of the linked event, as returned by Kalshi.';

-- ---------------------------------------------------------------------------
-- Convenience views: collapse the joins an LLM would otherwise have to get
-- right on its own into a single queryable relation.
-- ---------------------------------------------------------------------------

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

create view event_forecast_summary as
select
  s.event_ticker,
  s.end_period_ts,
  s.period_interval,
  p.percentile,
  p.numerical_forecast,
  p.raw_numerical_forecast,
  p.formatted_forecast
from event_forecast_snapshots s
join event_forecast_percentiles p
  on p.event_ticker = s.event_ticker
  and p.end_period_ts = s.end_period_ts;

comment on view event_forecast_summary is
  'One row per forecast percentile point, flattened with its snapshot''s timing info. Use this instead of manually joining event_forecast_snapshots + event_forecast_percentiles.';
