import crypto from "crypto";

const KALSHI_API_BASE = "https://external-api.kalshi.com/trade-api/v2";

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  market_type?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  open_time?: string;
  close_time?: string;
  status?: string;
  // Kalshi returns all of these as numeric strings, not JSON numbers.
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  volume_fp?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  result?: string;
  strike_type?: string;
  floor_strike?: number;
  cap_strike?: number;
  rules_primary?: string;
  rules_secondary?: string;
  mve_collection_ticker?: string | null;
  mve_selected_legs?: unknown[];
  [key: string]: unknown;
}

export interface KalshiEvent {
  event_ticker: string;
  series_ticker: string;
  title: string;
  sub_title?: string;
  collateral_return_type?: string;
  mutually_exclusive?: boolean;
  strike_date?: string;
  strike_period?: string;
  last_updated_ts?: number;
  [key: string]: unknown;
}

export interface KalshiEventResponse {
  event: KalshiEvent;
  markets: KalshiMarket[];
}

export interface KalshiEventMetadata {
  image_url?: string;
  featured_image_url?: string;
  market_details?: Array<{
    market_ticker: string;
    image_url?: string;
    color_code?: string;
  }>;
  settlement_sources?: Array<{ name: string; url?: string }>;
  competition?: string;
  competition_scope?: string;
  [key: string]: unknown;
}

export interface KalshiCandlestickPoint {
  end_period_ts: number;
  price?: {
    open_dollars?: string;
    high_dollars?: string;
    low_dollars?: string;
    close_dollars?: string;
    mean_dollars?: string;
    previous_dollars?: string;
  };
  yes_bid?: { open_dollars?: string; high_dollars?: string; low_dollars?: string; close_dollars?: string };
  yes_ask?: { open_dollars?: string; high_dollars?: string; low_dollars?: string; close_dollars?: string };
  volume_fp?: string;
  open_interest_fp?: string;
}

export interface KalshiCandlestickResponse {
  market_tickers: string[];
  market_candlesticks: KalshiCandlestickPoint[][];
  [key: string]: unknown;
}

export interface KalshiForecastHistoryResponse {
  forecast_history: Array<{
    event_ticker: string;
    end_period_ts: number;
    period_interval: number;
    percentile_points: Array<{
      percentile: number;
      raw_numerical_forecast?: number;
      numerical_forecast?: number;
      formatted_forecast?: string;
    }>;
  }>;
  [key: string]: unknown;
}

export interface KalshiMultivariateEventsResponse {
  events: KalshiEvent[];
  cursor?: string;
  [key: string]: unknown;
}

export interface EventBundle {
  event: KalshiEvent;
  markets: KalshiMarket[];
  periodInterval: number;
  metadata: KalshiEventMetadata | null;
  candlesticks: KalshiCandlestickResponse | null;
  forecastHistory: KalshiForecastHistoryResponse | null;
  multivariateEvents?: KalshiMultivariateEventsResponse | null;
  /** Sections above that failed to load and why (e.g. forecast history isn't
   * available for events made up of only binary threshold markets). */
  partialErrors: Record<string, string>;
}

export interface EventBundleOptions {
  startTs?: number;
  endTs?: number;
  periodInterval?: number;
  percentiles?: number[];
}

const DEFAULT_PERIOD_INTERVAL = 60;
const DEFAULT_PERCENTILES = [1000, 2500, 5000, 7500, 9000];

async function kalshiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${KALSHI_API_BASE}${path}`);

  if (!response.ok) {
    throw new Error(
      `Kalshi request to ${path} failed: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as T;
}

export async function getEvent(eventTicker: string): Promise<KalshiEventResponse> {
  return kalshiGet<KalshiEventResponse>(
    `/events/${encodeURIComponent(eventTicker)}?with_nested_markets=false`
  );
}

export async function getEventMetadata(
  eventTicker: string
): Promise<KalshiEventMetadata> {
  return kalshiGet<KalshiEventMetadata>(
    `/events/${encodeURIComponent(eventTicker)}/metadata`
  );
}

export async function getEventCandlesticks(
  seriesTicker: string,
  eventTicker: string,
  startTs: number,
  endTs: number,
  periodInterval: number = DEFAULT_PERIOD_INTERVAL
): Promise<KalshiCandlestickResponse> {
  const params = new URLSearchParams({
    start_ts: String(startTs),
    end_ts: String(endTs),
    period_interval: String(periodInterval),
  });

  return kalshiGet<KalshiCandlestickResponse>(
    `/series/${encodeURIComponent(seriesTicker)}/events/${encodeURIComponent(
      eventTicker
    )}/candlesticks?${params.toString()}`
  );
}

