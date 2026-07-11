import { getSupabaseClient } from "../supabase/supabaseClient";

// ---------------------------------------------------------------------------
// Bulk-places predictions (and optional per-model strategy notes) for one
// event in a single call, from a JSON config grouped by model rather than a
// flat predictions list — so a model's overall strategy and all its bets for
// the event travel together. Unlike kalshiIngest.ts/kalshiSettle.ts, this
// module never calls the Kalshi API: it only reads/writes Supabase tables
// that ingestion already populated (events/markets/models), which is why it
// lives in its own predictions/ directory instead of kalshi/.
//
// entry_price is never supplied by the caller — it's derived from the
// market's already-ingested yes_price (1 - yes_price for a "no" side), since
// that's the market's current price at the moment the bet is placed.
//
// All-or-nothing: every model/prediction in the config is validated up
// front and collected into `details`; if anything fails, nothing is written.
// The predictions insert and strategies upsert are still two separate calls
// (no cross-table transaction, matching the rest of this codebase), but the
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
}

export interface ModelEntry {
  model_name: string;
  strategy_notes?: string;
  predictions?: PredictionInput[];
}

export interface BulkPredictionsConfig {
  event_ticker: string;
  models: ModelEntry[];
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

export interface BulkPredictionsResult {
  event_ticker: string;
  predictions_inserted: number;
  predictions: InsertedPrediction[];
  strategies_upserted: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function placeBulkPredictions(
  config: BulkPredictionsConfig
): Promise<BulkPredictionsResult> {
  const supabase = getSupabaseClient();
  const eventTicker = config.event_ticker;

  // Resolve parent event_id and confirm the sibling ticker exists
  const { data: tickerRow, error: tickerError } = await supabase
    .from("event_tickers")
    .select("event_id, event_ticker")
    .eq("event_ticker", eventTicker)
    .maybeSingle();

  if (tickerError) {
    throw new Error(`Failed to resolve event ticker ${eventTicker}: ${tickerError.message}`);
  }
  if (!tickerRow) {
    throw new PredictionValidationError(
      `Event ticker not found: ${eventTicker}. Ingest it first via POST /kalshi/add-event.`,
      [{ model_name: "*", field: "event_ticker", message: `Event ticker ${eventTicker} has not been ingested` }]
    );
  }
  const eventId = tickerRow.event_id;

  // Load all markets for this consolidated parent event to validate predictions across all sibling bets
  const { data: marketRows, error: marketsError } = await supabase
    .from("markets")
    .select("ticker, event_ticker, yes_price")
    .eq("event_id", eventId);
  if (marketsError) {
    throw new Error(`Failed to load markets for event ${eventId}: ${marketsError.message}`);
  }

  const marketPrices = new Map<string, number | null>();
  const marketToTicker = new Map<string, string>();
  for (const m of (marketRows ?? []) as { ticker: string; event_ticker: string; yes_price: number | null }[]) {
    marketPrices.set(m.ticker, m.yes_price);
    marketToTicker.set(m.ticker, m.event_ticker);
  }

  const { data: modelRows, error: modelsError } = await supabase.from("models").select("model_name");
  if (modelsError) {
    throw new Error(`Failed to load models: ${modelsError.message}`);
  }
  const knownModels = new Set(((modelRows ?? []) as { model_name: string }[]).map((m) => m.model_name));

  const details: PredictionValidationDetail[] = [];
  const predictionRows: Array<{
    model_name: string;
    event_id: string;
    event_ticker: string;
    market_ticker: string;
    side: "yes" | "no";
    stake: number;
    entry_price: number;
    justification: string;
  }>[] = [];

  const strategyRows: { model_name: string; event_id: string; strategy_notes: string }[] = [];

  for (const entry of config.models) {
    const modelName = entry.model_name;

    if (!isNonEmptyString(modelName)) {
      details.push({ model_name: String(modelName), field: "model_name", message: "model_name is required" });
      continue;
    }
    if (!knownModels.has(modelName)) {
      details.push({ model_name: modelName, field: "model_name", message: `Unknown model: ${modelName}` });
    }

    const hasStrategy = entry.strategy_notes !== undefined;
    const hasPredictions = entry.predictions !== undefined;
    if (!hasStrategy && !hasPredictions) {
      details.push({
        model_name: modelName,
        field: "predictions",
        message: "Model entry must include 'strategy_notes' and/or a non-empty 'predictions' array",
      });
    }

    if (hasStrategy) {
      if (!isNonEmptyString(entry.strategy_notes)) {
        details.push({ model_name: modelName, field: "strategy_notes", message: "strategy_notes must be a non-empty string" });
      } else {
        strategyRows.push({ model_name: modelName, event_id: eventId, strategy_notes: entry.strategy_notes });
      }
    }

    if (hasPredictions) {
      if (!Array.isArray(entry.predictions) || entry.predictions.length === 0) {
        details.push({ model_name: modelName, field: "predictions", message: "predictions must be a non-empty array" });
      } else {
        const modelPredictionRows: any[] = [];
        entry.predictions.forEach((prediction, index) => {
          const { market_ticker: marketTicker, side, stake, justification } = prediction ?? ({} as PredictionInput);

          if (!isNonEmptyString(marketTicker) || !marketPrices.has(marketTicker)) {
            details.push({
              model_name: modelName,
              index,
              field: "market_ticker",
              message: `Market ${marketTicker} does not belong to consolidated event ${eventId} (or does not exist)`,
            });
            return;
          }
          if (side !== "yes" && side !== "no") {
            details.push({ model_name: modelName, index, field: "side", message: "side must be 'yes' or 'no'" });
            return;
          }
          if (typeof stake !== "number" || !(stake > 0)) {
            details.push({ model_name: modelName, index, field: "stake", message: "stake must be a number > 0" });
            return;
          }
          if (!isNonEmptyString(justification)) {
            details.push({ model_name: modelName, index, field: "justification", message: "justification is required" });
            return;
          }

          const yesPrice = marketPrices.get(marketTicker);
          if (yesPrice === null || yesPrice === undefined) {
            details.push({
              model_name: modelName,
              index,
              field: "market_ticker",
              message: `Market ${marketTicker} has no price yet — cannot derive entry_price`,
            });
            return;
          }
          const entryPrice = side === "yes" ? yesPrice : 1 - yesPrice;
          if (!(entryPrice > 0 && entryPrice < 1)) {
            details.push({
              model_name: modelName,
              index,
              field: "market_ticker",
              message: `Derived entry_price ${entryPrice} for market ${marketTicker} is out of the insertable (0,1) range`,
            });
            return;
          }

          const resolvedTicker = marketToTicker.get(marketTicker)!;
          modelPredictionRows.push({
            model_name: modelName,
            event_id: eventId,
            event_ticker: resolvedTicker,
            market_ticker: marketTicker,
            side,
            stake,
            entry_price: entryPrice,
            justification,
          });
        });
        predictionRows.push(modelPredictionRows);
      }
    }
  }

  if (details.length > 0) {
    throw new PredictionValidationError(
      `Validation failed for ${details.length} issue(s) in the bulk predictions config`,
      details
    );
  }

  const flatPredictionRows = predictionRows.flat();
  let insertedPredictions: InsertedPrediction[] = [];
  if (flatPredictionRows.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("predictions")
      .insert(flatPredictionRows)
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

  return {
    event_ticker: eventTicker,
    predictions_inserted: insertedPredictions.length,
    predictions: insertedPredictions,
    strategies_upserted: strategyRows.length,
  };
}
