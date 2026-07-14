import { getSupabaseClient } from "../supabase/supabaseClient";
import { getEvent, parseNum, type KalshiMarket } from "../kalshi/kalshiEvents";
import { getEventSiblings, type SiblingTicker } from "./agentKalshi";
import { settleEvent } from "../kalshi/kalshiSettle";
import { getEventStartingBalances } from "../events/startingBalances";

// ---------------------------------------------------------------------------
// Server-side live-value poller. Every 10 minutes: find events that have
// started (per Kalshi-sourced match_start_time, the real match kickoff --
// NOT open_time, which is when Kalshi opened the market for trading and is
// routinely days earlier), have at least one prediction placed, and still
// have at least one pending prediction; for exactly those
// events, live-fetch Kalshi and write (a) fresh market_price_history points
// for every market in the event and (b) each model's current
// mark-to-market bankroll into model_event_value_snapshots, then (c)
// attempt settlement for every sibling ticker -- this is what makes
// settlement automatic: as soon as Kalshi reports a real result for a
// sibling, the very next cycle resolves it, with no manual
// POST /predictions/settle call required anywhere. Everything else (no
// bets yet, not started yet, already fully settled) costs nothing -- the
// gating query below is a single cheap Supabase read with no Kalshi calls,
// so a quiet cycle with no live events does effectively no work. Once every
// prediction for an event settles, it simply stops appearing in the next
// cycle's gating query -- no separate "stop polling" step is needed.
//
// Deliberately sequential, both across events and across siblings within an
// event: fetchSiblingBundles() in agentKalshi.ts found that fetching many
// siblings' data in full parallel reliably trips Kalshi's rate limit. This
// poller's per-sibling calls are lighter (getEvent() only, not the full
// bundle with candlesticks/forecast/metadata), but it's not latency
// sensitive -- nothing is waiting on an HTTP response -- so there's no
// reason to reintroduce that risk for a background job.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10 * 60 * 1000;
const SNAPSHOT_PERIOD_INTERVAL_MINUTES = 10;

// Last unrealized_balance written per "model:event", so a value that hasn't
// moved since the previous cycle never triggers a redundant row. Reset on
// server restart -- the first post-restart poll for an event may write once
// even if nothing changed, which is an acceptable, self-correcting cost for
// not needing an extra DB read every cycle just to check "did this change".
const lastWritten = new Map<string, number>();

interface PredictionRow {
  model_name: string;
  market_ticker: string;
  side: "yes" | "no";
  stake: number;
  entry_price: number;
  outcome: "pending" | "win" | "loss" | "void";
  payout: number | null;
}

async function findActiveEventIds(): Promise<string[]> {
  const supabase = getSupabaseClient();

  const { data: pending, error: pendingError } = await supabase
    .from("predictions")
    .select("event_id")
    .eq("outcome", "pending");
  if (pendingError) {
    throw new Error(`Failed to load pending predictions: ${pendingError.message}`);
  }

  const candidateEventIds = Array.from(new Set((pending ?? []).map((p) => p.event_id as string)));
  if (candidateEventIds.length === 0) return [];

  // match_start_time (the real-world match kickoff, from Kalshi's
  // occurrence_datetime) is the correct "has this actually started" signal
  // -- open_time is when the Kalshi market opened for trading, which is
  // routinely days before the real match. Filtered in JS rather than via
  // .lte() because it needs a per-row fallback to open_time for events
  // ingested before match_start_time existed, not a single column compare.
  const { data: started, error: startedError } = await supabase
    .from("events")
    .select("id, open_time, match_start_time")
    .in("id", candidateEventIds);
  if (startedError) {
    throw new Error(`Failed to filter started events: ${startedError.message}`);
  }

  const nowMs = Date.now();
  return (started ?? [])
    .filter((e) => {
      const effective = (e.match_start_time as string | null) ?? (e.open_time as string | null);
      return effective !== null && new Date(effective).getTime() <= nowMs;
    })
    .map((e) => e.id as string);
}

