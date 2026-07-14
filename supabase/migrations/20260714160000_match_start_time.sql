-- events.open_time is "when trading on this event first became possible" --
-- Kalshi routinely opens sports markets days before the real game (e.g. a
-- market can open Jul 10 for a match actually played Jul 14). That's the
-- wrong signal for "has the real-world match started yet", but both the
-- value poller's gating query and computeEventStatus()'s "in_progress"
-- check were using it as if it were exactly that -- risking live polling
-- (and an "in_progress" UI state) for days before the match itself begins.
--
-- match_start_time is the actual real-world occurrence time, sourced from
-- Kalshi's per-market occurrence_datetime/expected_expiration_time (see
-- toCompactBundle() in kalshiEvents.ts), earliest across an event's
-- markets. Nullable and left unbackfilled for rows ingested before this
-- migration -- callers fall back to open_time when it's null rather than
-- guessing a value for historical events.
alter table events add column match_start_time timestamptz;

comment on column events.match_start_time is
  'Earliest real-world occurrence time across this event''s markets, sourced from Kalshi''s occurrence_datetime/expected_expiration_time (not open_time, which is when the Kalshi market opened for trading -- often days before the actual match). Null for events ingested before this column existed; callers should fall back to open_time in that case.';

-- Postgres only allows CREATE OR REPLACE VIEW to append columns, not
-- reorder them, so event_match_start_time is added at the end rather than
-- next to event_open_time/event_close_time where it'd read more naturally.
create or replace view event_summary as
select
  e.id as event_id,
  et.event_ticker,
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
  m.open_interest,
  e.match_start_time as event_match_start_time
from events e
join event_tickers et on et.event_id = e.id
join markets m on m.event_id = e.id and m.event_ticker = et.event_ticker;
