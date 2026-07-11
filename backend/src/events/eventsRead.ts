import { getSupabaseClient } from "../supabase/supabaseClient";

// ---------------------------------------------------------------------------
// Read-only queries against the event data kalshiIngest.ts already wrote to
// Supabase (events/markets/market_price_history/event_forecast_*/
// event_related_events) — what a frontend calls to display an event, as
// opposed to kalshiEvents.ts (live Kalshi fetch) or kalshiIngest.ts (write).
// getEventDetail() reshapes the flat table rows back into the same
// {event, markets, priceHistory, forecastHistory, relatedEvents} shape
// CompactEventBundle uses, so frontend code doesn't need two different
// event-shape parsers depending on whether data came from Kalshi live or
// from Supabase.
// ---------------------------------------------------------------------------

export interface EventListItem {
  event_ticker: string;
  series_ticker: string;
  event_name: string;
  sub_title: string | null;
  competition: string | null;
  competition_scope: string | null;
  status: string | null;
  open_time: string | null;
  close_time: string | null;
  created_at: string;
  market_count: number;
}

export async function listEvents(): Promise<EventListItem[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "event_ticker, series_ticker, event_name, sub_title, competition, competition_scope, status, open_time, close_time, created_at, markets(count)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list events: ${error.message}`);
  }

  type Row = Omit<EventListItem, "market_count"> & { markets: { count: number }[] };
  return ((data ?? []) as unknown as Row[]).map(({ markets, ...row }) => ({
    ...row,
    market_count: markets[0]?.count ?? 0,
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

export interface EventDetail {
  event: {
    event_ticker: string;
    series_ticker: string;
    event_name: string;
    sub_title: string | null;
    competition: string | null;
    competition_scope: string | null;
    status: string | null;
    open_time: string | null;
    close_time: string | null;
    created_at: string;
  };
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
  relatedEvents: Array<{ related_event_ticker: string; related_title: string | null }>;
}

export async function getEventDetail(eventTicker: string): Promise<EventDetail | null> {
  const supabase = getSupabaseClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select(
      "event_ticker, series_ticker, event_name, sub_title, competition, competition_scope, status, open_time, close_time, created_at"
    )
    .eq("event_ticker", eventTicker)
    .maybeSingle();
  if (eventError) {
    throw new Error(`Failed to load event ${eventTicker}: ${eventError.message}`);
  }
  if (!event) return null;

  const { data: markets, error: marketsError } = await supabase
    .from("markets")
    .select(
      "ticker, event_ticker, label, status, result, yes_price, yes_bid, yes_ask, volume, volume_24h, open_interest, open_time, close_time, rules"
    )
    .eq("event_ticker", eventTicker)
    .order("ticker", { ascending: true });
  if (marketsError) {
    throw new Error(`Failed to load markets for ${eventTicker}: ${marketsError.message}`);
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
      throw new Error(`Failed to load price history for ${eventTicker}: ${priceError.message}`);
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

  const { data: forecastRows, error: forecastError } = await supabase
    .from("event_forecast_summary")
    .select("event_ticker, end_period_ts, period_interval, percentile, numerical_forecast, raw_numerical_forecast, formatted_forecast")
    .eq("event_ticker", eventTicker)
    .order("end_period_ts", { ascending: true })
    .order("percentile", { ascending: true });
  if (forecastError) {
    throw new Error(`Failed to load forecast history for ${eventTicker}: ${forecastError.message}`);
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

  const { data: relatedEvents, error: relatedError } = await supabase
    .from("event_related_events")
    .select("related_event_ticker, related_title")
    .eq("event_ticker", eventTicker);
  if (relatedError) {
    throw new Error(`Failed to load related events for ${eventTicker}: ${relatedError.message}`);
  }

  return {
    event,
    markets: (markets ?? []) as MarketRow[],
    priceHistory,
    forecastHistory,
    relatedEvents: relatedEvents ?? [],
  };
}
