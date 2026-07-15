import { getSupabaseClient } from "../supabase/supabaseClient";
import {
  getEventBundle,
  getMilestoneId,
  getMilestoneRelatedTickers,
  type CompactEventBundle,
  type CompactMarket,
  type EventBundleOptions,
} from "./kalshiEvents";
import { buildMarketSelection, type SiblingBundle } from "../agent/agentKalshi";
import { isCoreSeriesTicker } from "../agent/agentMarketConfig";

// ---------------------------------------------------------------------------
// Writes one Kalshi event's compact bundle into Supabase across
// events/markets/market_price_history/event_forecast_*/event_related_events.
// Insert-only: markets rows are documented as "snapshot as of ingestion, not
// kept live" (see supabase/migrations), so re-ingesting an event that's
// already in the DB is treated as an error (EventAlreadyIngestedError)
// rather than silently overwriting a frozen snapshot other data (e.g.
// predictions) may already reference.
//
// Market selection is capped at ingestion time using the exact same
// core+top-props-by-volume logic the agent pipeline's /agent/markets step
// already computes live (buildMarketSelection in agentKalshi.ts) -- core
// siblings (moneyline/spread/total/advance) are kept in full, non-core prop
// siblings are pooled and capped to a floor of 50 total. This freezes ONE
// market universe per event at ingestion time: the frontend sidebar
// (market-snapshot, a plain unfiltered read of the `markets` table) and the
// agent pipeline (which now filters its live Kalshi fetch down to this same
// ticker set, see server.ts's /agent/markets and /agent/history) both read
// from it, so there's a single source of truth instead of the sidebar
// showing every market Kalshi has while the agent independently recomputes
// its own top-50 selection on every call. Deliberately NOT re-evaluated
// later -- a market drifting in or out of the top 50 after ingestion is not
// tracked; this is a one-time snapshot at event-creation time, same
// simplicity tradeoff as the rest of this table already documents.
//
// No cross-table transaction: supabase-js has no multi-table transaction
// primitive without a Postgres RPC function, and nothing else in this
// codebase uses one either. A failure partway through this function leaves
// a real `events` row behind with some child tables unpopulated, and since
// ingestion is insert-only, that event_ticker becomes permanently
// un-retryable through this function (the existence check will always find
// it and throw EventAlreadyIngestedError). Accepted trade-off for a
// low-traffic personal tool; the escape hatch is a manual DELETE (children
// first, then the events row — none of these FKs cascade) via the Supabase
// SQL editor.
// ---------------------------------------------------------------------------

export class EventAlreadyIngestedError extends Error {
  constructor(eventTicker: string) {
    super(`Event already ingested: ${eventTicker}`);
    this.name = "EventAlreadyIngestedError";
  }
}

export interface IngestResult {
  event_id: string;
  event_ticker: string;
  series_ticker: string;
  markets: number;
  price_history_points: number;
  forecast_percentiles: number;
  partialErrors?: Record<string, string>;
}

