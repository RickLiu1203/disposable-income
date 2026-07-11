import "dotenv/config";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { getExchangeStatus } from "./kalshi/kalshi";
import { getEventBundle, resolveKalshiMarketUrl } from "./kalshi/kalshiEvents";
import { EventAlreadyIngestedError, ingestKalshiEvent } from "./kalshi/kalshiIngest";
import { getEventDetail, listEvents } from "./events/eventsRead";
import { settleEvent } from "./kalshi/kalshiSettle";
import { getServerTime } from "./polymarket/polymarket";
import { pingSupabase } from "./supabase/supabaseClient";
import {
  findMatchEvents,
  getMatchBundle,
  resolvePolymarketEventUrl,
  toCompactMatchBundle,
} from "./polymarket/polymarketEvents";
import { openapiSpec } from "./docs/openapi";
import { placeBulkPredictions, PredictionValidationError } from "./predictions/predictionsPlace";

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

  try {
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

app.get("/events/detail", async (req, res) => {
  const eventTicker = req.query.event_ticker;

  if (typeof eventTicker !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'event_ticker' is required" });
    return;
  }

  try {
    const data = await getEventDetail(eventTicker);
    if (!data) {
      res.status(404).json({ ok: false, error: `No ingested event found for '${eventTicker}'` });
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

  if (typeof eventTicker !== "string") {
    res.status(400).json({ ok: false, error: "Query param 'event_ticker' is required" });
    return;
  }

  try {
    const data = await settleEvent(eventTicker);
    res.json({ ok: true, data });
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
    typeof body?.event_ticker !== "string" ||
    !Array.isArray(body?.models) ||
    body.models.length === 0
  ) {
    res.status(400).json({
      ok: false,
      error: "Body must include 'event_ticker' (string) and a non-empty 'models' array",
    });
    return;
  }

  try {
    const data = await placeBulkPredictions(body);
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
