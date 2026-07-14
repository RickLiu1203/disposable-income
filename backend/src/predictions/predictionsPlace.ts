import { getSupabaseClient } from "../supabase/supabaseClient";
import { getMarket, parseNum } from "../kalshi/kalshiEvents";

// ---------------------------------------------------------------------------
// Bulk-places predictions (and optional per-model strategy notes) for one
// event in a single call, from a JSON config grouped by model rather than a
// flat predictions list — so a model's overall strategy and all its bets for
// the event travel together.
//
// entry_price is never supplied by the caller — it's derived live from
// Kalshi at submission time (getMarket()), not from the DB's ingestion-time
// markets.yes_price snapshot: that column is never updated after ingestion,
// so reading it here would silently record a stale price against a real
// bet even though steps 4-6 of the agent pipeline show the model fresh
// Kalshi prices. The live fetch also rejects bets against markets that are
// no longer open/tradable, which the old DB-only read had no way to catch.
//
// All-or-nothing: every model/prediction in the config is validated up
// front (including the live Kalshi status/price checks) and collected into
// `details`; if anything fails, nothing is written. The predictions insert,
// strategies upsert, and pipeline_trace upsert are still separate calls (no
// cross-table transaction, matching the rest of this codebase), but the
// predictions insert itself is atomic — one INSERT statement, no partial
// rows within that table.
// ---------------------------------------------------------------------------

export interface PredictionValidationDetail {
  model_name: string;
  index?: number;
  field: string;
  message: string;
}

export class PredictionValidationError extends Error {
  details: PredictionValidationDetail[];

  constructor(message: string, details: PredictionValidationDetail[]) {
    super(message);
    this.name = "PredictionValidationError";
    this.details = details;
  }
}

export interface PredictionInput {
  market_ticker: string;
  side: "yes" | "no";
  stake: number;
  justification: string;
  /** The live price the agent actually saw for this market during pipeline
   * steps 4-6, echoed back here. Never used as entry_price itself (that's
   * always re-fetched live at submission time) — only compared against it
   * to flag cases where meaningful time passed between research and
   * execution. */
  observed_price: number;
}

export interface PipelineStepInput {
  step_name: string;
  summary: string;
}

export interface ModelPredictionPayload {
  event_id: string;
  model_name: string;
  strategy_notes?: string;
  predictions?: PredictionInput[];
  leftover_amount?: number;
  leftover_justification?: string;
  /** One entry per pipeline step 1-8 actually performed, logged verbatim
   * into model_event_pipeline_steps in array order (step_order = index+1). */
  pipeline_trace?: PipelineStepInput[];
}

export interface InsertedPrediction {
  id: number;
  model_name: string;
  market_ticker: string;
  side: "yes" | "no";
  stake: number;
  entry_price: number;
  justification: string;
  outcome: string;
  placed_at: string;
}

export interface PriceDivergenceFlag {
  model_name: string;
  market_ticker: string;
  observed_price: number;
  live_price: number;
  divergence: number;
}

