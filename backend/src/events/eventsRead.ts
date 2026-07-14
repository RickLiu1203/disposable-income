import { getSupabaseClient } from "../supabase/supabaseClient";
import { computeEventStatus, type LiveEventStatus } from "./eventStatus";
import { getEventStartingBalances } from "./startingBalances";

export interface EventListItem {
  id: string; // consolidated parent event_id
  event_name: string;
  sub_title: string | null;
  competition: string | null;
  competition_scope: string | null;
  status: string | null;
  live_status: LiveEventStatus;
  open_time: string | null;
  match_start_time: string | null;
  close_time: string | null;
  created_at: string;
  market_count: number;
  tickers: Array<{
    event_ticker: string;
    series_ticker: string;
    title: string;
  }>;
}

export async function listEvents(): Promise<EventListItem[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, event_name, sub_title, competition, competition_scope, status, open_time, match_start_time, close_time, created_at, event_tickers(event_ticker, series_ticker, title), markets(count), predictions(outcome)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list events: ${error.message}`);
  }

  type Row = {
    id: string;
    event_name: string;
    sub_title: string | null;
    competition: string | null;
    competition_scope: string | null;
    status: string | null;
    open_time: string | null;
    match_start_time: string | null;
    close_time: string | null;
    created_at: string;
    event_tickers: Array<{ event_ticker: string; series_ticker: string; title: string }>;
    markets: { count: number }[];
    predictions: { outcome: string }[];
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    event_name: row.event_name,
    sub_title: row.sub_title,
    competition: row.competition,
    competition_scope: row.competition_scope,
    status: row.status,
    live_status: computeEventStatus({
      matchStartTime: row.match_start_time ?? row.open_time,
      totalPredictions: row.predictions.length,
      pendingPredictions: row.predictions.filter((p) => p.outcome === "pending").length,
    }),
    open_time: row.open_time,
    match_start_time: row.match_start_time,
    close_time: row.close_time,
    created_at: row.created_at,
    market_count: row.markets[0]?.count ?? 0,
    tickers: row.event_tickers ?? [],
  }));
}

interface MarketRow {
  ticker: string;
  event_ticker: string;
  label: string | null;
  status: string | null;
  result: string | null;
  yes_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  volume_24h: number | null;
  open_interest: number | null;
  open_time: string | null;
  close_time: string | null;
  rules: string | null;
}

interface PriceHistoryRow {
  market_ticker: string;
  period_end_ts: string;
  period_interval: number;
  price: number | null;
  volume: number | null;
  open_interest: number | null;
}

interface ForecastSummaryRow {
  event_ticker: string;
  end_period_ts: string;
  period_interval: number;
  percentile: number;
  numerical_forecast: number | null;
  raw_numerical_forecast: number | null;
  formatted_forecast: string | null;
}

interface PredictionRow {
  id: number;
  model_name: string;
  market_ticker: string;
  event_ticker: string;
  side: "yes" | "no";
  stake: number;
  entry_price: number;
  justification: string;
  outcome: string;
  payout: number | null;
  placed_at: string;
  settled_at: string | null;
}

interface StrategyRow {
  model_name: string;
  strategy_notes: string;
  strategy_headline: string | null;
  created_at: string;
}

export interface EventLeaderboardRow {
  model_name: string;
  starting_balance: number;
  ending_balance: number | null;
  percent_change: number | null;
  event_rank: number;
  prediction_count: number;
  strategy_notes: string | null;
  strategy_headline: string | null;
}

export interface EventDetail {
  event: {
    id: string;
    event_name: string;
    sub_title: string | null;
    competition: string | null;
    competition_scope: string | null;
    status: string | null;
    live_status: LiveEventStatus;
    open_time: string | null;
    match_start_time: string | null;
    close_time: string | null;
    created_at: string;
  };
  tickers: Array<{ event_ticker: string; series_ticker: string; title: string }>;
  markets: MarketRow[];
  priceHistory: Array<{ market_ticker: string; points: Array<Omit<PriceHistoryRow, "market_ticker">> }>;
  forecastHistory: Array<{
    end_period_ts: string;
    period_interval: number;
    percentile_points: Array<{
      percentile: number;
      numerical_forecast: number | null;
      raw_numerical_forecast: number | null;
      formatted_forecast: string | null;
    }>;
  }>;
  predictions: PredictionRow[];
  strategies: StrategyRow[];
  leaderboard: EventLeaderboardRow[];
  /** Each model's starting bankroll for this specific event -- the "pot" it
   * brought into the match, carried over from wherever its balance stood
   * after its last settled event (or 10 if this is its first ever). Use
   * this as the baseline for any per-event chart/display; do not assume a
   * fresh $10 per event. See startingBalances.ts. */
  starting_balances: Record<string, number>;
}

export async function getEventDetail(eventId: string): Promise<EventDetail | null> {
  const supabase = getSupabaseClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select(
      "id, event_name, sub_title, competition, competition_scope, status, open_time, match_start_time, close_time, created_at"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) {
    throw new Error(`Failed to load event ${eventId}: ${eventError.message}`);
  }
  if (!event) return null;

  // Load sibling tickers for this parent event
  const { data: tickers, error: tickersError } = await supabase
    .from("event_tickers")
    .select("event_ticker, series_ticker, title")
    .eq("event_id", eventId);
  if (tickersError) {
    throw new Error(`Failed to load tickers for event ${eventId}: ${tickersError.message}`);
  }

  // Load all markets for all sibling tickers under this parent event
  const { data: markets, error: marketsError } = await supabase
    .from("markets")
    .select("ticker, event_ticker, label, status, result, yes_price, yes_bid, yes_ask, volume, volume_24h, open_interest, open_time, close_time, rules")
    .eq("event_id", eventId)
    .order("ticker", { ascending: true });
  if (marketsError) {
    throw new Error(`Failed to load markets for event ${eventId}: ${marketsError.message}`);
  }

  const marketTickers = (markets ?? []).map((m) => m.ticker);

  let priceHistory: EventDetail["priceHistory"] = [];
  if (marketTickers.length > 0) {
    const { data: priceRows, error: priceError } = await supabase
      .from("market_price_history")
      .select("market_ticker, period_end_ts, period_interval, price, volume, open_interest")
      .in("market_ticker", marketTickers)
      .order("market_ticker", { ascending: true })
      .order("period_end_ts", { ascending: true });
    if (priceError) {
      throw new Error(`Failed to load price history for event ${eventId}: ${priceError.message}`);
    }
    const byMarket = new Map<string, EventDetail["priceHistory"][number]["points"]>();
    for (const row of (priceRows ?? []) as PriceHistoryRow[]) {
      const points = byMarket.get(row.market_ticker) ?? [];
      points.push({
        period_end_ts: row.period_end_ts,
        period_interval: row.period_interval,
        price: row.price,
        volume: row.volume,
        open_interest: row.open_interest,
      });
      byMarket.set(row.market_ticker, points);
    }
    priceHistory = [...byMarket.entries()].map(([market_ticker, points]) => ({ market_ticker, points }));
  }

  // Load forecast history
  const { data: forecastRows, error: forecastError } = await supabase
    .from("event_forecast_summary")
    .select("event_ticker, end_period_ts, period_interval, percentile, numerical_forecast, raw_numerical_forecast, formatted_forecast")
    .eq("event_id", eventId)
    .order("end_period_ts", { ascending: true })
    .order("percentile", { ascending: true });
  if (forecastError) {
    throw new Error(`Failed to load forecast history for event ${eventId}: ${forecastError.message}`);
  }
  const bySnapshot = new Map<string, EventDetail["forecastHistory"][number]>();
  for (const row of (forecastRows ?? []) as ForecastSummaryRow[]) {
    const key = row.end_period_ts;
    const entry = bySnapshot.get(key) ?? {
      end_period_ts: row.end_period_ts,
      period_interval: row.period_interval,
      percentile_points: [],
    };
    entry.percentile_points.push({
      percentile: row.percentile,
      numerical_forecast: row.numerical_forecast,
      raw_numerical_forecast: row.raw_numerical_forecast,
      formatted_forecast: row.formatted_forecast,
    });
    bySnapshot.set(key, entry);
  }
  const forecastHistory = [...bySnapshot.values()];

  // Load per-model predictions (bets placed) for this consolidated event
  const { data: predictionRows, error: predictionsError } = await supabase
    .from("predictions")
    .select("id, model_name, market_ticker, event_ticker, side, stake, entry_price, justification, outcome, payout, placed_at, settled_at")
    .eq("event_id", eventId)
    .order("model_name", { ascending: true })
    .order("placed_at", { ascending: true });
  if (predictionsError) {
    throw new Error(`Failed to load predictions for event ${eventId}: ${predictionsError.message}`);
  }

  // Load per-model strategy notes for this consolidated event
  const { data: strategyRows, error: strategiesError } = await supabase
    .from("model_event_strategies")
    .select("model_name, strategy_notes, strategy_headline, created_at")
    .eq("event_id", eventId);
  if (strategiesError) {
    throw new Error(`Failed to load strategy notes for event ${eventId}: ${strategiesError.message}`);
  }

  // Load event leaderboard
  const { data: leaderboardRows, error: leaderboardError } = await supabase
    .from("event_leaderboard")
    .select("model_name, starting_balance, ending_balance, percent_change, event_rank, prediction_count")
    .eq("event_id", eventId)
    .order("event_rank", { ascending: true });
  if (leaderboardError) {
    throw new Error(`Failed to load event leaderboard for event ${eventId}: ${leaderboardError.message}`);
  }

  const leaderboard = (leaderboardRows ?? []).map((row) => {
    const strategy = (strategyRows ?? []).find((s) => s.model_name === row.model_name);
    return {
      model_name: row.model_name,
      starting_balance: Number(row.starting_balance),
      ending_balance: row.ending_balance !== null ? Number(row.ending_balance) : null,
      percent_change: row.percent_change !== null ? Number(row.percent_change) : null,
      event_rank: Number(row.event_rank),
      prediction_count: Number(row.prediction_count),
      strategy_notes: strategy ? strategy.strategy_notes : null,
      strategy_headline: strategy ? strategy.strategy_headline : null,
    };
  });

  const predictionRowsList = (predictionRows ?? []) as PredictionRow[];

  // Each model's starting bankroll ("pot") for this event -- shared logic
  // with the value poller, since both need the exact same
  // settled-or-carried-over-live-balance fallback.
  const { data: modelRows, error: modelsError } = await supabase.from("models").select("model_name");
  if (modelsError) {
    throw new Error(`Failed to load model roster: ${modelsError.message}`);
  }
  const allModelNames = ((modelRows ?? []) as { model_name: string }[]).map((m) => m.model_name);
  const startingBalances = await getEventStartingBalances(eventId, allModelNames);

  return {
    event: {
      id: event.id,
      event_name: event.event_name,
      sub_title: event.sub_title,
      competition: event.competition,
      competition_scope: event.competition_scope,
      status: event.status,
      live_status: computeEventStatus({
        matchStartTime: event.match_start_time ?? event.open_time,
        totalPredictions: predictionRowsList.length,
        pendingPredictions: predictionRowsList.filter((p) => p.outcome === "pending").length,
      }),
      open_time: event.open_time,
      match_start_time: event.match_start_time,
      close_time: event.close_time,
      created_at: event.created_at,
    },
    tickers: tickers ?? [],
    markets: (markets ?? []) as MarketRow[],
    priceHistory,
    forecastHistory,
    predictions: predictionRowsList,
    strategies: (strategyRows ?? []) as StrategyRow[],
    leaderboard,
    starting_balances: startingBalances,
  };
}

export interface LifetimeLeaderboardRow {
  model_name: string;
  events_participated: number;
  avg_percent_change: number;
  total_pnl: number;
  total_rewards_earned: number;
  lifetime_rank: number;
}

export async function getLifetimeLeaderboard(): Promise<LifetimeLeaderboardRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("lifetime_leaderboard")
    .select("*")
    .order("lifetime_rank", { ascending: true });
  if (error) {
    throw new Error(`Failed to load lifetime leaderboard: ${error.message}`);
  }
  return (data ?? []) as LifetimeLeaderboardRow[];
}
