import { getSupabaseClient } from "../supabase/supabaseClient";

// ---------------------------------------------------------------------------
// Backs the EventScreen "Markets" panel. market_price_history is written by
// BOTH ingestion-time candlestick backfill (kalshiIngest.ts) and the live
// value poller (valuePoller.ts) -- it is not poller-exclusive -- so a row
// existing there doesn't strictly mean "from the last 10 minutes". Rather
// than imply false freshness, this returns an honest as_of timestamp for
// every market and lets the frontend render "as of {as_of}" directly;
// is_live_priced just distinguishes "has a real timestamped price point"
// from "ingestion-time snapshot only, no price history exists at all".
// ---------------------------------------------------------------------------

export interface MarketSnapshotRow {
  ticker: string;
  event_ticker: string;
  label: string | null;
  price: number | null;
  volume: number | null;
  as_of: string | null;
  is_live_priced: boolean;
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
  const latestPriceByTicker = new Map<string, { period_end_ts: string; price: number | null; volume: number | null }>();

  if (tickers.length > 0) {
    const { data: priceRows, error: priceError } = await supabase
      .from("market_price_history")
      .select("market_ticker, period_end_ts, price, volume")
      .in("market_ticker", tickers)
      .order("period_end_ts", { ascending: false });
    if (priceError) {
      throw new Error(`Failed to load price history for event ${eventId}: ${priceError.message}`);
    }
    // Rows arrive newest-first, so the first time we see a ticker is its latest point.
    for (const row of (priceRows ?? []) as Array<{ market_ticker: string; period_end_ts: string; price: number | null; volume: number | null }>) {
      if (!latestPriceByTicker.has(row.market_ticker)) {
        latestPriceByTicker.set(row.market_ticker, { period_end_ts: row.period_end_ts, price: row.price, volume: row.volume });
      }
    }
  }

  const snapshotRows: MarketSnapshotRow[] = marketRows.map((m) => {
    const latest = latestPriceByTicker.get(m.ticker);
    if (latest) {
      return {
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        label: m.label,
        price: latest.price,
        volume: latest.volume,
        as_of: latest.period_end_ts,
        is_live_priced: true,
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
    };
  });

  snapshotRows.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));

  return { event_id: eventId, markets: snapshotRows };
}
