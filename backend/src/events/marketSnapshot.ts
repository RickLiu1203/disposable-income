import { getSupabaseClient } from "../supabase/supabaseClient";

// ---------------------------------------------------------------------------
// Backs the EventScreen "Markets" panel. market_price_history is written by
// BOTH ingestion-time candlestick backfill (kalshiIngest.ts) and the live
// value poller (valuePoller.ts) -- it is not poller-exclusive -- so a row
// existing there doesn't strictly mean "from the last 5 minutes". Rather
// than imply false freshness, this returns an honest as_of timestamp for
// every market and lets the frontend render "as of {as_of}" directly;
// is_live_priced just distinguishes "has a real timestamped price point"
// from "ingestion-time snapshot only, no price history exists at all".
//
// `history`/`change` back the per-market sparkline + gainers/losers sort in
// the frontend sidebar. No new polling was needed for this -- the value
// poller (valuePoller.ts) already wrote a market_price_history point for
// every market in a live event every ~5 minutes; this just reads the full
// series per market instead of only the latest point. Cheap now that
// ingestion caps an event to ~50 markets (see kalshiIngest.ts) rather than
// the hundreds a match used to bring in.
// ---------------------------------------------------------------------------

export interface MarketHistoryPoint {
  price: number;
  as_of: string;
}

export interface MarketSnapshotRow {
  ticker: string;
  event_ticker: string;
  label: string | null;
  price: number | null;
  volume: number | null;
  as_of: string | null;
  is_live_priced: boolean;
  history: MarketHistoryPoint[];
  /** last history price minus first, in dollars (0-1 scale). Null with
   * fewer than two priced points to chart a direction from. */
  change: number | null;
}

export interface MarketSnapshot {
  event_id: string;
  markets: MarketSnapshotRow[];
}

export async function getMarketSnapshot(eventId: string): Promise<MarketSnapshot | null> {
  const supabase = getSupabaseClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) {
    throw new Error(`Failed to load event ${eventId}: ${eventError.message}`);
  }
  if (!event) return null;

  const { data: markets, error: marketsError } = await supabase
    .from("markets")
    .select("ticker, event_ticker, label, volume, yes_price, created_at")
    .eq("event_id", eventId);
  if (marketsError) {
    throw new Error(`Failed to load markets for event ${eventId}: ${marketsError.message}`);
  }
  const marketRows = (markets ?? []) as Array<{
    ticker: string;
    event_ticker: string;
    label: string | null;
    volume: number | null;
    yes_price: number | null;
    created_at: string;
  }>;

  const tickers = marketRows.map((m) => m.ticker);
  const historyByTicker = new Map<string, MarketHistoryPoint[]>();
  const latestVolumeByTicker = new Map<string, number | null>();

  if (tickers.length > 0) {
    const { data: priceRows, error: priceError } = await supabase
      .from("market_price_history")
      .select("market_ticker, period_end_ts, price, volume")
      .in("market_ticker", tickers)
      .order("period_end_ts", { ascending: true });
    if (priceError) {
      throw new Error(`Failed to load price history for event ${eventId}: ${priceError.message}`);
    }
    for (const row of (priceRows ?? []) as Array<{ market_ticker: string; period_end_ts: string; price: number | null; volume: number | null }>) {
      // Ascending order, so the last push per ticker ends up being latest.
      latestVolumeByTicker.set(row.market_ticker, row.volume);
      if (row.price === null) continue;
      const list = historyByTicker.get(row.market_ticker) ?? [];
      list.push({ price: row.price, as_of: row.period_end_ts });
      historyByTicker.set(row.market_ticker, list);
    }
  }

  const snapshotRows: MarketSnapshotRow[] = marketRows.map((m) => {
    const history = historyByTicker.get(m.ticker) ?? [];
    const latest = history[history.length - 1];
    const change = history.length >= 2 ? Number((history[history.length - 1].price - history[0].price).toFixed(4)) : null;

    if (latest) {
      return {
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        label: m.label,
        price: latest.price,
        volume: latestVolumeByTicker.get(m.ticker) ?? m.volume,
        as_of: latest.as_of,
        is_live_priced: true,
        history,
        change,
      };
    }
    return {
      ticker: m.ticker,
      event_ticker: m.event_ticker,
      label: m.label,
      price: m.yes_price,
      volume: m.volume,
      as_of: m.created_at,
      is_live_priced: false,
      history,
      change,
    };
  });

  snapshotRows.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));

  return { event_id: eventId, markets: snapshotRows };
}
