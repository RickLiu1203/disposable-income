import { getSupabaseClient } from "../supabase/supabaseClient";
import {
  getEvent,
  getEventBundle,
  getEventCandlesticks,
  getEventForecastPercentileHistory,
  getMarket,
  parseNum,
  type CompactEventBundle,
  type CompactMarket,
  type CompactPricePoint,
  type EventBundleOptions,
  type KalshiForecastHistoryResponse,
} from "../kalshi/kalshiEvents";
import { isCoreSeriesTicker } from "./agentMarketConfig";

// ---------------------------------------------------------------------------
// Shared plumbing for the agent pipeline's live-Kalshi steps (4: markets,
// 5: history, 6: forecast) plus the on-demand market-detail drill-down.
// Structural mapping (which sibling event tickers belong to a consolidated
// match) reads from the DB per the plan's ground rules; everything
// price/odds/forecast-shaped is always fetched live from Kalshi, never from
// the DB's ingestion-time snapshot tables.
// ---------------------------------------------------------------------------

export interface SiblingTicker {
  event_ticker: string;
  series_ticker: string;
  title: string;
}

export interface SiblingBundle extends SiblingTicker {
  isCore: boolean;
  bundle: CompactEventBundle;
}

export interface AgentMarket extends CompactMarket {
  event_ticker: string;
  sibling_title: string;
}

export interface OmittedSibling {
  event_ticker: string;
  sibling_title: string;
  omitted_count: number;
  total_volume: number;
}

export interface MarketSelection {
  siblings: SiblingTicker[];
  core_markets: AgentMarket[];
  top_prop_markets: AgentMarket[];
  omitted: OmittedSibling[];
}

// Amendment (confirmed): never limit the agent's visible options below a
// floor of 50 total markets. props_limit = max(30, 50 - core.length), so a
// match with very few core markets still surfaces up to 50 total; a match
// with fewer than 50 markets overall just returns everything.
const MIN_TOTAL_MARKETS_FLOOR = 50;
const DEFAULT_PROPS_LIMIT = 30;

