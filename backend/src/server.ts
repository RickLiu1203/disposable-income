import "dotenv/config";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { getExchangeStatus } from "./kalshi/kalshi";
import { getEventBundle, resolveKalshiMarketUrl, toCompactBundle } from "./kalshi/kalshiEvents";
import { getServerTime } from "./polymarket/polymarket";
import {
  findMatchEvents,
  getMatchBundle,
  resolvePolymarketEventUrl,
  toCompactMatchBundle,
} from "./polymarket/polymarketEvents";
import { openapiSpec } from "./docs/openapi";

const app = express();
const port = process.env.PORT || 3000;

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
    const bundle = await getEventBundle(seriesTicker, eventTicker, {
      startTs,
      endTs,
      periodInterval,
      percentiles,
    });
    const data = req.query.compact === "true" ? toCompactBundle(bundle) : bundle;
    res.json({ ok: true, data });
  } catch (error) {
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
