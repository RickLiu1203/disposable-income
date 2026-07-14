import "dotenv/config";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { getExchangeStatus } from "./kalshi/kalshi";
import { getEventBundle, resolveKalshiMarketUrl, getMilestoneRelatedTickers } from "./kalshi/kalshiEvents";
import { EventAlreadyIngestedError, ingestKalshiEvent } from "./kalshi/kalshiIngest";
import { getEventDetail, listEvents, getLifetimeLeaderboard } from "./events/eventsRead";
import { deleteEvent } from "./events/eventsDelete";
import { settleEvent, adjustModelEndingBalance } from "./kalshi/kalshiSettle";
import { getServerTime } from "./polymarket/polymarket";
import { pingSupabase, getSupabaseClient } from "./supabase/supabaseClient";
import {
  findMatchEvents,
  getMatchBundle,
  resolvePolymarketEventUrl,
  toCompactMatchBundle,
} from "./polymarket/polymarketEvents";
import { openapiSpec } from "./docs/openapi";
import { placeModelPredictions, PredictionValidationError } from "./predictions/predictionsPlace";
import { getBankroll, getLeaderboard, getPastPerformance } from "./agent/agentLedger";
import {
  getEventSiblings,
  fetchSiblingBundles,
  buildMarketSelection,
  findExpandedSibling,
  computeMarketHistory,
  getForecastSummary,
  getMarketDetail,
} from "./agent/agentKalshi";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ ok: false, error: "Malformed JSON body" });
    return;
  }
  next(err);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.get("/ping-kalshi", async (_req, res) => {
  try {
    const kalshi = await getExchangeStatus();
    res.json({ ok: true, kalshi });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/ping-poly", async (_req, res) => {
  try {
    const polymarket = await getServerTime();
    res.json({ ok: true, polymarket });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/ping-supabase", async (_req, res) => {
  try {
    const supabase = await pingSupabase();
    res.json({ ok: true, supabase });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/kalshi/resolve-url", async (req, res) => {
  const url = req.query.url;

  if (typeof url !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'url' is required" });
    return;
  }

  try {
    const { seriesTicker, eventTicker } = await resolveKalshiMarketUrl(url);
    res.json({ ok: true, series_ticker: seriesTicker, event_ticker: eventTicker });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/kalshi/event-bundle", async (req, res) => {
  let seriesTicker = req.query.series_ticker;
  let eventTicker = req.query.event_ticker;
  const url = req.query.url;

  if (typeof seriesTicker !== "string" || typeof eventTicker !== "string") {
    if (typeof url !== "string") {
      res.status(400).json({
        ok: false,
        error:
          "Provide either 'series_ticker' + 'event_ticker', or a Kalshi market 'url'",
      });
      return;
    }

    try {
      const resolved = await resolveKalshiMarketUrl(url);
      seriesTicker = resolved.seriesTicker;
      eventTicker = resolved.eventTicker;
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }
  }

  const startTs = req.query.start_ts ? Number(req.query.start_ts) : undefined;
  const endTs = req.query.end_ts ? Number(req.query.end_ts) : undefined;
  const periodInterval = req.query.period_interval
    ? Number(req.query.period_interval)
    : undefined;
  const percentiles = req.query.percentiles
    ? String(req.query.percentiles)
        .split(",")
        .map(Number)
    : undefined;

  try {
    const data = await getEventBundle(seriesTicker, eventTicker, {
      startTs,
      endTs,
      periodInterval,
      percentiles,
    });
    res.json({ ok: true, data });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/kalshi/add-event", async (req, res) => {
  let seriesTicker = req.query.series_ticker;
  let eventTicker = req.query.event_ticker;
  const url = req.query.url;

  if (typeof seriesTicker !== "string" || typeof eventTicker !== "string") {
    if (typeof url !== "string") {
      res.status(400).json({
        ok: false,
        error:
          "Provide either 'series_ticker' + 'event_ticker', or a Kalshi market 'url'",
      });
      return;
    }

    try {
      const resolved = await resolveKalshiMarketUrl(url);
      seriesTicker = resolved.seriesTicker;
      eventTicker = resolved.eventTicker;
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }
  }

  const startTs = req.query.start_ts ? Number(req.query.start_ts) : undefined;
  const endTs = req.query.end_ts ? Number(req.query.end_ts) : undefined;
  const periodInterval = req.query.period_interval
    ? Number(req.query.period_interval)
    : undefined;
  const percentiles = req.query.percentiles
    ? String(req.query.percentiles)
        .split(",")
        .map(Number)
    : undefined;

  const ingestAllProps = req.query.ingest_all_props === "true";

  try {
    if (ingestAllProps) {
      const tickers = await getMilestoneRelatedTickers(seriesTicker, eventTicker);
      const results: any[] = [];
      const errors: string[] = [];

      for (const ticker of tickers) {
        const resolvedSeries = ticker.split("-")[0];
        try {
          const result = await ingestKalshiEvent(resolvedSeries, ticker, {
            startTs,
            endTs,
            periodInterval,
            percentiles,
          });
          results.push(result);
        } catch (error) {
          // If some sibling is already ingested, that's fine. Ignore 409s.
          if (error instanceof EventAlreadyIngestedError) {
            results.push({ event_ticker: ticker, status: "already_ingested" });
          } else {
            console.error(`Failed to ingest sibling event ${ticker}:`, error);
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      }

      if (results.length === 0 && errors.length > 0) {
        throw new Error(`Failed to ingest any match events: ${errors.join("; ")}`);
      }

      res.json({
        ok: true,
        event_ticker: eventTicker,
        series_ticker: seriesTicker,
        ingested_count: results.length,
        results,
        partial_errors: errors.length > 0 ? errors : undefined,
      });
      return;
    }

    const data = await ingestKalshiEvent(seriesTicker, eventTicker, {
      startTs,
      endTs,
      periodInterval,
      percentiles,
    });
    res.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof EventAlreadyIngestedError) {
      res.status(409).json({ ok: false, error: error.message });
      return;
    }
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/events", async (_req, res) => {
  try {
    const events = await listEvents();
    res.json({ ok: true, events });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.delete("/events", async (req, res) => {
  const eventTicker = req.query.event_ticker;
  const eventId = req.query.event_id;

  if (typeof eventTicker !== "string" && typeof eventId !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'event_ticker' or 'event_id' is required" });
    return;
  }

  const target = (eventId || eventTicker) as string;

  try {
    const data = await deleteEvent(target);
    res.json({ ok: true, data });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("not found") || error.message.includes("not exist"))) {
      res.status(404).json({ ok: false, error: error.message });
      return;
    }
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/events/lifetime-leaderboard", async (_req, res) => {
  try {
    const data = await getLifetimeLeaderboard();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/events/detail", async (req, res) => {
  const eventTicker = req.query.event_ticker;
  const eventId = req.query.event_id;

  if (typeof eventTicker !== "string" && typeof eventId !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'event_ticker' or 'event_id' is required" });
    return;
  }

  try {
    let targetEventId = eventId as string;
    if (!targetEventId && typeof eventTicker === "string") {
      const supabase = getSupabaseClient();
      const { data: tickerRow } = await supabase
        .from("event_tickers")
        .select("event_id")
        .eq("event_ticker", eventTicker)
        .maybeSingle();

      if (tickerRow) {
        targetEventId = tickerRow.event_id;
      }
    }

    if (!targetEventId) {
      res.status(404).json({ ok: false, error: `No ingested event found for ticker '${eventTicker}'` });
      return;
    }

    const data = await getEventDetail(targetEventId);
    if (!data) {
      res.status(404).json({ ok: false, error: `No ingested event found for ID '${targetEventId}'` });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/predictions/settle", async (req, res) => {
  const eventTicker = req.query.event_ticker;
  const eventId = req.query.event_id;

  if (typeof eventTicker !== "string" && typeof eventId !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'event_ticker' or 'event_id' is required" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    let targetEventId = eventId as string;

    if (!targetEventId && typeof eventTicker === "string") {
      const { data: tickerRow } = await supabase
        .from("event_tickers")
        .select("event_id")
        .eq("event_ticker", eventTicker)
        .maybeSingle();
      if (tickerRow) {
        targetEventId = tickerRow.event_id;
      }
    }

    if (!targetEventId) {
      res.status(404).json({ ok: false, error: `No ingested event found for ticker '${eventTicker}'` });
      return;
    }

    // Load all sibling tickers for this parent event
    const { data: siblingTickers, error: siblingError } = await supabase
      .from("event_tickers")
      .select("event_ticker")
      .eq("event_id", targetEventId);

    if (siblingError || !siblingTickers || siblingTickers.length === 0) {
      throw new Error(`Failed to load sibling tickers for event ${targetEventId}: ${siblingError?.message || 'none found'}`);
    }

    const results: any[] = [];
    for (const row of siblingTickers) {
      const result = await settleEvent(row.event_ticker);
      results.push(result);
    }

    const combined = {
      event_id: targetEventId,
      predictions_checked: results.reduce((sum, r) => sum + r.predictions_checked, 0),
      predictions_settled: results.reduce((sum, r) => sum + r.predictions_settled, 0),
      predictions_still_pending: results.reduce((sum, r) => sum + r.predictions_still_pending, 0),
      models_finalized: Array.from(new Set(results.flatMap((r) => r.models_finalized))),
      event_payouts_computed: results.some((r) => r.event_payouts_computed),
    };

    res.json({ ok: true, data: combined });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/predictions/place", async (req, res) => {
  const body = req.body;

  if (
    typeof body?.event_id !== "string" ||
    typeof body?.model_name !== "string"
  ) {
    res.status(400).json({
      ok: false,
      error: "Body must include 'event_id' (string) and 'model_name' (string)",
    });
    return;
  }

  try {
    const data = await placeModelPredictions(body);
    res.json({ ok: true, data });
  } catch (error) {
    if (error instanceof PredictionValidationError) {
      res.status(400).json({ ok: false, error: error.message, details: error.details });
      return;
    }
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/predictions/adjust-balance", async (req, res) => {
  const body = req.body;

  if (
    typeof body?.event_id !== "string" ||
    typeof body?.model_name !== "string" ||
    typeof body?.ending_balance !== "number"
  ) {
    res.status(400).json({
      ok: false,
      error: "Body must include 'event_id' (string), 'model_name' (string), and 'ending_balance' (number)",
    });
    return;
  }

  try {
    const result = await adjustModelEndingBalance(
      body.event_id,
      body.model_name,
      body.ending_balance
    );
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});


// ---------------------------------------------------------------------------
// Agent decision pipeline (steps 1-6 + on-demand market-detail). See
// CLAUDE.md "Agent decision pipeline" and
// backend/prediction-market-agent-system-prompt.md for the full 9-step flow;
// step 7 (link search) and step 8 (web search) are unchanged existing tools
// with no dedicated endpoint, and step 9 is the extended POST
// /predictions/place above.
// ---------------------------------------------------------------------------

app.get("/agent/bankroll", async (req, res) => {
  const modelName = req.query.model_name;
  if (typeof modelName !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'model_name' is required" });
    return;
  }
  try {
    const data = await getBankroll(modelName);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/agent/leaderboard", async (req, res) => {
  const modelName = typeof req.query.model_name === "string" ? req.query.model_name : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 3;
  try {
    const data = await getLeaderboard(modelName, limit);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/agent/past-performance", async (req, res) => {
  const modelName = req.query.model_name;
  const eventId = typeof req.query.event_id === "string" ? req.query.event_id : undefined;
  const poolLimit = req.query.pool_limit ? Number(req.query.pool_limit) : 5;
  const ownLimit = req.query.own_limit ? Number(req.query.own_limit) : 3;
  if (typeof modelName !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'model_name' is required" });
    return;
  }
  try {
    const data = await getPastPerformance(modelName, eventId, poolLimit, ownLimit);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/agent/markets", async (req, res) => {
  const eventId = req.query.event_id;
  const expandTicker = req.query.expand_ticker;
  if (typeof eventId !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'event_id' is required" });
    return;
  }
  try {
    const siblings = await getEventSiblings(eventId);
    const siblingBundles = await fetchSiblingBundles(siblings);
    const selection = buildMarketSelection(siblingBundles);
    const expanded = typeof expandTicker === "string" ? findExpandedSibling(siblingBundles, expandTicker) : null;
    res.json({
      ok: true,
      data: {
        siblings: selection.siblings,
        core_markets: selection.core_markets,
        top_prop_markets: selection.top_prop_markets,
        omitted: selection.omitted,
        expanded,
      },
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/agent/history", async (req, res) => {
  const eventId = req.query.event_id;
  const windowHours = req.query.window_hours ? Number(req.query.window_hours) : 24;
  if (typeof eventId !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'event_id' is required" });
    return;
  }
  try {
    const siblings = await getEventSiblings(eventId);
    const nowSec = Math.floor(Date.now() / 1000);
    const siblingBundles = await fetchSiblingBundles(siblings, {
      startTs: nowSec - windowHours * 3600,
      endTs: nowSec,
      periodInterval: 60,
    });
    const selection = buildMarketSelection(siblingBundles);
    const markets = computeMarketHistory(siblingBundles, selection);
    res.json({ ok: true, data: { window_hours: windowHours, markets } });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/agent/forecast", async (req, res) => {
  const eventId = req.query.event_id;
  const windowHours = req.query.window_hours ? Number(req.query.window_hours) : 24;
  if (typeof eventId !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'event_id' is required" });
    return;
  }
  try {
    const siblings = await getEventSiblings(eventId);
    const { result, unavailable_siblings } = await getForecastSummary(siblings, windowHours);
    res.json({ ok: true, data: { ...(result ?? {}), unavailable_siblings } });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/agent/market-detail", async (req, res) => {
  const ticker = req.query.ticker;
  if (typeof ticker !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'ticker' is required" });
    return;
  }
  try {
    const data = await getMarketDetail(ticker);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/polymarket/search-events", async (req, res) => {
  const q = req.query.q;

  if (typeof q !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'q' is required" });
    return;
  }

  const status = req.query.status;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  try {
    const candidates = await findMatchEvents(q, {
      status: status === "active" || status === "closed" ? status : "all",
      limit,
    });
    res.json({ ok: true, events: candidates });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/polymarket/resolve-url", async (req, res) => {
  const url = req.query.url;

  if (typeof url !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'url' is required" });
    return;
  }

  try {
    const { eventId, slug } = await resolvePolymarketEventUrl(url);
    res.json({ ok: true, event_id: eventId, slug });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/polymarket/match-bundle", async (req, res) => {
  const eventIdsParam = req.query.event_ids;

  if (typeof eventIdsParam !== "string" || eventIdsParam.trim() === "") {
    res.status(400).json({
      ok: false,
      error:
        "Query param 'event_ids' is required: a comma-separated list of Polymarket event ids for the same match (see /polymarket/search-events)",
    });
    return;
  }

  const eventIds = eventIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
  const startTs = req.query.start_ts ? Number(req.query.start_ts) : undefined;
  const endTs = req.query.end_ts ? Number(req.query.end_ts) : undefined;
  const fidelity = req.query.fidelity ? Number(req.query.fidelity) : undefined;

  try {
    const bundle = await getMatchBundle(eventIds, { startTs, endTs, fidelity });
    const data = req.query.compact === "true" ? toCompactMatchBundle(bundle) : bundle;
    res.json({ ok: true, data });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
