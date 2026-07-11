-- Drop views first
drop view if exists event_overall_performance cascade;
drop view if exists lifetime_leaderboard cascade;
drop view if exists event_leaderboard cascade;
drop view if exists event_forecast_summary cascade;
drop view if exists event_summary cascade;

-- Drop tables
drop table if exists event_payouts cascade;
drop table if exists model_event_strategies cascade;
drop table if exists model_event_results cascade;
drop table if exists predictions cascade;
drop table if exists event_forecast_percentiles cascade;
drop table if exists event_forecast_snapshots cascade;
drop table if exists market_price_history cascade;
drop table if exists markets cascade;
drop table if exists event_tickers cascade;
drop table if exists events cascade;

-- Create tables
create table events (
  id uuid primary key,
  event_name text not null,
  sub_title text,
  competition text,
  competition_scope text,
  status text,
  open_time timestamptz,
  close_time timestamptz,
  created_at timestamptz not null default now()
);

create table event_tickers (
  event_id uuid not null references events (id) on delete cascade,
  event_ticker text primary key,
  series_ticker text not null,
  title text not null,
  created_at timestamptz not null default now()
);

create table markets (
  ticker text primary key,
  event_id uuid not null references events (id) on delete cascade,
  event_ticker text not null references event_tickers (event_ticker) on delete cascade,
  label text,
  status text,
  result text,
  yes_price numeric,
  yes_bid numeric,
  yes_ask numeric,
  volume numeric,
  volume_24h numeric,
  open_interest numeric,
  open_time timestamptz,
  close_time timestamptz,
  rules text,
  created_at timestamptz not null default now(),
  constraint markets_ticker_event_ticker_key unique (ticker, event_ticker)
);

create index markets_event_id_idx on markets (event_id);
create index markets_event_ticker_idx on markets (event_ticker);

create table market_price_history (
  market_ticker text not null references markets (ticker) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  period_end_ts timestamptz not null,
  period_interval integer not null,
  price numeric,
  volume numeric,
  open_interest numeric,
  primary key (market_ticker, period_end_ts)
);

create index market_price_history_event_id_idx on market_price_history (event_id);

create table event_forecast_snapshots (
  event_id uuid not null references events (id) on delete cascade,
  event_ticker text not null references event_tickers (event_ticker) on delete cascade,
  end_period_ts timestamptz not null,
  period_interval integer not null,
  primary key (event_ticker, end_period_ts)
);

create table event_forecast_percentiles (
  event_id uuid not null references events (id) on delete cascade,
  event_ticker text not null,
  end_period_ts timestamptz not null,
  percentile integer not null,
  numerical_forecast numeric,
  raw_numerical_forecast numeric,
  formatted_forecast text,
  primary key (event_ticker, end_period_ts, percentile),
  foreign key (event_ticker, end_period_ts)
    references event_forecast_snapshots (event_ticker, end_period_ts) on delete cascade
);

create table predictions (
  id bigint generated always as identity primary key,
  model_name text not null references models (model_name) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  event_ticker text not null references event_tickers (event_ticker) on delete cascade,
  market_ticker text not null,
  side text not null check (side in ('yes', 'no')),
  stake numeric not null check (stake > 0),
  entry_price numeric not null check (entry_price > 0 and entry_price < 1),
  justification text not null,
  outcome text not null default 'pending' check (outcome in ('pending', 'win', 'loss', 'void')),
  payout numeric,
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  foreign key (market_ticker, event_ticker) references markets (ticker, event_ticker) on delete cascade
);

create index predictions_model_event_id_idx on predictions (model_name, event_id);
create index predictions_market_ticker_idx on predictions (market_ticker);

create table model_event_results (
  model_name text not null references models (model_name) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  starting_balance numeric not null check (starting_balance >= 0),
  ending_balance numeric,
  percent_change numeric generated always as (
    ((ending_balance - starting_balance) / starting_balance) * 100
  ) stored,
  primary key (model_name, event_id)
);

create table model_event_strategies (
  model_name text not null references models (model_name) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  strategy_notes text not null,
  created_at timestamptz not null default now(),
  primary key (model_name, event_id)
);

create table event_payouts (
  event_id uuid not null references events (id) on delete cascade,
  model_name text not null references models (model_name) on delete cascade,
  pot_total numeric not null,
  event_rank int not null,
  event_half_payout numeric not null,
  lifetime_rank int not null,
  lifetime_half_payout numeric not null,
  total_payout numeric generated always as (event_half_payout + lifetime_half_payout) stored,
  computed_at timestamptz not null default now(),
  primary key (event_id, model_name)
);

create index event_payouts_model_name_idx on event_payouts (model_name);

-- Create views
create view event_summary as
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
  m.open_interest
from events e
join event_tickers et on et.event_id = e.id
join markets m on m.event_id = e.id and m.event_ticker = et.event_ticker;

create view event_forecast_summary as
select
  s.event_id,
  s.event_ticker,
  s.end_period_ts,
  s.period_interval,
  p.percentile,
  p.numerical_forecast,
  p.raw_numerical_forecast,
  p.formatted_forecast