export interface ModelPredictionsResult {
  event_id: string;
  predictions_inserted: number;
  predictions: InsertedPrediction[];
  strategies_upserted: number;
  pipeline_steps_logged: number;
  /** Predictions accepted but where observed_price differs meaningfully
   * from the live price fetched at submission time — not a rejection, just
   * a signal that time passed between research and execution. */
  price_divergence_flags: PriceDivergenceFlag[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function placeModelPredictions(
  config: ModelPredictionPayload
): Promise<ModelPredictionsResult> {
  const supabase = getSupabaseClient();
  const eventId = config.event_id;

  // Confirm the parent event exists
  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw new Error(`Failed to resolve event ID ${eventId}: ${eventError.message}`);
  }
  if (!eventRow) {
    throw new PredictionValidationError(
      `Event not found for ID: ${eventId}. Ingest it first.`,
      [{ model_name: config.model_name || "*", field: "event_id", message: `Event ID ${eventId} has not been ingested` }]
    );
  }

  // Load all markets for this consolidated parent event to validate predictions belong to it.
  // Structural membership only — entry_price is always re-derived live from Kalshi below, never from this row.
  const { data: marketRows, error: marketsError } = await supabase
    .from("markets")
    .select("ticker, event_ticker")
    .eq("event_id", eventId);
  if (marketsError) {
    throw new Error(`Failed to load markets for event ${eventId}: ${marketsError.message}`);
  }

  const knownMarketTickers = new Set<string>();
  const marketToTicker = new Map<string, string>();
  for (const m of (marketRows ?? []) as { ticker: string; event_ticker: string }[]) {
    knownMarketTickers.add(m.ticker);
    marketToTicker.set(m.ticker, m.event_ticker);
  }

  const { data: modelRows, error: modelsError } = await supabase.from("models").select("model_name");
  if (modelsError) {
    throw new Error(`Failed to load models: ${modelsError.message}`);
  }
  const knownModels = new Set(((modelRows ?? []) as { model_name: string }[]).map((m) => m.model_name));

  const details: PredictionValidationDetail[] = [];
  const predictionRows: Array<any> = [];
  const modelName = config.model_name;

  if (config.leftover_amount !== undefined) {
    if (typeof config.leftover_amount !== "number" || config.leftover_amount < 0) {
      details.push({
        model_name: modelName || "*",
        field: "leftover_amount",
        message: "leftover_amount must be a number >= 0",
      });
    } else if (config.leftover_amount > 0 && !isNonEmptyString(config.leftover_justification)) {
      details.push({
        model_name: modelName || "*",
        field: "leftover_justification",
        message: "leftover_justification is required when leftover_amount > 0",
      });
    }
  }

  const strategyRows: { model_name: string; event_id: string; strategy_notes: string }[] = [];

  if (!isNonEmptyString(modelName)) {
    details.push({ model_name: String(modelName), field: "model_name", message: "model_name is required" });
  } else if (!knownModels.has(modelName)) {
    details.push({ model_name: modelName, field: "model_name", message: `Unknown model: ${modelName}` });
  }

  const hasStrategy = config.strategy_notes !== undefined;
  const hasPredictions = config.predictions !== undefined;
  if (!hasStrategy && !hasPredictions) {
    details.push({
      model_name: modelName || "*",
      field: "predictions",
      message: "Model entry must include 'strategy_notes' and/or a non-empty 'predictions' array",
    });
  }

  if (hasStrategy && isNonEmptyString(modelName)) {
    if (!isNonEmptyString(config.strategy_notes)) {
      details.push({ model_name: modelName, field: "strategy_notes", message: "strategy_notes must be a non-empty string" });
    } else {
      strategyRows.push({ model_name: modelName, event_id: eventId, strategy_notes: config.strategy_notes });
    }
  }

  const priceDivergenceFlags: PriceDivergenceFlag[] = [];

  if (hasPredictions && isNonEmptyString(modelName)) {
    if (!Array.isArray(config.predictions) || config.predictions.length === 0) {
      details.push({ model_name: modelName, field: "predictions", message: "predictions must be a non-empty array" });
    } else {
      for (let index = 0; index < config.predictions.length; index++) {
        const prediction = config.predictions[index];
        const { market_ticker: marketTicker, side, stake, justification, observed_price: observedPrice } =
          prediction ?? ({} as PredictionInput);

        if (!isNonEmptyString(marketTicker) || !knownMarketTickers.has(marketTicker)) {
          details.push({
            model_name: modelName,
            index,
            field: "market_ticker",
            message: `Market ${marketTicker} does not belong to consolidated event ${eventId} (or does not exist)`,
          });
          continue;
        }
        if (side !== "yes" && side !== "no") {
          details.push({ model_name: modelName, index, field: "side", message: "side must be 'yes' or 'no'" });
          continue;
        }
        if (typeof stake !== "number" || !(stake > 0)) {
          details.push({ model_name: modelName, index, field: "stake", message: "stake must be a number > 0" });
          continue;
        }
        if (!isNonEmptyString(justification)) {
          details.push({ model_name: modelName, index, field: "justification", message: "justification is required" });
          continue;
        }
        if (typeof observedPrice !== "number" || !(observedPrice > 0 && observedPrice < 1)) {
          details.push({
            model_name: modelName,
            index,
            field: "observed_price",
            message: "observed_price is required and must be a number in (0, 1) — the live price seen during research",
          });
          continue;
        }

        // Live-fetch this market's current price/status from Kalshi at submission time — never from the
        // DB's ingestion-time markets.yes_price snapshot, which is never updated after ingestion.
        let liveYesPrice: number | null;
        let liveStatus: string | undefined;
        try {
          const { market: liveMarket } = await getMarket(marketTicker);
          liveYesPrice = parseNum(liveMarket.last_price_dollars);
          liveStatus = liveMarket.status;
        } catch (error) {
          details.push({
            model_name: modelName,
            index,
            field: "market_ticker",
            message: `Failed to fetch live Kalshi price/status for ${marketTicker}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          });
          continue;
        }

        if (liveStatus?.toLowerCase() !== "active") {
          details.push({
            model_name: modelName,
            index,
            field: "market_ticker",
            message: `Market ${marketTicker} is not currently tradable on Kalshi (live status: ${liveStatus ?? "unknown"})`,
          });
          continue;
        }
        if (liveYesPrice === null) {
          details.push({
            model_name: modelName,
            index,
            field: "market_ticker",
            message: `Market ${marketTicker} has no live price on Kalshi — cannot derive entry_price`,
          });
          continue;
        }

        const entryPrice = side === "yes" ? liveYesPrice : 1 - liveYesPrice;
        if (!(entryPrice > 0 && entryPrice < 1)) {
          details.push({
            model_name: modelName,
            index,
            field: "market_ticker",
            message: `Live-derived entry_price ${entryPrice} for market ${marketTicker} is out of the insertable (0,1) range`,
          });
          continue;
        }

        // Flag (not reject) meaningful drift between the price the agent saw during research and the
        // live price at submission — signals time passed between research and execution.
        const observedEntryPrice = side === "yes" ? observedPrice : 1 - observedPrice;
        const divergence = Number(Math.abs(observedEntryPrice - entryPrice).toFixed(4));
        if (divergence > 0.03) {
          priceDivergenceFlags.push({
            model_name: modelName,
            market_ticker: marketTicker,
            observed_price: observedPrice,
            live_price: liveYesPrice,
            divergence,
          });
        }

        const resolvedTicker = marketToTicker.get(marketTicker)!;
        predictionRows.push({
          model_name: modelName,
          event_id: eventId,
          event_ticker: resolvedTicker,
          market_ticker: marketTicker,
          side,
          stake,
          entry_price: entryPrice,
          justification,
          outcome: "pending",
          payout: null,
          settled_at: null,
        });
      }
    }
  }

  const pipelineStepRows: { model_name: string; event_id: string; step_order: number; step_name: string; summary: string }[] = [];
  if (config.pipeline_trace !== undefined && isNonEmptyString(modelName)) {
    if (!Array.isArray(config.pipeline_trace) || config.pipeline_trace.length === 0) {
      details.push({ model_name: modelName, field: "pipeline_trace", message: "pipeline_trace must be a non-empty array when provided" });
    } else {
      config.pipeline_trace.forEach((step, index) => {
        const { step_name: stepName, summary } = step ?? ({} as PipelineStepInput);
        if (!isNonEmptyString(stepName) || !isNonEmptyString(summary)) {
          details.push({
            model_name: modelName,
            index,
            field: "pipeline_trace",
            message: "Each pipeline_trace entry requires non-empty 'step_name' and 'summary' strings",
          });
          return;
        }
        pipelineStepRows.push({ model_name: modelName, event_id: eventId, step_order: index + 1, step_name: stepName, summary });
      });
    }
  }

  if (details.length > 0) {
    throw new PredictionValidationError(
      `Validation failed for ${details.length} issue(s) in the prediction payload`,
      details
    );
  }

  // Handle leftover amount as a virtual prediction
  if (config.leftover_amount !== undefined && config.leftover_amount > 0 && isNonEmptyString(modelName)) {
    let leftoverEventTicker = marketRows?.[0]?.event_ticker;
    if (!leftoverEventTicker) {
      const { data: tickerRows } = await supabase
        .from("event_tickers")
        .select("event_ticker")
        .eq("event_id", eventId)
        .limit(1);
      leftoverEventTicker = tickerRows?.[0]?.event_ticker || "UNKNOWN";
    }

    const leftoverMarketTicker = `${leftoverEventTicker}-LEFTOVER`;

    const { error: leftoverMarketError } = await supabase
      .from("markets")
      .upsert(
        {
          ticker: leftoverMarketTicker,
          event_id: eventId,
          event_ticker: leftoverEventTicker,
          label: "Leftover Capital",
          status: "settled",
          result: "yes",
          yes_price: 1.0,
          yes_bid: 1.0,
          yes_ask: 1.0,
          volume: 0,
          volume_24h: 0,
          open_interest: 0,
          rules: "Leftover/unbet bankroll balance."
        },
        { onConflict: "ticker" }
      );

    if (leftoverMarketError) {
      throw new Error(`Failed to upsert virtual leftover market: ${leftoverMarketError.message}`);
    }

    predictionRows.push({
      model_name: modelName,
      event_id: eventId,
      event_ticker: leftoverEventTicker,
      market_ticker: leftoverMarketTicker,
      side: "yes",
      stake: config.leftover_amount,
      entry_price: 0.999,
      justification: config.leftover_justification || "Leftover bankroll capital reserved.",
      outcome: "win",
      payout: config.leftover_amount,
      settled_at: new Date().toISOString()
    });
  }

  let insertedPredictions: InsertedPrediction[] = [];
  if (predictionRows.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("predictions")
      .insert(predictionRows)
      .select();

    if (insertError) {
      throw new Error(`Failed to insert predictions for event ${eventId}: ${insertError.message}`);
    }
    insertedPredictions = (inserted ?? []) as InsertedPrediction[];
  }

  if (strategyRows.length > 0) {
    const { error: strategyError } = await supabase
      .from("model_event_strategies")
      .upsert(strategyRows, { onConflict: "model_name,event_id" });
    if (strategyError) {
      throw new Error(`Failed to upsert strategies for event ${eventId}: ${strategyError.message}`);
    }
  }

  if (pipelineStepRows.length > 0) {
    const { error: pipelineError } = await supabase
      .from("model_event_pipeline_steps")
      .upsert(pipelineStepRows, { onConflict: "model_name,event_id,step_order" });
    if (pipelineError) {
      throw new Error(`Failed to log pipeline_trace for event ${eventId}: ${pipelineError.message}`);
    }
  }

  return {
    event_id: eventId,
    predictions_inserted: insertedPredictions.length,
    predictions: insertedPredictions,
    strategies_upserted: strategyRows.length,
    pipeline_steps_logged: pipelineStepRows.length,
    price_divergence_flags: priceDivergenceFlags,
  };
}
