const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CLOB_API_BASE = "https://clob.polymarket.com";

// ---------------------------------------------------------------------------
// Raw Polymarket shapes (Gamma API). Polymarket's structural mismatch with
// Kalshi: a single real-world match (e.g. "Chelsea vs PSG") is NOT one event
// with many nested markets — it's *several* sibling event resources ("90 Min
// Result", "Exact Score", "Both Teams To Score?", "Method of Win", "Goal
// Scorers", ...), each with its own id/slug and its own small set of nested
// markets. There is no series/parent-event field linking them (verified:
// `series` is null and tags are competition-level, e.g. "FIFA Club World
// Cup", not match-level). So "one Kalshi event" maps to "a cluster of
// Polymarket events for the same match", not a 1:1 event mapping. See
// findMatchEvents + getMatchBundle below for how we bridge that gap.
// ---------------------------------------------------------------------------

export interface PolymarketTag {
  id: string;
  label: string;
  slug: string;
  [key: string]: unknown;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  conditionId?: string;
  slug?: string;
  description?: string;
  groupItemTitle?: string;
  // Polymarket returns these as JSON-stringified arrays, not JSON arrays -
  // e.g. outcomes: '["Yes","No"]'. Parse with parseJsonArray().
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  startDate?: string;
  endDate?: string;
  volume?: string;
  volumeNum?: number;
  volume24hr?: number;
  liquidity?: string;
  liquidityNum?: number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  spread?: number;
  umaResolutionStatus?: string;
  [key: string]: unknown;
}

export interface PolymarketEvent {
  id: string;
  ticker?: string;
  slug: string;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume?: number;
  volume24hr?: number;
  openInterest?: number;
  liquidity?: number;
  image?: string;
  tags?: PolymarketTag[];
  markets: PolymarketMarket[];
  [key: string]: unknown;
}

export interface PolymarketSearchResponse {
  events: PolymarketEvent[];
  pagination: { hasMore: boolean; totalResults: number };
  [key: string]: unknown;
}

export interface PolymarketPriceHistoryPoint {
  t: number;
  p: number;
}

export interface PolymarketPriceHistoryResponse {
  history: PolymarketPriceHistoryPoint[];
}

async function gammaGet<T>(path: string): Promise<T> {
  const response = await fetch(`${GAMMA_API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`Polymarket request to ${path} failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function clobGet<T>(path: string): Promise<T> {
  const response = await fetch(`${CLOB_API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`Polymarket CLOB request to ${path} failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function parseJsonArray(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseNum(value: string | number | undefined | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export async function getEvent(eventId: string): Promise<PolymarketEvent> {
  return gammaGet<PolymarketEvent>(`/events/${encodeURIComponent(eventId)}`);
}

export async function getEventBySlug(slug: string): Promise<PolymarketEvent> {
  return gammaGet<PolymarketEvent>(`/events/slug/${encodeURIComponent(slug)}`);
}

export async function getEventTags(eventId: string): Promise<PolymarketTag[]> {
  return gammaGet<PolymarketTag[]>(`/events/${encodeURIComponent(eventId)}/tags`);
}

export async function getMarket(marketId: string): Promise<PolymarketMarket> {
  return gammaGet<PolymarketMarket>(`/markets/${encodeURIComponent(marketId)}`);
}

export interface SearchEventsOptions {
  status?: "active" | "closed" | "all";
  limit?: number;
}

// Unlike Kalshi (no free-text search endpoint - you have to know the
// series_ticker), Polymarket's Gamma API has a real full-text search. This is
// the ask-1 primitive: find candidate events for a match by team names.
export async function searchEvents(
  query: string,
  opts: SearchEventsOptions = {}
): Promise<PolymarketSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    limit_per_type: String(opts.limit ?? 20),
  });
  if (opts.status && opts.status !== "all") {
    params.set("events_status", opts.status);
  }
  return gammaGet<PolymarketSearchResponse>(`/public-search?${params.toString()}`);
}

export interface MatchEventCandidate {
  id: string;
  slug: string;
  title: string;
  startDate?: string;
  endDate?: string;
  closed: boolean;
  volume: number;
  category?: string;
}

function primaryTagLabel(tags: PolymarketTag[] | undefined): string | undefined {
  // Tags are competition-scoped, not match-scoped (e.g. "Sports", "Soccer",
  // "FIFA Club World Cup") - skip the generic top-level ones to surface the
  // most specific one, which is the closest analog to Kalshi's `competition`.
  const GENERIC = new Set(["sports", "games", "soccer", "football"]);
  return tags?.find((t) => !GENERIC.has(t.slug?.toLowerCase()))?.label ?? tags?.[0]?.label;
}

/** Ask 1: find all Polymarket events relevant to one real-world match.
 *
 * Pass something like "Spain vs France" or "Chelsea PSG". Because a single
 * match is split across several sibling event resources on Polymarket (see
 * module header), this returns *all* matching candidates rather than one
 * event - review the titles and pass the relevant ids into getMatchBundle.
 * Results are sorted by volume desc so the primary moneyline/result market
 * usually surfaces first. */
export async function findMatchEvents(
  query: string,
  opts: SearchEventsOptions = {}
): Promise<MatchEventCandidate[]> {
  const { events } = await searchEvents(query, opts);
  return events
    .map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      closed: Boolean(e.closed),
      volume: e.volume ?? 0,
      category: primaryTagLabel(e.tags),
    }))
    .sort((a, b) => b.volume - a.volume);
}