from event_forecast_snapshots s
join event_forecast_percentiles p
  on p.event_id = s.event_id
  and p.event_ticker = s.event_ticker
  and p.end_period_ts = s.end_period_ts;

create view event_leaderboard as
select
  r.event_id,
  r.model_name,
  r.starting_balance,
  r.ending_balance,
  r.percent_change,
  rank() over (partition by r.event_id order by r.percent_change desc nulls last) as event_rank,
  (
    select count(*) from predictions p
    where p.model_name = r.model_name and p.event_id = r.event_id
  ) as prediction_count
from model_event_results r;

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

create view event_overall_performance as
select
  event_id,
  count(*) as models_participated,
  avg(percent_change) as avg_percent_change,
  min(percent_change) as worst_percent_change,
  max(percent_change) as best_percent_change,
  sum(starting_balance) as combined_starting_balance,
  sum(ending_balance) as combined_ending_balance
from model_event_results
where ending_balance is not null
group by event_id;

-- Reset models balance
update models set current_balance = 10;

-- ===========================================================================
-- SCHEMA COMMENTS FOR MCP / LLM NAVIGATION
-- ===========================================================================

-- Comments for events
comment on table events is 'Consolidated parent events. Each row represents a sports match or unified prediction market event, identified by its Milestone UUID or deterministic UUID.';
comment on column events.id is 'Unique UUID identifying this consolidated event/match.';
comment on column events.event_name is 'The human-readable name of the consolidated event (e.g. "Argentina vs Canada").';
comment on column events.sub_title is 'An optional subtitle or description of the event.';
comment on column events.competition is 'The category or league of the event (e.g. "Copa America", "World Cup").';
comment on column events.competition_scope is 'The sub-classification or scope (e.g. "Group Stage", "Final").';
comment on column events.status is 'Consolidated status: "open" if any sibling market is active, "settled" if all are settled, "closed" otherwise.';
comment on column events.open_time is 'The earliest open time across all sibling markets.';
comment on column events.close_time is 'The latest close time across all sibling markets.';
comment on column events.created_at is 'Timestamp of when this parent event was ingested.';

-- Comments for event_tickers
comment on table event_tickers is 'Mappings of individual sibling event tickers (Moneylines, Spreads, Totals, To Advance) to their consolidated parent event.';
comment on column event_tickers.event_id is 'Reference to the parent consolidated event.';
comment on column event_tickers.event_ticker is 'The specific Kalshi event ticker (e.g. "KXWCADVANCE-26JUL11").';
comment on column event_tickers.series_ticker is 'The Kalshi series ticker (e.g. "KXWCADVANCE").';
comment on column event_tickers.title is 'The specific title for this sibling event.';
comment on column event_tickers.created_at is 'Timestamp of when this mapping was created.';

-- Comments for markets
comment on table markets is 'One row per Kalshi market nested under a sibling event ticker. Populated by ingestion snapshots.';
comment on column markets.ticker is 'The unique Kalshi market ticker (e.g. "KXWCADVANCE-26JUL11-YES").';
comment on column markets.event_id is 'Reference to the parent consolidated event.';
comment on column markets.event_ticker is 'Reference to the sibling event ticker this market is defined under.';
comment on column markets.label is 'The display label for this market (e.g. "England to Advance").';
comment on column markets.status is 'Current status: active, settled, closed.';
comment on column markets.result is 'The resolved result: yes or no.';
comment on column markets.yes_price is 'The mid price for yes contracts (0-1 scale).';
comment on column markets.yes_bid is 'The best bid price for yes contracts (0-1 scale).';
comment on column markets.yes_ask is 'The best ask price for yes contracts (0-1 scale).';
comment on column markets.volume is 'Total volume of contracts traded.';
comment on column markets.volume_24h is 'Volume of contracts traded in the last 24 hours.';
comment on column markets.open_interest is 'Number of outstanding contracts.';
comment on column markets.open_time is 'Timestamp when the market opened.';
comment on column markets.close_time is 'Timestamp when the market closed.';
comment on column markets.rules is 'Description of market settlement rules.';
comment on column markets.created_at is 'Timestamp when this market record was ingested.';

-- Comments for market_price_history
comment on table market_price_history is 'Historical price candlesticks for each market bucket.';
comment on column market_price_history.market_ticker is 'The target market ticker.';
comment on column market_price_history.event_id is 'Reference to the parent consolidated event.';
comment on column market_price_history.period_end_ts is 'The ending timestamp of the history period.';
comment on column market_price_history.period_interval is 'The interval size of the period in minutes.';
comment on column market_price_history.price is 'Mid price at the end of the interval (0-1 scale).';
comment on column market_price_history.volume is 'Total contract volume traded during the interval.';
comment on column market_price_history.open_interest is 'Open interest during the interval.';

