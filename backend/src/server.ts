import "dotenv/config";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { getExchangeStatus } from "./services/kalshi";
import { getServerTime } from "./services/polymarket";
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

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
