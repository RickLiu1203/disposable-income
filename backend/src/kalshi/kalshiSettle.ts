import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../supabase/supabaseClient";
import { getEvent } from "./kalshiEvents";

// ---------------------------------------------------------------------------
// Settles one Kalshi event's predictions in a single pass: pull this event's
// pending predictions, fetch the event's markets once to see which ones have
// a Kalshi result, resolve win/loss/void per prediction, recompute affected
// models' model_event_results, and — once nothing is left pending for the
// event — compute event_payouts. See "Settlement approach" in CLAUDE.md.
//
// This is a per-call action, not a reconciliation pass: model_event_results
// recomputation only runs for models that had a pending prediction in this
// call. If a prior call ever updated `predictions` but crashed before
// recomputing results/payouts, a later call with nothing newly pending won't
// self-heal that gap.
// ---------------------------------------------------------------------------

export interface SettleEventResult {
  event_ticker: string;
  predictions_checked: number;
  predictions_settled: number;
  predictions_still_pending: number;
  models_finalized: string[];
  event_payouts_computed: boolean;
}

interface PendingPrediction {
  id: number;
  model_name: string;
  market_ticker: string;
  side: "yes" | "no";
  stake: number;
  entry_price: number;
}

interface MarketOutcomeInfo {
  result?: string;
  status?: string;
}

// Kalshi doesn't document a status vocabulary for cancelled/voided markets
// anywhere this codebase has access to (KalshiMarket.status/result are
// untyped optional strings). Best-effort heuristic: once a result is
// present, treat any status containing "void" or "cancel" (case-insensitive)
// as a void market. Revisit once real cancellation data has been observed.
function isVoidStatus(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes("void") || s.includes("cancel");
}

function resolveOutcome(
  prediction: PendingPrediction,
  marketInfo: MarketOutcomeInfo | undefined
): { outcome: "win" | "loss" | "void"; payout: number } | null {
  if (!marketInfo?.result) return null; // no result yet -> stays pending

  if (isVoidStatus(marketInfo.status)) {
    return { outcome: "void", payout: Number(prediction.stake) };
  }
  if (marketInfo.result.toLowerCase() === prediction.side.toLowerCase()) {
    return { outcome: "win", payout: Number(prediction.stake) / Number(prediction.entry_price) };
  }
  return { outcome: "loss", payout: 0 };
}

async function getStartingBalance(
  supabase: SupabaseClient,
  modelName: string,
  eventTicker: string
): Promise<number> {
  const { data: existing, error: existingError } = await supabase
    .from("model_event_results")
    .select("starting_balance")
    .eq("model_name", modelName)
    .eq("event_ticker", eventTicker)
    .maybeSingle();
  if (existingError) {
    throw new Error(
      `Failed to check existing model_event_results for ${modelName}/${eventTicker}: ${existingError.message}`
    );
  }
  if (existing) return Number(existing.starting_balance);

  // First time this model has a row for this event: snapshot its current
  // balance as this event's starting_balance. Uses ON CONFLICT DO NOTHING
  // (ignoreDuplicates) rather than a plain upsert so a concurrent call for
  // the same model+event can never clobber whichever writer inserted first.
  const { data: model, error: modelError } = await supabase
    .from("models")
    .select("current_balance")
    .eq("model_name", modelName)
    .single();
  if (modelError) {
    throw new Error(`Failed to load current_balance for ${modelName}: ${modelError.message}`);
  }

  const { error: insertError } = await supabase
    .from("model_event_results")
    .upsert(
      { model_name: modelName, event_ticker: eventTicker, starting_balance: Number(model.current_balance) },
      { onConflict: "model_name,event_ticker", ignoreDuplicates: true }
    );
  if (insertError) {
    throw new Error(
      `Failed to seed starting_balance for ${modelName}/${eventTicker}: ${insertError.message}`
    );
  }

  // Re-select rather than trusting the value just sent: if another call won
  // the insert race, this reads back whatever starting_balance actually
  // landed instead of what this call attempted to write.
  const { data: seeded, error: seededError } = await supabase
    .from("model_event_results")
    .select("starting_balance")
    .eq("model_name", modelName)
    .eq("event_ticker", eventTicker)
    .single();
  if (seededError) {
    throw new Error(
      `Failed to read back seeded starting_balance for ${modelName}/${eventTicker}: ${seededError.message}`
    );
  }
  return Number(seeded.starting_balance);
}