function toIsoFromUnixSeconds(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function minMaxIso(values: (string | undefined)[]): { min: string | null; max: string | null } {
  const parsed = values
    .map((v) => (v ? Date.parse(v) : NaN))
    .filter((t) => !Number.isNaN(t));
  if (parsed.length === 0) return { min: null, max: null };
  return {
    min: new Date(Math.min(...parsed)).toISOString(),
    max: new Date(Math.max(...parsed)).toISOString(),
  };
}

// Simple v1 rule, coarser than Kalshi's actual status vocabulary: any market
// still "active" means the event is tradeable ("open"); if every market has
// reached "settled" the event is fully resolved; anything else (unopened,
// mixed, closed-but-unsettled) falls back to "closed".
function deriveEventStatus(markets: CompactMarket[]): string | null {
  if (markets.length === 0) return null;
  if (markets.some((m) => m.status === "active")) return "open";
  if (markets.every((m) => m.status === "settled")) return "settled";
  return "closed";
}

async function isTickerAlreadyIngested(eventTicker: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("event_tickers")
    .select("event_ticker")
    .eq("event_ticker", eventTicker)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to check for existing ticker ${eventTicker}: ${error.message}`);
  }
  return data !== null;
}

/** Inserts the parent `events` row if it doesn't exist yet, otherwise widens
 * its open/close/match-start bounding window to cover this sibling's
 * markets too. Shared across every sibling of a consolidated event, since
 * they all resolve to the same Milestone ID. */
async function ensureEventRow(
  eventId: string,
  bundle: CompactEventBundle,
  openTime: string | null,
  closeTime: string | null,
  matchStartTime: string | null,
  status: string | null
): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: existingEvent, error: eventCheckError } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventCheckError) {
    throw new Error(`Failed to check for existing event ${eventId}: ${eventCheckError.message}`);
  }

  if (!existingEvent) {
    const { error: eventInsertError } = await supabase.from("events").insert({
      id: eventId,
      event_name: bundle.event.title,
      sub_title: bundle.event.sub_title ?? null,
      competition: bundle.event.competition ?? null,
      competition_scope: bundle.event.competition_scope ?? null,
      open_time: openTime,
      close_time: closeTime,
      match_start_time: matchStartTime,
      status,
    });
    if (eventInsertError && eventInsertError.code !== "23505") {
      // 23505 = race condition fallback, another sibling's insert won first.
      throw new Error(`Failed to insert event ${eventId}: ${eventInsertError.message}`);
    }
    return;
  }

  const { data: currentEvent } = await supabase
    .from("events")
    .select("open_time, close_time, match_start_time")
    .eq("id", eventId)
    .single();
  if (currentEvent) {
    const newOpen = minMaxIso([currentEvent.open_time, openTime]).min;
    const newClose = minMaxIso([currentEvent.close_time, closeTime]).max;
    const newMatchStart = minMaxIso([currentEvent.match_start_time, matchStartTime]).min;
    await supabase
      .from("events")
      .update({ open_time: newOpen, close_time: newClose, match_start_time: newMatchStart })
      .eq("id", eventId);
  }
}

/** Writes one already-fetched sibling bundle into Supabase, filtering
 * `markets` and `market_price_history` down to `retainedTickers` -- the
 * frozen selection computed once (via buildMarketSelection) across every
 * sibling of the consolidated event. `event_tickers`, event bounding times,
 * and forecast data are sibling/event-level, not per-market, so none of
 * those are filtered. */
async function writeIngestedSibling(
  eventId: string,
  seriesTicker: string,
  eventTicker: string,
  bundle: CompactEventBundle,
  retainedTickers: Set<string>
): Promise<IngestResult> {
  const supabase = getSupabaseClient();

  const { min: openTime, max: closeTime } = minMaxIso(
    bundle.markets.flatMap((m) => [m.open_time, m.close_time])
  );
  const { min: matchStartTime } = minMaxIso(bundle.markets.map((m) => m.match_start_time));
  const status = deriveEventStatus(bundle.markets);

  await ensureEventRow(eventId, bundle, openTime, closeTime, matchStartTime, status);

  const { error: tickerInsertError } = await supabase.from("event_tickers").insert({
    event_id: eventId,
    event_ticker: eventTicker,
    series_ticker: seriesTicker,
    title: bundle.event.title,
  });
  if (tickerInsertError) {
    if (tickerInsertError.code === "23505") {
      throw new EventAlreadyIngestedError(eventTicker);
    }
    throw new Error(`Failed to insert ticker ${eventTicker}: ${tickerInsertError.message}`);
  }

  const retainedMarkets = bundle.markets.filter((m) => retainedTickers.has(m.ticker));
  if (retainedMarkets.length > 0) {
    const marketRows = retainedMarkets.map((m) => ({
      ticker: m.ticker,
      event_id: eventId,
      event_ticker: eventTicker,
      label: m.label ?? null,
      status: m.status ?? null,
      result: m.result ?? null,
      yes_price: m.yes_price,
      yes_bid: m.yes_bid,
      yes_ask: m.yes_ask,
      volume: m.volume,
      volume_24h: m.volume_24h,
      open_interest: m.open_interest,
      open_time: m.open_time ?? null,
      close_time: m.close_time ?? null,
      rules: m.rules ?? null,
    }));
    const { error: marketsError } = await supabase.from("markets").insert(marketRows);
    if (marketsError) {
      throw new Error(`Failed to insert markets for ${eventTicker}: ${marketsError.message}`);
    }
  }

  let priceHistoryPoints = 0;
  if (bundle.priceHistory && bundle.priceHistory.length > 0 && bundle.priceHistoryPeriodInterval) {
    const periodInterval = bundle.priceHistoryPeriodInterval;
    const priceRows = bundle.priceHistory
      .filter((series) => retainedTickers.has(series.market_ticker))
      .flatMap((series) => {
        const rawPoints = series.points.filter((p) => p.price != null);
        const stride = 20;
        const downsampled: typeof rawPoints = [];
        for (let i = 0; i < rawPoints.length; i += stride) {
          downsampled.push(rawPoints[i]);
        }
        const lastPoint = rawPoints[rawPoints.length - 1];
        if (
          rawPoints.length > 0 &&
          (downsampled.length === 0 || downsampled[downsampled.length - 1].t !== lastPoint.t)
        ) {
          downsampled.push(lastPoint);
        }

        return downsampled.map((p) => ({
          market_ticker: series.market_ticker,
          event_id: eventId,
          period_end_ts: toIsoFromUnixSeconds(p.t),
          period_interval: periodInterval,
          price: p.price,
          volume: p.volume,
          open_interest: p.open_interest,
        }));
      });
    if (priceRows.length > 0) {
      const { error: priceHistoryError } = await supabase.from("market_price_history").insert(priceRows);
      if (priceHistoryError) {
        throw new Error(`Failed to insert price history for ${eventTicker}: ${priceHistoryError.message}`);
      }
      priceHistoryPoints = priceRows.length;
    }
  }

  let forecastPercentiles = 0;
  if (bundle.forecastHistory && bundle.forecastHistory.length > 0) {
    const snapshotRows = bundle.forecastHistory.map((f) => ({
      event_id: eventId,
      event_ticker: eventTicker,
      end_period_ts: new Date(f.end_period_ts).toISOString(),
      period_interval: f.period_interval,
    }));
    const { error: snapshotsError } = await supabase.from("event_forecast_snapshots").insert(snapshotRows);
    if (snapshotsError) {
      throw new Error(`Failed to insert forecast snapshots for ${eventTicker}: ${snapshotsError.message}`);
    }

    const percentileRows = bundle.forecastHistory.flatMap((f) =>
      f.percentile_points.map((p) => ({
        event_id: eventId,
        event_ticker: eventTicker,
        end_period_ts: new Date(f.end_period_ts).toISOString(),
        percentile: p.percentile,
        numerical_forecast: p.numerical_forecast ?? null,
        raw_numerical_forecast: p.raw_numerical_forecast ?? null,
        formatted_forecast: p.formatted_forecast ?? null,
      }))
    );
    if (percentileRows.length > 0) {
      const { error: percentilesError } = await supabase
        .from("event_forecast_percentiles")
        .insert(percentileRows);
      if (percentilesError) {
        throw new Error(`Failed to insert forecast percentiles for ${eventTicker}: ${percentilesError.message}`);
      }
      forecastPercentiles = percentileRows.length;
    }
  }

  return {
    event_id: eventId,
    event_ticker: eventTicker,
    series_ticker: seriesTicker,
    markets: retainedMarkets.length,
    price_history_points: priceHistoryPoints,
    forecast_percentiles: forecastPercentiles,
    partialErrors: bundle.partialErrors,
  };
}

function retainedTickersOf(siblingBundles: SiblingBundle[]): Set<string> {
  const selection = buildMarketSelection(siblingBundles);
  return new Set([...selection.core_markets, ...selection.top_prop_markets].map((m) => m.ticker));
}

/** Single-sibling ingest entry point, used by the plain (non-fan-out)
 * POST /kalshi/add-event route. Runs its own fetched bundle through the
 * same buildMarketSelection() cap as the multi-sibling path below, treating
 * itself as a siblings list of one -- so a lone non-core sibling with a
 * large prop grid still gets capped to the top 50 by volume, and a core
 * sibling (moneyline/spread/total/advance) is always kept in full. */
export async function ingestKalshiEvent(
  seriesTicker: string,
  eventTicker: string,
  opts: EventBundleOptions = {}
): Promise<IngestResult> {
  if (await isTickerAlreadyIngested(eventTicker)) {
    throw new EventAlreadyIngestedError(eventTicker);
  }

  const eventId = await getMilestoneId(seriesTicker, eventTicker);
  const bundle = await getEventBundle(seriesTicker, eventTicker, opts);

  const siblingBundle: SiblingBundle = {
    event_ticker: eventTicker,
    series_ticker: seriesTicker,
    title: bundle.event.title,
    isCore: isCoreSeriesTicker(seriesTicker),
    bundle,
  };
  const retainedTickers = retainedTickersOf([siblingBundle]);

  return writeIngestedSibling(eventId, seriesTicker, eventTicker, bundle, retainedTickers);
}

export interface ConsolidatedIngestResult {
  event_ticker: string;
  series_ticker: string;
  ingested_count: number;
  results: Array<IngestResult | { event_ticker: string; status: "already_ingested" }>;
  partial_errors?: string[];
}

/** Multi-sibling ingest entry point, used by
 * POST /kalshi/add-event?ingest_all_props=true. Resolves every sibling
 * ticker for the match (moneylines, spreads, totals, props, ...), fetches
 * each not-yet-ingested sibling's bundle live from Kalshi (sequentially --
 * see fetchSiblingBundles()'s comment in agentKalshi.ts on why full
 * parallel fetching trips Kalshi's rate limit), then runs ONE
 * buildMarketSelection() across ALL of them together before writing
 * anything. That's the key difference from calling ingestKalshiEvent() per
 * sibling in a loop: the top-50 cap has to see every sibling's markets at
 * once to pool non-core props correctly, otherwise each sibling would
 * independently cap itself to 50 and the event would still end up with
 * hundreds of markets. */
export async function ingestConsolidatedEvent(
  seriesTicker: string,
  eventTicker: string,
  opts: EventBundleOptions = {}
): Promise<ConsolidatedIngestResult> {
  const tickers = await getMilestoneRelatedTickers(seriesTicker, eventTicker);

  const siblingBundles: SiblingBundle[] = [];
  const results: ConsolidatedIngestResult["results"] = [];
  const errors: string[] = [];

  for (const ticker of tickers) {
    const resolvedSeries = ticker.split("-")[0];
    try {
      if (await isTickerAlreadyIngested(ticker)) {
        results.push({ event_ticker: ticker, status: "already_ingested" });
        continue;
      }
      const bundle = await getEventBundle(resolvedSeries, ticker, opts);
      siblingBundles.push({
        event_ticker: ticker,
        series_ticker: resolvedSeries,
        title: bundle.event.title,
        isCore: isCoreSeriesTicker(resolvedSeries),
        bundle,
      });
    } catch (error) {
      console.error(`Failed to fetch sibling event ${ticker}:`, error);
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (siblingBundles.length > 0) {
    const eventId = await getMilestoneId(seriesTicker, eventTicker);
    const retainedTickers = retainedTickersOf(siblingBundles);

    for (const sibling of siblingBundles) {
      try {
        const result = await writeIngestedSibling(
          eventId,
          sibling.series_ticker,
          sibling.event_ticker,
          sibling.bundle,
          retainedTickers
        );
        results.push(result);
      } catch (error) {
        if (error instanceof EventAlreadyIngestedError) {
          results.push({ event_ticker: sibling.event_ticker, status: "already_ingested" });
        } else {
          console.error(`Failed to write sibling event ${sibling.event_ticker}:`, error);
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
  }

  if (results.length === 0 && errors.length > 0) {
    throw new Error(`Failed to ingest any match events: ${errors.join("; ")}`);
  }

  return {
    event_ticker: eventTicker,
    series_ticker: seriesTicker,
    ingested_count: results.length,
    results,
    partial_errors: errors.length > 0 ? errors : undefined,
  };
}