-- Comments for event_forecast_snapshots
comment on table event_forecast_snapshots is 'Forecast history snapshots representing Kalshi forecast runs.';
comment on column event_forecast_snapshots.event_id is 'Reference to the parent consolidated event.';
comment on column event_forecast_snapshots.event_ticker is 'Reference to the sibling event ticker the forecast belongs to.';
comment on column event_forecast_snapshots.end_period_ts is 'Ending timestamp of the forecast snapshot period.';
comment on column event_forecast_snapshots.period_interval is 'The interval size of the snapshot in minutes.';

-- Comments for event_forecast_percentiles
comment on table event_forecast_percentiles is 'Forecast percentile points representing forecast values across different confidence intervals.';
comment on column event_forecast_percentiles.event_id is 'Reference to the parent consolidated event.';
comment on column event_forecast_percentiles.event_ticker is 'Reference to the sibling event ticker the forecast belongs to.';
comment on column event_forecast_percentiles.end_period_ts is 'Ending timestamp of the forecast snapshot period.';
comment on column event_forecast_percentiles.percentile is 'The percentile tier (e.g. 5000 = median).';
comment on column event_forecast_percentiles.numerical_forecast is 'Numerical prediction value at this percentile.';
comment on column event_forecast_percentiles.raw_numerical_forecast is 'Raw numerical prediction value before formatting.';
comment on column event_forecast_percentiles.formatted_forecast is 'Human-readable formatted forecast text.';

-- Comments for predictions
comment on table predictions is 'Predictions placed by models. Multiple predictions per model are allowed across different sibling markets within the same consolidated match.';
comment on column predictions.id is 'Unique prediction record identifier.';
comment on column predictions.model_name is 'Model that placed the prediction.';
comment on column predictions.event_id is 'Reference to the parent consolidated event.';
comment on column predictions.event_ticker is 'Reference to the sibling event ticker the prediction was placed on.';
comment on column predictions.market_ticker is 'Reference to the target market ticker.';
comment on column predictions.side is 'Backed side: yes or no.';
comment on column predictions.stake is 'Dollar stake allocated to this prediction. Stakes across all sibling markets in a match must sum to <= model''s starting balance.';
comment on column predictions.entry_price is 'Contract entry price (0-1 scale). Contracts bought = stake / entry_price.';
comment on column predictions.justification is 'Reasoning given by the model for this specific market prediction.';
comment on column predictions.outcome is 'Status: pending, win, loss, void.';
comment on column predictions.payout is 'Settled payout amount. stake / entry_price if win, stake if void, 0 if loss, null while pending.';
comment on column predictions.placed_at is 'Timestamp of prediction placement.';
comment on column predictions.settled_at is 'Timestamp of settlement.';

-- Comments for model_event_results
comment on table model_event_results is 'Aggregate bankroll performance per model per consolidated event/match.';
comment on column model_event_results.model_name is 'Model name.';
comment on column model_event_results.event_id is 'Reference to the parent consolidated event.';
comment on column model_event_results.starting_balance is 'Starting bankroll balance for this match. Carried forward from previous settled match payouts, or 10 for new models.';
comment on column model_event_results.ending_balance is 'Ending bankroll balance after settling all predictions in the match. Null while pending.';
comment on column model_event_results.percent_change is 'Performance percentage: (ending_balance - starting_balance) / starting_balance * 100.';

-- Comments for model_event_strategies
comment on table model_event_strategies is 'Model''s overall per-match reasoning and strategy notes, separate from individual prediction justifications.';
comment on column model_event_strategies.model_name is 'Model name.';
comment on column model_event_strategies.event_id is 'Reference to the parent consolidated event.';
comment on column model_event_strategies.strategy_notes is 'Text notes outlining the high-level match strategy.';
comment on column model_event_strategies.created_at is 'Timestamp of creation.';

-- Comments for event_payouts
comment on table event_payouts is 'Zero-sum payout redistribution records for each model on a settled match.';
comment on column event_payouts.event_id is 'Reference to the parent consolidated event.';
comment on column event_payouts.model_name is 'Model name.';
comment on column event_payouts.pot_total is 'The total pot size (sum of ending balances of participating models).';
comment on column event_payouts.event_rank is 'Rank of the model in the specific match.';
comment on column event_payouts.event_half_payout is 'Redistributed amount based on match performance.';
comment on column event_payouts.lifetime_rank is 'Rank of the model on lifetime average performance.';
comment on column event_payouts.lifetime_half_payout is 'Redistributed amount based on lifetime average performance.';
comment on column event_payouts.total_payout is 'Total payout redistributed (event_half_payout + lifetime_half_payout).';
comment on column event_payouts.computed_at is 'Timestamp of computation.';

-- Comments for views
comment on view event_summary is 'Convenience view joining parent events, sibling mappings, and current market price snapshots.';
comment on view event_forecast_summary is 'Convenience view joining forecast snapshots with their forecast percentile points.';
comment on view event_leaderboard is 'Leaderboard showing model rankings and prediction counts per match.';
comment on view lifetime_leaderboard is 'Lifetime leaderboards tracking total models performance, average percent change, total PnL, and total rewards earned.';
comment on view event_overall_performance is 'Summary of aggregate model metrics per match.';