export async function getEventSiblings(eventId: string): Promise<SiblingTicker[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("event_tickers")
    .select("event_ticker, series_ticker, title")
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`Failed to load sibling tickers for event ${eventId}: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`No ingested siblings found for event ${eventId}. Ingest it first via POST /kalshi/add-event.`);
  }
  return data as SiblingTicker[];
}

/** Live-fetches each sibling's full compact bundle -- sequentially, the same
 * fan-out pattern POST /kalshi/add-event?ingest_all_props=true already uses
 * in server.ts. A match can have 20+ siblings and each bundle fetch already
 * fans out ~4 Kalshi calls internally (event/metadata/candlesticks/forecast),
 * so fetching siblings in full parallel (confirmed live) reliably trips
 * Kalshi's rate limit (429) partway through -- one sibling's getEvent() call
 * failing aborts that whole bundle rather than degrading gracefully, unlike
 * the metadata/candlesticks/forecast sub-fetches which loadOptional() already
 * protects. Sequential fetching trades latency for reliability here. */
export async function fetchSiblingBundles(
  siblings: SiblingTicker[],
  opts?: EventBundleOptions
): Promise<SiblingBundle[]> {
  const results: SiblingBundle[] = [];
  for (const sibling of siblings) {
    results.push({
      ...sibling,
      isCore: isCoreSeriesTicker(sibling.series_ticker),
      bundle: await getEventBundle(sibling.series_ticker, sibling.event_ticker, opts),
    });
  }
  return results;
}

function toAgentMarkets(sibling: SiblingBundle): AgentMarket[] {
  return sibling.bundle.markets.map((m) => ({
    ...m,
    event_ticker: sibling.event_ticker,
    sibling_title: sibling.title,
  }));
}

function volumeOf(m: AgentMarket): number {
  return m.volume ?? 0;
}

export function buildMarketSelection(siblingBundles: SiblingBundle[]): MarketSelection {
  const coreMarkets = siblingBundles.filter((s) => s.isCore).flatMap(toAgentMarkets);
  const nonCoreMarkets = siblingBundles.filter((s) => !s.isCore).flatMap(toAgentMarkets);

  nonCoreMarkets.sort((a, b) => volumeOf(b) - volumeOf(a));

  const propsLimit = Math.max(DEFAULT_PROPS_LIMIT, MIN_TOTAL_MARKETS_FLOOR - coreMarkets.length);
  const topPropMarkets = nonCoreMarkets.slice(0, propsLimit);
  const omittedMarkets = nonCoreMarkets.slice(propsLimit);

  const omittedBySibling = new Map<string, OmittedSibling>();
  for (const m of omittedMarkets) {
    const existing = omittedBySibling.get(m.event_ticker);
    if (existing) {
      existing.omitted_count += 1;
      existing.total_volume += volumeOf(m);
    } else {
      omittedBySibling.set(m.event_ticker, {
        event_ticker: m.event_ticker,
        sibling_title: m.sibling_title,
        omitted_count: 1,
        total_volume: volumeOf(m),
      });
    }
  }

  return {
    siblings: siblingBundles.map(({ event_ticker, series_ticker, title }) => ({ event_ticker, series_ticker, title })),
    core_markets: coreMarkets,
    top_prop_markets: topPropMarkets,
    omitted: [...omittedBySibling.values()],
  };
}

export interface ExpandedSibling {
  event_ticker: string;
  title: string;
  markets: AgentMarket[];
}

export function findExpandedSibling(siblingBundles: SiblingBundle[], expandTicker: string): ExpandedSibling | null {
  const sibling = siblingBundles.find((s) => s.event_ticker === expandTicker);
  if (!sibling) return null;
  return { event_ticker: sibling.event_ticker, title: sibling.title, markets: toAgentMarkets(sibling) };
}

// ---------------------------------------------------------------------------
// Step 5 -- price trend deltas. Reuses the exact same core+top-props
// selection as step 4 (passed in by the caller) so the deltas line up with
// the markets just shown, rather than re-deriving a different market list.
// ---------------------------------------------------------------------------

export interface MarketHistoryEntry {
  ticker: string;
  event_ticker: string;
  sibling_title: string;
  label?: string;
  price_now: number | null;
  delta_1h: number | null;
  delta_6h: number | null;
  delta_24h: number | null;
  direction_24h: "up" | "down" | "flat" | null;
}

function findPriceSeries(sibling: SiblingBundle, ticker: string): CompactPricePoint[] {
  return sibling.bundle.priceHistory?.find((p) => p.market_ticker === ticker)?.points ?? [];
}

// A move smaller than half a cent isn't a meaningful directional signal --
// treat it as flat rather than up/down noise.
const FLAT_THRESHOLD = 0.005;

function deltaAt(points: CompactPricePoint[], priceNow: number | null, hoursAgo: number, nowTs: number): number | null {
  if (priceNow === null) return null;
  const targetTs = nowTs - hoursAgo * 3600;
  const candidates = points.filter((p) => p.t <= targetTs && p.price !== null);
  if (candidates.length === 0) return null;
  const closest = candidates.reduce((a, b) => (b.t > a.t ? b : a));
  return Number((priceNow - (closest.price as number)).toFixed(4));
}

export function computeMarketHistory(siblingBundles: SiblingBundle[], selection: MarketSelection): MarketHistoryEntry[] {
  const nowTs = Math.floor(Date.now() / 1000);
  const bySiblingTicker = new Map(siblingBundles.map((s) => [s.event_ticker, s]));
  const allMarkets = [...selection.core_markets, ...selection.top_prop_markets];

  return allMarkets.map((m) => {
    const sibling = bySiblingTicker.get(m.event_ticker)!;
    const points = findPriceSeries(sibling, m.ticker);
    const priceNow = m.yes_price;
    const delta24h = deltaAt(points, priceNow, 24, nowTs);
    return {
      ticker: m.ticker,
      event_ticker: m.event_ticker,
      sibling_title: m.sibling_title,
      label: m.label,
      price_now: priceNow,
      delta_1h: deltaAt(points, priceNow, 1, nowTs),
      delta_6h: deltaAt(points, priceNow, 6, nowTs),
      delta_24h: delta24h,
      direction_24h:
        delta24h === null ? null : delta24h > FLAT_THRESHOLD ? "up" : delta24h < -FLAT_THRESHOLD ? "down" : "flat",
    };
  });
}

// ---------------------------------------------------------------------------
// Step 6 -- forecast band-width summary. Computed deterministically in code
// (not SQL, not LLM-narrated) from live getEventForecastPercentileHistory --
// this is what catches the bias risk a naive "median moved from A to B"
// hides: the median can stay flat while the 90th-percentile band swings
// widely across consecutive snapshots. Forecast history only resolves for
// numeric-scalar siblings (e.g. totals), not binary threshold markets, so
// this tries each core sibling in turn and returns the first one that has
// data, recording why the rest didn't.
// ---------------------------------------------------------------------------

export interface ForecastSummary {
  event_ticker: string;
  latest: { median: number | null; p10: number | null; p90: number | null; band_width: number | null };
  window_delta_median: number | null;
  band_width_min_in_window: number | null;
  band_width_max_in_window: number | null;
  snapshot_count_in_window: number;
}

export interface ForecastSummaryResult {
  result: ForecastSummary | null;
  unavailable_siblings: Array<{ event_ticker: string; reason: string }>;
}

type ForecastSnapshot = KalshiForecastHistoryResponse["forecast_history"][number];

function percentileValue(snapshot: ForecastSnapshot, percentile: number): number | null {
  const point = snapshot.percentile_points.find((p) => p.percentile === percentile);
  return point?.numerical_forecast ?? point?.raw_numerical_forecast ?? null;
}

function bandWidthOf(snapshot: ForecastSnapshot): number | null {
  const p10 = percentileValue(snapshot, 1000);
  const p90 = percentileValue(snapshot, 9000);
  return p10 !== null && p90 !== null ? p90 - p10 : null;
}

export async function getForecastSummary(siblings: SiblingTicker[], windowHours: number): Promise<ForecastSummaryResult> {
  const nowMs = Date.now();
  const startMs = nowMs - windowHours * 3600 * 1000;
  const unavailable: Array<{ event_ticker: string; reason: string }> = [];

  const coreSiblings = siblings.filter((s) => isCoreSeriesTicker(s.series_ticker));
  const candidates = coreSiblings.length > 0 ? coreSiblings : siblings;

  for (const sibling of candidates) {
    try {
      const history = await getEventForecastPercentileHistory(sibling.series_ticker, sibling.event_ticker, startMs, nowMs);
      const snapshots = [...(history.forecast_history ?? [])].sort((a, b) => a.end_period_ts - b.end_period_ts);
      if (snapshots.length === 0) {
        unavailable.push({ event_ticker: sibling.event_ticker, reason: "No forecast snapshots in window" });
        continue;
      }

      const latestSnap = snapshots[snapshots.length - 1];
      const firstSnap = snapshots[0];
      const latestMedian = percentileValue(latestSnap, 5000);
      const firstMedian = percentileValue(firstSnap, 5000);
      const bandWidths = snapshots.map(bandWidthOf).filter((w): w is number => w !== null);

      return {
        result: {
          event_ticker: sibling.event_ticker,
          latest: {
            median: latestMedian,
            p10: percentileValue(latestSnap, 1000),
            p90: percentileValue(latestSnap, 9000),
            band_width: bandWidthOf(latestSnap),
          },
          window_delta_median: latestMedian !== null && firstMedian !== null ? latestMedian - firstMedian : null,
          band_width_min_in_window: bandWidths.length ? Math.min(...bandWidths) : null,
          band_width_max_in_window: bandWidths.length ? Math.max(...bandWidths) : null,
          snapshot_count_in_window: snapshots.length,
        },
        unavailable_siblings: unavailable,
      };
    } catch (error) {
      unavailable.push({
        event_ticker: sibling.event_ticker,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { result: null, unavailable_siblings: unavailable };
}

// ---------------------------------------------------------------------------
// On-demand, non-linear step -- GET /agent/market-detail?ticker=. Full
// candlestick history, full forecast history, and full rules text for one
// specific market, for when the agent is about to commit real capital and
// wants more than the default summary.
// ---------------------------------------------------------------------------

export interface MarketDetailCandlePoint {
  t: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  open_interest: number | null;
}

export interface MarketDetail {
  ticker: string;
  label?: string;
  status?: string;
  result?: string;
  yes_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  rules_primary?: string;
  rules_secondary?: string;
  candlesticks: MarketDetailCandlePoint[];
  forecast_history: KalshiForecastHistoryResponse["forecast_history"] | null;
}

export async function getMarketDetail(ticker: string): Promise<MarketDetail> {
  const { market } = await getMarket(ticker);
  const { event } = await getEvent(market.event_ticker);

  const nowTs = Math.floor(Date.now() / 1000);
  const startTs = market.open_time ? Math.floor(Date.parse(market.open_time) / 1000) : nowTs - 30 * 86400;
  const endTs = market.close_time ? Math.min(Math.floor(Date.parse(market.close_time) / 1000), nowTs) : nowTs;
  const periodInterval = (endTs - startTs) / 86400 > 7 ? 1440 : 60;

  const [candlesticks, forecastHistory] = await Promise.all([
    getEventCandlesticks(event.series_ticker, event.event_ticker, startTs, endTs, periodInterval).catch(() => null),
    getEventForecastPercentileHistory(event.series_ticker, event.event_ticker, startTs * 1000, endTs * 1000).catch(() => null),
  ]);

  const idx = candlesticks?.market_tickers.indexOf(ticker) ?? -1;
  const points = candlesticks && idx >= 0 ? candlesticks.market_candlesticks[idx] : [];

  return {
    ticker: market.ticker,
    label: market.yes_sub_title,
    status: market.status,
    result: market.result,
    yes_price: parseNum(market.last_price_dollars),
    yes_bid: parseNum(market.yes_bid_dollars),
    yes_ask: parseNum(market.yes_ask_dollars),
    rules_primary: market.rules_primary,
    rules_secondary: market.rules_secondary,
    candlesticks: (points ?? []).map((p) => ({
      t: p.end_period_ts,
      open: parseNum(p.price?.open_dollars),
      high: parseNum(p.price?.high_dollars),
      low: parseNum(p.price?.low_dollars),
      close: parseNum(p.price?.close_dollars),
      volume: parseNum(p.volume_fp),
      open_interest: parseNum(p.open_interest_fp),
    })),
    forecast_history: forecastHistory?.forecast_history ?? null,
  };
}