/** Live-fetches every sibling of an event (one getEvent() call per sibling,
 * each already returning that sibling's full nested market list), writes a
 * fresh market_price_history row for every market found, and returns a
 * ticker -> live yes-price map for the mark-to-market calculation below. */
async function fetchLiveSidePrices(eventId: string, siblings: SiblingTicker[]): Promise<Map<string, number | null>> {
  const prices = new Map<string, number | null>();
  const nowIso = new Date().toISOString();
  const marketRows: Array<{
    market_ticker: string;
    event_id: string;
    period_end_ts: string;
    period_interval: number;
    price: number | null;
    volume: number | null;
    open_interest: number | null;
  }> = [];

  for (const sibling of siblings) {
    let markets: KalshiMarket[];
    try {
      ({ markets } = await getEvent(sibling.event_ticker));
    } catch (error) {
      console.error(
        `[valuePoller] Failed to fetch sibling ${sibling.event_ticker} for event ${eventId}:`,
        error instanceof Error ? error.message : error
      );
      continue;
    }
    for (const m of markets) {
      const yesPrice = parseNum(m.last_price_dollars);
      prices.set(m.ticker, yesPrice);
      marketRows.push({
        market_ticker: m.ticker,
        event_id: eventId,
        period_end_ts: nowIso,
        period_interval: SNAPSHOT_PERIOD_INTERVAL_MINUTES,
        price: yesPrice,
        volume: parseNum(m.volume_fp),
        open_interest: parseNum(m.open_interest_fp),
      });
    }
  }

  if (marketRows.length > 0) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("market_price_history")
      .upsert(marketRows, { onConflict: "market_ticker,period_end_ts" });
    if (error) {
      console.error(`[valuePoller] Failed to write market_price_history for event ${eventId}:`, error.message);
    }
  }

  return prices;
}

async function getStartingBalances(modelNames: string[], eventId: string): Promise<Map<string, number>> {
  // This poller's own fallback logic (model_event_results.starting_balance,
  // else the model's current live overall balance) is shared with
  // eventsRead.ts's per-event "pot" display -- see startingBalances.ts for
  // why that sharing matters.
  const record = await getEventStartingBalances(eventId, modelNames);
  return new Map(Object.entries(record));
}

/** Dollar value of one prediction right now: the real settled payout if
 * it's already resolved, otherwise a live mark-to-market estimate -- what
 * the position would be worth if cashed out at the current Kalshi price
 * instead of waiting for settlement. Mirrors the win-payout formula in
 * kalshiSettle.ts's resolveOutcome() (stake / entry_price), just swapping
 * in the live current-side price instead of a guaranteed $1. */
function currentValue(p: PredictionRow, livePrices: Map<string, number | null>): number {
  if (p.outcome !== "pending") {
    return Number(p.payout ?? 0);
  }
  const liveYesPrice = livePrices.get(p.market_ticker);
  if (liveYesPrice == null) {
    // No live price this cycle -- hold at cost rather than guess.
    return Number(p.stake);
  }
  const currentSidePrice = p.side === "yes" ? liveYesPrice : 1 - liveYesPrice;
  return (Number(p.stake) * currentSidePrice) / Number(p.entry_price);
}

/** Attempts settlement for every sibling of an event -- reuses the existing,
 * already-correct settleEvent() logic unchanged, just calls it
 * automatically instead of waiting for a manual POST /predictions/settle.
 * Each sibling is isolated in its own try/catch so one failure (e.g. Kalshi
 * hasn't posted a result yet, which is the common case and not an error)
 * never blocks the others. */