export async function getEventForecastPercentileHistory(
  seriesTicker: string,
  eventTicker: string,
  startTsMs: number,
  endTsMs: number,
  percentiles: number[] = DEFAULT_PERCENTILES,
  periodInterval: number = DEFAULT_PERIOD_INTERVAL
): Promise<KalshiForecastHistoryResponse> {
  const params = new URLSearchParams({
    start_ts: String(startTsMs),
    end_ts: String(endTsMs),
    period_interval: String(periodInterval),
  });
  for (const percentile of percentiles) {
    params.append("percentiles", String(percentile));
  }

  return kalshiGet<KalshiForecastHistoryResponse>(
    `/series/${encodeURIComponent(seriesTicker)}/events/${encodeURIComponent(
      eventTicker
    )}/forecast_percentile_history?${params.toString()}`
  );
}

export async function getMultivariateEvents(
  collectionTicker: string
): Promise<KalshiMultivariateEventsResponse> {
  const params = new URLSearchParams({ collection_ticker: collectionTicker });

  return kalshiGet<KalshiMultivariateEventsResponse>(
    `/events/multivariate?${params.toString()}`
  );
}

export interface KalshiMarketResponse {
  market: KalshiMarket;
}

export async function getMarket(marketTicker: string): Promise<KalshiMarketResponse> {
  return kalshiGet<KalshiMarketResponse>(`/markets/${encodeURIComponent(marketTicker)}`);
}

export interface ResolvedTickers {
  seriesTicker: string;
  eventTicker: string;
}