async function recomputeModelEventResult(
  supabase: SupabaseClient,
  modelName: string,
  eventTicker: string
): Promise<void> {
  const { data, error } = await supabase
    .from("predictions")
    .select("stake, payout")
    .eq("event_ticker", eventTicker)
    .eq("model_name", modelName);
  if (error) {
    throw new Error(
      `Failed to load predictions for ${modelName}/${eventTicker}: ${error.message}`
    );
  }

  const startingBalance = await getStartingBalance(supabase, modelName, eventTicker);
  const rows = (data ?? []) as { stake: number; payout: number | null }[];
  const endingBalance =
    startingBalance + rows.reduce((sum, r) => sum + (Number(r.payout ?? 0) - Number(r.stake)), 0);

  const { error: updateError } = await supabase
    .from("model_event_results")
    .update({ ending_balance: endingBalance })
    .eq("model_name", modelName)
    .eq("event_ticker", eventTicker);
  if (updateError) {
    throw new Error(
      `Failed to update model_event_results for ${modelName}/${eventTicker}: ${updateError.message}`
    );
  }
}

// row_number()-with-deterministic-tiebreak ranker (value desc, key asc) —
// implemented in TS rather than SQL rank(), since CLAUDE.md requires a
// frozen, collision-free 1..n ranking for the event_payouts weight formula.
function rankDesc<T>(items: T[], value: (item: T) => number, key: (item: T) => string): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    const diff = value(b) - value(a);
    return diff !== 0 ? diff : key(a).localeCompare(key(b));
  });
  const ranks = new Map<string, number>();
  sorted.forEach((item, i) => ranks.set(key(item), i + 1));
  return ranks;
}

async function computeEventPayouts(supabase: SupabaseClient, eventTicker: string): Promise<void> {
  const { data, error } = await supabase
    .from("model_event_results")
    .select("model_name, percent_change, ending_balance")
    .eq("event_ticker", eventTicker)
    .not("ending_balance", "is", null);
  if (error) {
    throw new Error(`Failed to load participating models for ${eventTicker}: ${error.message}`);
  }

  const participants = (data ?? []) as { model_name: string; percent_change: number; ending_balance: number }[];
  const n = participants.length;
  if (n === 0) return;

  const eventRank = rankDesc(participants, (p) => Number(p.percent_change), (p) => p.model_name);

  const modelNames = participants.map((p) => p.model_name);
  const { data: lifetimeRows, error: lifetimeError } = await supabase
    .from("model_event_results")
    .select("model_name, percent_change")
    .in("model_name", modelNames)
    .not("ending_balance", "is", null);
  if (lifetimeError) {
    throw new Error(`Failed to load lifetime results for ${eventTicker}: ${lifetimeError.message}`);
  }

  const sums = new Map<string, { total: number; count: number }>();
  for (const row of (lifetimeRows ?? []) as { model_name: string; percent_change: number }[]) {
    const cur = sums.get(row.model_name) ?? { total: 0, count: 0 };
    cur.total += Number(row.percent_change);
    cur.count += 1;
    sums.set(row.model_name, cur);
  }
  const lifetimeAverages = modelNames.map((modelName) => {
    const sum = sums.get(modelName)!;
    return { model_name: modelName, avg_percent_change: sum.total / sum.count };
  });
  const lifetimeRank = rankDesc(lifetimeAverages, (r) => r.avg_percent_change, (r) => r.model_name);

  const potTotal = participants.reduce((sum, p) => sum + Number(p.ending_balance), 0);
  const halfPot = potTotal / 2;
  const denom = (n * (n + 1)) / 2;
  const weight = (rank: number) => n - rank + 1;

  const totalPayoutByModel = new Map<string, number>();
  const rows = participants.map((p) => {
    const er = eventRank.get(p.model_name)!;
    const lr = lifetimeRank.get(p.model_name)!;
    const eventHalfPayout = (halfPot * weight(er)) / denom;
    const lifetimeHalfPayout = (halfPot * weight(lr)) / denom;
    totalPayoutByModel.set(p.model_name, eventHalfPayout + lifetimeHalfPayout);
    return {
      event_ticker: eventTicker,
      model_name: p.model_name,
      pot_total: potTotal,
      event_rank: er,
      event_half_payout: eventHalfPayout,
      lifetime_rank: lr,
      lifetime_half_payout: lifetimeHalfPayout,
    };
  });

  // total_payout is left unset: it's a stored generated column.
  const { error: payoutError } = await supabase
    .from("event_payouts")
    .upsert(rows, { onConflict: "event_ticker,model_name" });
  if (payoutError) {
    throw new Error(`Failed to upsert event_payouts for ${eventTicker}: ${payoutError.message}`);
  }

  // Carry each model's payout forward as its live spendable capital, written
  // after event_payouts so that record stays the durable audit trail even if
  // this step fails partway.
  const { error: balanceError } = await supabase
    .from("models")
    .upsert(
      participants.map((p) => ({
        model_name: p.model_name,
        current_balance: totalPayoutByModel.get(p.model_name)!,
      })),
      { onConflict: "model_name" }
    );
  if (balanceError) {
    throw new Error(`Failed to update models.current_balance for ${eventTicker}: ${balanceError.message}`);
  }
}