export interface ResolvedPolymarketEvent {
  eventId: string;
  slug: string;
}

// polymarket.com event page URLs look like:
//   https://polymarket.com/event/{event-slug}
//   https://polymarket.com/event/{event-slug}/{market-slug}
const POLYMARKET_EVENT_URL_PATTERN = /polymarket\.com\/event\/([^/?#]+)/i;

export function extractEventSlugFromPolymarketUrl(url: string): string {
  const match = url.match(POLYMARKET_EVENT_URL_PATTERN);
  if (!match) {
    throw new Error(`Could not find an event slug in Polymarket URL: ${url}`);
  }
  return match[1];
}

export async function resolvePolymarketEventUrl(url: string): Promise<ResolvedPolymarketEvent> {
  const slug = extractEventSlugFromPolymarketUrl(url);
  const event = await getEventBySlug(slug);
  return { eventId: event.id, slug: event.slug };
}

export async function getMarketPriceHistory(
  clobTokenId: string,
  startTs: number,
  endTs: number,
  fidelity = 60
): Promise<PolymarketPriceHistoryResponse> {
  const params = new URLSearchParams({
    market: clobTokenId,
    startTs: String(startTs),
    endTs: String(endTs),
    fidelity: String(fidelity),
  });
  return clobGet<PolymarketPriceHistoryResponse>(`/prices-history?${params.toString()}`);
}

export interface MatchBundleOptions {
  startTs?: number;
  endTs?: number;
  fidelity?: number;
}

export interface MatchBundleMarket extends PolymarketMarket {
  source_event_id: string;
  source_event_title: string;
}

export interface MatchPriceSeries {
  market_id: string;
  clob_token_id: string;
  outcome: string;
  points: PolymarketPriceHistoryPoint[];
}

export interface MatchBundle {
  match: {
    title: string;
    startDate?: string;
    endDate?: string;
    competition?: string;
  };
  events: Array<{ id: string; slug: string; title: string }>;
  markets: MatchBundleMarket[];
  priceHistory: MatchPriceSeries[];
  partialErrors: Record<string, string>;
}

function toUnixSeconds(dateString: string | undefined, fallback: number): number {
  if (!dateString) return fallback;
  const parsed = Date.parse(dateString);
  return Number.isNaN(parsed) ? fallback : Math.floor(parsed / 1000);
}

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

/** Ask 2: aggregate everything Polymarket has for one match into a single
 * bundle, shaped as close to Kalshi's EventBundle as the underlying data
 * allows. `eventIds` should be the ids of the sibling events that all belong
 * to the same real-world match (from findMatchEvents) - their markets are
 * flattened into one `markets` array (each tagged with which sibling event it
 * came from), mirroring how a single Kalshi event nests many markets. */
export async function getMatchBundle(
  eventIds: string[],
  opts: MatchBundleOptions = {}
): Promise<MatchBundle> {
  if (eventIds.length === 0) {
    throw new Error("getMatchBundle requires at least one event id");
  }

  const partialErrors: Record<string, string> = {};

  const events = await Promise.all(eventIds.map((id) => getEvent(id)));

  const markets: MatchBundleMarket[] = events.flatMap((e) =>
    e.markets.map((m) => ({ ...m, source_event_id: e.id, source_event_title: e.title }))
  );

  const earliestEvent = [...events].sort(
    (a, b) => toUnixSeconds(a.startDate, Infinity) - toUnixSeconds(b.startDate, Infinity)
  )[0];

  const competition = await loadOptional("competition", partialErrors, async () => {
    const tags = await getEventTags(earliestEvent.id);
    return primaryTagLabel(tags) ?? null;
  });

  const startTimes = events.map((e) => toUnixSeconds(e.startDate, NaN)).filter((t) => !Number.isNaN(t));
  const endTimes = events.map((e) => toUnixSeconds(e.endDate, NaN)).filter((t) => !Number.isNaN(t));
  const now = Math.floor(Date.now() / 1000);

  const startTs = opts.startTs ?? (startTimes.length ? Math.min(...startTimes) : now - 86400);
  const endTs = opts.endTs ?? Math.min(endTimes.length ? Math.max(...endTimes) : now, now);
  const spanDays = (endTs - startTs) / 86400;
  const fidelity = opts.fidelity ?? (spanDays > 7 ? 1440 : 60);

  const priceHistoryResults = await Promise.all(
    markets.map(async (m) => {
      const tokenIds = parseJsonArray(m.clobTokenIds);
      const outcomes = parseJsonArray(m.outcomes);
      const yesTokenId = tokenIds[0];
      if (!yesTokenId) return null;

      const result = await loadOptional(`priceHistory:${m.id}`, partialErrors, () =>
        getMarketPriceHistory(yesTokenId, startTs, endTs, fidelity)
      );
      if (!result) return null;

      return {
        market_id: m.id,
        clob_token_id: yesTokenId,
        outcome: outcomes[0] ?? "Yes",
        points: result.history,
      } satisfies MatchPriceSeries;
    })
  );

  return {
    match: {
      title: earliestEvent.title,
      startDate: earliestEvent.startDate,
      endDate: [...events].sort(
        (a, b) => toUnixSeconds(b.endDate, 0) - toUnixSeconds(a.endDate, 0)
      )[0]?.endDate,
      competition: competition ?? undefined,
    },
    events: events.map((e) => ({ id: e.id, slug: e.slug, title: e.title })),
    markets,
    priceHistory: priceHistoryResults.filter((r): r is MatchPriceSeries => r !== null),
    partialErrors,
  };
}

// ---------------------------------------------------------------------------
// Compact bundle: mirrors kalshiEvents.ts's toCompactBundle. Strips
// descriptions/images/legal text and normalizes Polymarket's JSON-stringified
// numeric fields down to the same { yes_price, yes_bid, yes_ask, volume,
// open_interest } shape used for Kalshi markets, so both APIs can be
// processed identically downstream.
//
// Two data-availability gaps vs Kalshi, both surfaced via partialErrors
// rather than silently omitted:
//  - No forecast percentile history: Polymarket has no scalar/numeric-market
//    forecast endpoint - priceHistory of the moneyline market is the closest
//    analog to Kalshi's forecastHistory.
//  - No true open_interest: `liquidityNum` (resting order book depth) is
//    the closest proxy Polymarket exposes; it is not the same metric as
//    Kalshi's settled open interest.
// ---------------------------------------------------------------------------

export interface CompactMatchMarket {
  id: string;
  label?: string;
  source_event: string;
  status?: string;
  result?: string;
  yes_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  volume_24h: number | null;
  liquidity: number | null;
  open_time?: string;
  close_time?: string;
  rules?: string;
}

export interface CompactMatchPricePoint {
  t: number;
  price: number;
}

export interface CompactMatchPriceSeries {
  market_id: string;
  outcome: string;
  points: CompactMatchPricePoint[];
}

export interface CompactMatchBundle {
  match: MatchBundle["match"];
  events: MatchBundle["events"];
  markets: CompactMatchMarket[];
  priceHistory: CompactMatchPriceSeries[];
  partialErrors?: Record<string, string>;
}

function marketStatus(m: PolymarketMarket): string {
  if (m.closed) return "closed";
  if (m.active === false) return "inactive";
  return "active";
}

function marketResult(m: PolymarketMarket): string | undefined {
  if (!m.closed) return undefined;
  const prices = parseJsonArray(m.outcomePrices).map(Number);
  const outcomes = parseJsonArray(m.outcomes);
  const winnerIndex = prices.findIndex((p) => p === 1);
  return winnerIndex >= 0 ? outcomes[winnerIndex] : undefined;
}

export function toCompactMatchBundle(bundle: MatchBundle): CompactMatchBundle {
  const compact: CompactMatchBundle = {
    match: bundle.match,
    events: bundle.events,
    markets: bundle.markets.map((m) => {
      const prices = parseJsonArray(m.outcomePrices).map(Number);
      return {
        id: m.id,
        label: m.groupItemTitle || m.question,
        source_event: m.source_event_title,
        status: marketStatus(m),
        result: marketResult(m),
        // outcomePrices is authoritative in both open and closed states;
        // lastTradePrice is only a fallback because Polymarket leaves it
        // stuck at the price of whichever token last traded (observed: "1"
        // on every sibling market of a resolved event, winner and losers
        // alike) rather than updating it to the settled price.
        yes_price: prices[0] ?? parseNum(m.lastTradePrice),
        yes_bid: parseNum(m.bestBid),
        yes_ask: parseNum(m.bestAsk),
        volume: parseNum(m.volumeNum ?? m.volume),
        volume_24h: parseNum(m.volume24hr),
        liquidity: parseNum(m.liquidityNum ?? m.liquidity),
        open_time: m.startDate,
        close_time: m.endDate,
        rules: m.description,
      };
    }),
    priceHistory: bundle.priceHistory.map((series) => ({
      market_id: series.market_id,
      outcome: series.outcome,
      points: series.points.map((p) => ({ t: p.t, price: p.p })),
    })),
  };

  if (Object.keys(bundle.partialErrors).length > 0) {
    compact.partialErrors = bundle.partialErrors;
  }

  return compact;
}