// Kalshi market page URLs look like:
//   https://kalshi.com/markets/{series-slug}/{title-slug}/{ticker-slug}
// where {ticker-slug} is either the bare event ticker or a specific market's
// ticker (event ticker + "-SUFFIX"), lowercased.
const KALSHI_MARKET_URL_PATTERN = /kalshi\.com\/markets\/[^/]+\/[^/]+\/([^/?#]+)/i;

export function extractTickerSlugFromKalshiUrl(url: string): string {
  const match = url.match(KALSHI_MARKET_URL_PATTERN);
  if (!match) {
    throw new Error(`Could not find a ticker in Kalshi market URL: ${url}`);
  }
  return match[1].toUpperCase();
}

/** Given a kalshi.com market page URL, resolves the authoritative
 * series_ticker/event_ticker via the API (rather than trusting the URL slug
 * casing/shape), handling both event-page and specific-market-page URLs. */
export async function resolveKalshiMarketUrl(url: string): Promise<ResolvedTickers> {
  const candidate = extractTickerSlugFromKalshiUrl(url);

  try {
    const { event } = await getEvent(candidate);
    return { seriesTicker: event.series_ticker, eventTicker: event.event_ticker };
  } catch {
    // candidate wasn't a bare event ticker — fall through and try it as a market ticker
  }

  const { market } = await getMarket(candidate);
  const { event } = await getEvent(market.event_ticker);
  return { seriesTicker: event.series_ticker, eventTicker: event.event_ticker };
}

function toUnixSeconds(dateString: string | undefined, fallback: number): number {
  if (!dateString) return fallback;
  const parsed = Date.parse(dateString);
  return Number.isNaN(parsed) ? fallback : Math.floor(parsed / 1000);
}

/** Runs an optional bundle section, capturing failures instead of rejecting
 * the whole bundle — Kalshi's sports events are made up entirely of binary
 * threshold markets, so e.g. forecast_percentile_history (which needs a true
 * numerical-scalar market) legitimately 400s for most/all of them. */
async function loadOptional<T>(
  label: string,
  partialErrors: Record<string, string>,
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    partialErrors[label] = error instanceof Error ? error.message : "Unknown error";
    return null;
  }
}

async function fetchRawEventBundle(
  seriesTicker: string,
  eventTicker: string,
  opts: EventBundleOptions = {}
): Promise<EventBundle> {
  const { event, markets } = await getEvent(eventTicker);

  // The event object itself carries no open/close times; derive the window
  // that covers this match's actual trading activity from its markets.
  const marketOpenTimes = markets.map((m) => toUnixSeconds(m.open_time, NaN)).filter((t) => !Number.isNaN(t));
  const marketCloseTimes = markets.map((m) => toUnixSeconds(m.close_time, NaN)).filter((t) => !Number.isNaN(t));
  const now = Math.floor(Date.now() / 1000);

  const startTs = opts.startTs ?? (marketOpenTimes.length ? Math.min(...marketOpenTimes) : now - 86400);
  const endTs = opts.endTs ?? Math.min(marketCloseTimes.length ? Math.max(...marketCloseTimes) : now, now);
  // Keep candlestick point counts bounded without losing the trend signal:
  // hourly detail matters through the week before an event (this is where
  // odds move most, e.g. on injury/lineup news), daily resolution is plenty
  // once the window spans multiple weeks (~168 hourly points max either way).
  const spanDays = (endTs - startTs) / 86400;
  const autoPeriodInterval = spanDays > 7 ? 1440 : DEFAULT_PERIOD_INTERVAL;
  const periodInterval = opts.periodInterval ?? autoPeriodInterval;
  const percentiles = opts.percentiles ?? DEFAULT_PERCENTILES;

  const partialErrors: Record<string, string> = {};

  const [metadata, candlesticks, forecastHistory] = await Promise.all([
    loadOptional("metadata", partialErrors, () => getEventMetadata(eventTicker)),
    loadOptional("candlesticks", partialErrors, () =>
      getEventCandlesticks(seriesTicker, eventTicker, startTs, endTs, periodInterval)
    ),
    loadOptional("forecastHistory", partialErrors, () =>
      getEventForecastPercentileHistory(
        seriesTicker,
        eventTicker,
        startTs * 1000,
        endTs * 1000,
        percentiles,
        periodInterval
      )
    ),
  ]);

  const bundle: EventBundle = { event, markets, periodInterval, metadata, candlesticks, forecastHistory, partialErrors };

  const collectionTicker = markets.find((m) => m.mve_collection_ticker)?.mve_collection_ticker;
  if (collectionTicker) {
    bundle.multivariateEvents = await loadOptional("multivariateEvents", partialErrors, () =>
      getMultivariateEvents(collectionTicker)
    );
  }

  return bundle;
}

// ---------------------------------------------------------------------------
// Compact bundle: same underlying facts, stripped of everything an LLM
// doesn't need to reason about a match (legal boilerplate, image/contract
// URLs, redundant timestamps, and — the biggest offender — candlestick
// open/high/low/mean for price *and* separately for bid *and* ask, which is
// ~15 numbers per time bucket when 2-3 capture the same trend).
//
// getEventBundle() below is the only public entry point for fetching an
// event's data, and it always returns this compact shape — the raw shape
// exists only as an internal fetching step (fetchRawEventBundle), never as
// something a caller can ask for. Keeping the two forms in one file made
// sense while both were reachable; if that stops being true, split this.
// ---------------------------------------------------------------------------

export interface CompactMarket {
  ticker: string;
  label?: string;
  status?: string;
  result?: string;
  yes_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  volume_24h: number | null;
  open_interest: number | null;
  open_time?: string;
  close_time?: string;
  rules?: string;
}

export interface CompactPricePoint {
  t: number;
  price: number | null;
  volume: number | null;
  open_interest: number | null;
}

export interface CompactPriceSeries {
  market_ticker: string;
  points: CompactPricePoint[];
}

export interface CompactEventBundle {
  event: {
    ticker: string;
    title: string;
    sub_title?: string;
    competition?: string;
    competition_scope?: string;
  };
  markets: CompactMarket[];
  priceHistory?: CompactPriceSeries[];
  priceHistoryPeriodInterval?: number;
  forecastHistory?: KalshiForecastHistoryResponse["forecast_history"];
  multivariateEvents?: Array<{ event_ticker: string; title: string }>;
  partialErrors?: Record<string, string>;
}

export function parseNum(value: string | undefined | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export function toCompactBundle(bundle: EventBundle): CompactEventBundle {
  const compact: CompactEventBundle = {
    event: {
      ticker: bundle.event.event_ticker,
      title: bundle.event.title,
      sub_title: bundle.event.sub_title,
      competition: bundle.metadata?.competition,
      competition_scope: bundle.metadata?.competition_scope,
    },
    markets: bundle.markets.map((m) => ({
      ticker: m.ticker,
      label: m.yes_sub_title,
      status: m.status,
      result: m.result || undefined,
      yes_price: parseNum(m.last_price_dollars),
      yes_bid: parseNum(m.yes_bid_dollars),
      yes_ask: parseNum(m.yes_ask_dollars),
      volume: parseNum(m.volume_fp),
      volume_24h: parseNum(m.volume_24h_fp),
      open_interest: parseNum(m.open_interest_fp),
      open_time: m.open_time,
      close_time: m.close_time,
      rules: m.rules_primary as string | undefined,
    })),
  };

  if (bundle.candlesticks) {
    compact.priceHistory = bundle.candlesticks.market_tickers.map((ticker, i) => ({
      market_ticker: ticker,
      points: (bundle.candlesticks!.market_candlesticks[i] ?? []).map((p) => ({
        t: p.end_period_ts,
        price: parseNum(p.price?.close_dollars),
        volume: parseNum(p.volume_fp),
        open_interest: parseNum(p.open_interest_fp),
      })),
    }));
    compact.priceHistoryPeriodInterval = bundle.periodInterval;
  }

  if (bundle.forecastHistory) {
    compact.forecastHistory = bundle.forecastHistory.forecast_history;
  }

  if (bundle.multivariateEvents) {
    compact.multivariateEvents = bundle.multivariateEvents.events.map((e) => ({
      event_ticker: e.event_ticker,
      title: e.title,
    }));
  }

  if (Object.keys(bundle.partialErrors).length > 0) {
    compact.partialErrors = bundle.partialErrors;
  }

  return compact;
}

/** Fetches everything Kalshi has for one event and returns it in the compact
 * shape — this is the only way to get event data out of this module; there
 * is no way to ask for the raw, uncompacted bundle. */
export async function getEventBundle(
  seriesTicker: string,
  eventTicker: string,
  opts: EventBundleOptions = {}
): Promise<CompactEventBundle> {
  const bundle = await fetchRawEventBundle(seriesTicker, eventTicker, opts);
  return toCompactBundle(bundle);
}

/** Resolves related event tickers (like moneylines, spreads, prop bets) for a given
 * sports event ticker by fetching associated milestones for the series. */
export async function getMilestoneRelatedTickers(
  seriesTicker: string,
  eventTicker: string
): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      series_ticker: seriesTicker,
      with_milestones: "true",
      limit: "100",
    });
    const data = await kalshiGet<{
      events: KalshiEvent[];
      milestones?: Array<{
        primary_event_tickers?: string[];
        related_event_tickers?: string[];
      }>;
    }>(`/events?${params.toString()}`);

    if (data.milestones && data.milestones.length > 0) {
      // Find the milestone containing our eventTicker
      const matchMilestone = data.milestones.find(
        (m) =>
          m.primary_event_tickers?.includes(eventTicker) ||
          m.related_event_tickers?.includes(eventTicker)
      );
      if (matchMilestone && matchMilestone.related_event_tickers) {
        // Filter out duplicates, and exclude announcer mentions-related tickers
        return Array.from(new Set(matchMilestone.related_event_tickers))
          .filter((t) => !t.toLowerCase().includes("mention"));
      }
    }
  } catch (error) {
    console.error("Failed to resolve related event tickers via milestones:", error);
  }
  return [eventTicker]; // fallback to just the input event
}

export function getDeterministicUuid(str: string): string {
  const hash = crypto.createHash("sha256").update(str).digest("hex");
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32),
  ].join("-");
}

export async function getMilestoneId(seriesTicker: string, eventTicker: string): Promise<string> {
  try {
    const params = new URLSearchParams({
      series_ticker: seriesTicker,
      with_milestones: "true",
      limit: "100",
    });
    const data = await kalshiGet<{
      events: KalshiEvent[];
      milestones?: Array<{
        id: string;
        primary_event_tickers?: string[];
        related_event_tickers?: string[];
      }>;
    }>(`/events?${params.toString()}`);

    if (data.milestones && data.milestones.length > 0) {
      const matchMilestone = data.milestones.find(
        (m) =>
          m.primary_event_tickers?.includes(eventTicker) ||
          m.related_event_tickers?.includes(eventTicker)
      );
      if (matchMilestone && matchMilestone.id) {
        return matchMilestone.id;
      }
    }
  } catch (error) {
    console.error("Failed to find milestone ID via API:", error);
  }
  return getDeterministicUuid(eventTicker);
}