async function attemptSettlement(eventId: string, siblings: SiblingTicker[]): Promise<void> {
  for (const sibling of siblings) {
    try {
      await settleEvent(sibling.event_ticker);
    } catch (error) {
      console.error(
        `[valuePoller] Settlement attempt failed for ${sibling.event_ticker} (event ${eventId}):`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

async function pollEvent(eventId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: predictionRows, error: predictionsError } = await supabase
    .from("predictions")
    .select("model_name, market_ticker, side, stake, entry_price, outcome, payout")
    .eq("event_id", eventId);
  if (predictionsError) {
    throw new Error(`Failed to load predictions for event ${eventId}: ${predictionsError.message}`);
  }
  const predictions = (predictionRows ?? []) as PredictionRow[];
  if (predictions.length === 0) return;

  const siblings = await getEventSiblings(eventId);
  const livePrices = await fetchLiveSidePrices(eventId, siblings);

  const byModel = new Map<string, PredictionRow[]>();
  for (const p of predictions) {
    const list = byModel.get(p.model_name) ?? [];
    list.push(p);
    byModel.set(p.model_name, list);
  }
  const modelNames = Array.from(byModel.keys());
  const startingBalances = await getStartingBalances(modelNames, eventId);

  const nowIso = new Date().toISOString();
  const snapshotRows: Array<{
    model_name: string;
    event_id: string;
    snapshot_ts: string;
    unrealized_balance: number;
  }> = [];

  for (const modelName of modelNames) {
    const modelPredictions = byModel.get(modelName)!;
    const startingBalance = startingBalances.get(modelName) ?? 10;
    const unrealizedBalance =
      startingBalance +
      modelPredictions.reduce((sum, p) => sum + (currentValue(p, livePrices) - Number(p.stake)), 0);
    const rounded = Math.round(unrealizedBalance * 100) / 100;

    const cacheKey = `${modelName}:${eventId}`;
    if (lastWritten.get(cacheKey) === rounded) continue;

    snapshotRows.push({ model_name: modelName, event_id: eventId, snapshot_ts: nowIso, unrealized_balance: rounded });
    lastWritten.set(cacheKey, rounded);
  }

  if (snapshotRows.length > 0) {
    const { error } = await supabase.from("model_event_value_snapshots").insert(snapshotRows);
    if (error) {
      console.error(`[valuePoller] Failed to insert value snapshots for event ${eventId}:`, error.message);
    }
  }

  await attemptSettlement(eventId, siblings);
}

async function runPollCycle(): Promise<void> {
  let activeEventIds: string[];
  try {
    activeEventIds = await findActiveEventIds();
  } catch (error) {
    console.error("[valuePoller] Failed to determine active events:", error instanceof Error ? error.message : error);
    return;
  }

  for (const eventId of activeEventIds) {
    try {
      await pollEvent(eventId);
    } catch (error) {
      console.error(
        `[valuePoller] Poll cycle failed for event ${eventId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

let pollTimer: NodeJS.Timeout | null = null;

/** Starts the server-side live-value poller. Call once at server boot. Runs
 * one cycle immediately, then every 10 minutes thereafter, for as long as
 * the server process is alive. */
export function startValuePolling(): void {
  if (pollTimer) return;
  runPollCycle();
  pollTimer = setInterval(runPollCycle, POLL_INTERVAL_MS);
}

export interface ValueHistoryPoint {
  snapshot_ts: string;
  unrealized_balance: number;
}

export interface ValueHistorySeries {
  model_name: string;
  points: ValueHistoryPoint[];
}

/** Reads the persisted value-over-time history for one event, one series
 * per model ordered by snapshot_ts. Pure DB read -- never touches Kalshi,
 * so it stays cheap no matter how often the frontend calls it. */
export async function getValueHistory(eventId: string): Promise<ValueHistorySeries[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("model_event_value_snapshots")
    .select("model_name, snapshot_ts, unrealized_balance")
    .eq("event_id", eventId)
    .order("snapshot_ts", { ascending: true });
  if (error) {
    throw new Error(`Failed to load value history for event ${eventId}: ${error.message}`);
  }

  const byModel = new Map<string, ValueHistoryPoint[]>();
  for (const row of data ?? []) {
    const list = byModel.get(row.model_name as string) ?? [];
    list.push({ snapshot_ts: row.snapshot_ts as string, unrealized_balance: Number(row.unrealized_balance) });
    byModel.set(row.model_name as string, list);
  }
  return Array.from(byModel.entries()).map(([model_name, points]) => ({ model_name, points }));
}
