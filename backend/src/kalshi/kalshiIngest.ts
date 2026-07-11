import { getSupabaseClient } from "../supabase/supabaseClient";
import { getEventBundle, type CompactMarket, type EventBundleOptions, getMilestoneId } from "./kalshiEvents";

// ---------------------------------------------------------------------------
// Writes one Kalshi event's compact bundle into Supabase across
// events/markets/market_price_history/event_forecast_*/event_related_events.
// Insert-only: markets rows are documented as "snapshot as of ingestion, not
// kept live" (see supabase/migrations), so re-ingesting an event that's
// already in the DB is treated as an error (EventAlreadyIngestedError)
// rather than silently overwriting a frozen snapshot other data (e.g.
// predictions) may already reference.
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

export async function ingestKalshiEvent(
  seriesTicker: string,
  eventTicker: string,
  opts: EventBundleOptions = {}
): Promise<IngestResult> {
  const supabase = getSupabaseClient();

  // Check if sibling ticker is already ingested
  const { data: existing, error: existingError } = await supabase
    .from("event_tickers")
    .select("event_ticker, event_id")
    .eq("event_ticker", eventTicker)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to check for existing ticker ${eventTicker}: ${existingError.message}`);
  }
  if (existing) {
    throw new EventAlreadyIngestedError(eventTicker);
  }

  // Resolve target combined event UUID (Milestone ID)
  const eventId = await getMilestoneId(seriesTicker, eventTicker);

  // Check if parent event already exists
  const { data: existingEvent, error: eventCheckError } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();

  if (eventCheckError) {
    throw new Error(`Failed to check for existing event ${eventId}: ${eventCheckError.message}`);
  }

  const bundle = await getEventBundle(seriesTicker, eventTicker, opts);

  const { min: openTime, max: closeTime } = minMaxIso(
    bundle.markets.flatMap((m) => [m.open_time, m.close_time])
  );
  const status = deriveEventStatus(bundle.markets);

  if (!existingEvent) {
    // Insert new parent event
    const { error: eventInsertError } = await supabase.from("events").insert({
      id: eventId,
      event_name: bundle.event.title,
      sub_title: bundle.event.sub_title ?? null,
      competition: bundle.event.competition ?? null,
      competition_scope: bundle.event.competition_scope ?? null,
      open_time: openTime,
      close_time: closeTime,
      status,
    });
    if (eventInsertError) {
      if (eventInsertError.code === "23505") {
        // Race condition fallback
      } else {
        throw new Error(`Failed to insert event ${eventId}: ${eventInsertError.message}`);
      }
    }
  } else {
    // Update parent event's bounding window times
    const { data: currentEvent } = await supabase.from("events").select("open_time, close_time").eq("id", eventId).single();
    if (currentEvent) {
      const newOpen = minMaxIso([currentEvent.open_time, openTime]).min;
      const newClose = minMaxIso([currentEvent.close_time, closeTime]).max;
      await supabase.from("events").update({
        open_time: newOpen,
        close_time: newClose,
      }).eq("id", eventId);
    }
  }

  // Insert sibling ticker entry
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

  if (bundle.markets.length > 0) {
    const marketRows = bundle.markets.map((m) => ({
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
    const priceRows = bundle.priceHistory.flatMap((series) => {
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
    markets: bundle.markets.length,
    price_history_points: priceHistoryPoints,
    forecast_percentiles: forecastPercentiles,
    partialErrors: bundle.partialErrors,
  };
}