export async function settleEvent(eventTicker: string): Promise<SettleEventResult> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("predictions")
    .select("id, model_name, market_ticker, side, stake, entry_price")
    .eq("event_ticker", eventTicker)
    .eq("outcome", "pending");
  if (error) {
    throw new Error(`Failed to load pending predictions for ${eventTicker}: ${error.message}`);
  }

  const pending = (data ?? []) as PendingPrediction[];
  if (pending.length === 0) {
    return {
      event_ticker: eventTicker,
      predictions_checked: 0,
      predictions_settled: 0,
      predictions_still_pending: 0,
      models_finalized: [],
      event_payouts_computed: false,
    };
  }

  // Single Kalshi call for the whole event, per the settlement design.
  const { markets } = await getEvent(eventTicker);
  const marketMap = new Map<string, MarketOutcomeInfo>(
    markets.map((m) => [m.ticker, { result: m.result, status: m.status }])
  );

  const settledAt = new Date().toISOString();
  const resolved = pending
    .map((p) => ({ prediction: p, resolution: resolveOutcome(p, marketMap.get(p.market_ticker)) }))
    .filter(
      (x): x is { prediction: PendingPrediction; resolution: { outcome: "win" | "loss" | "void"; payout: number } } =>
        x.resolution !== null
    );

  const updateResults = await Promise.all(
    resolved.map(({ prediction, resolution }) =>
      supabase
        .from("predictions")
        .update({ outcome: resolution.outcome, payout: resolution.payout, settled_at: settledAt })
        .eq("id", prediction.id)
    )
  );
  const updateError = updateResults.find((r) => r.error)?.error;
  if (updateError) {
    throw new Error(`Failed to write settled predictions for ${eventTicker}: ${updateError.message}`);
  }

  // Recompute model_event_results for models that had a pending prediction
  // in this call, once every one of that model's predictions for the event
  // is no longer pending.
  const affectedModels = [...new Set(pending.map((p) => p.model_name))];
  const modelsFinalized: string[] = [];
  for (const modelName of affectedModels) {
    const { count, error: countError } = await supabase
      .from("predictions")
      .select("id", { count: "exact", head: true })
      .eq("event_ticker", eventTicker)
      .eq("model_name", modelName)
      .eq("outcome", "pending");
    if (countError) {
      throw new Error(
        `Failed to check pending state for ${modelName}/${eventTicker}: ${countError.message}`
      );
    }
    if ((count ?? 0) === 0) {
      await recomputeModelEventResult(supabase, modelName, eventTicker);
      modelsFinalized.push(modelName);
    }
  }

  // Once nothing is left pending for the event across all models, compute
  // the reward-pot distribution.
  const { count: eventPendingCount, error: eventPendingError } = await supabase
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .eq("event_ticker", eventTicker)
    .eq("outcome", "pending");
  if (eventPendingError) {
    throw new Error(
      `Failed to check event-wide pending state for ${eventTicker}: ${eventPendingError.message}`
    );
  }

  let eventPayoutsComputed = false;
  if ((eventPendingCount ?? 0) === 0) {
    await computeEventPayouts(supabase, eventTicker);
    eventPayoutsComputed = true;
  }

  return {
    event_ticker: eventTicker,
    predictions_checked: pending.length,
    predictions_settled: resolved.length,
    predictions_still_pending: pending.length - resolved.length,
    models_finalized: modelsFinalized,
    event_payouts_computed: eventPayoutsComputed,
  };
}
