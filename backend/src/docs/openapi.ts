export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "disposable-income backend",
    version: "0.1.0",
    description:
      "Connectivity endpoints for external market APIs (Kalshi, Polymarket).",
  },
  paths: {
    "/ping-kalshi": {
      get: {
        summary: "Ping Kalshi's exchange status endpoint",
        responses: {
          "200": {
            description: "Kalshi exchange status retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    kalshi: {
                      type: "object",
                      properties: {
                        exchange_active: { type: "boolean" },
                        trading_active: { type: "boolean" },
                        intra_exchange_transfers_active: { type: "boolean" },
                        exchange_estimated_resume_time: { type: "string" },
                        exchange_index_statuses: {
                          type: "array",
                          items: { type: "object" },
                        },
                      },
                    },
                  },
                },
                example: {
                  ok: true,
                  kalshi: { exchange_active: true, trading_active: true },
                },
              },
            },
          },
          "502": {
            description: "Kalshi request failed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/kalshi/resolve-url": {
      get: {
        summary:
          "Resolve a kalshi.com market page URL into series_ticker + event_ticker",
        parameters: [
          {
            name: "url",
            in: "query",
            required: true,
            schema: { type: "string" },
            description:
              "A kalshi.com market URL, e.g. https://kalshi.com/markets/kxwcadvance/world-cup-advance/kxwcadvance-26jul11noreng. Works whether the last path segment is the bare event ticker or a specific market's ticker.",
          },
        ],
        responses: {
          "200": {
            description: "Tickers resolved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    series_ticker: { type: "string" },
                    event_ticker: { type: "string" },
                  },
                },
                example: {
                  ok: true,
                  series_ticker: "KXWCADVANCE",
                  event_ticker: "KXWCADVANCE-26JUL11NORENG",
                },
              },
            },
          },
          "400": {
            description: "Missing 'url' query param",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
          "502": {
            description: "URL didn't resolve to a real Kalshi event/market",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/kalshi/event-bundle": {
      get: {
        summary:
          "Aggregate all Kalshi data for one event (markets, metadata, candlesticks, forecast history)",
        parameters: [
          {
            name: "series_ticker",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Kalshi series ticker the event belongs to. Required unless 'url' is given.",
          },
          {
            name: "event_ticker",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Kalshi event ticker identifying the specific match/event. Required unless 'url' is given.",
          },
          {
            name: "url",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "A kalshi.com market URL to resolve instead of passing series_ticker/event_ticker directly (see /kalshi/resolve-url).",
          },
          {
            name: "start_ts",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description:
              "Unix seconds; defaults to the earliest open_time across the event's markets",
          },
          {
            name: "end_ts",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description:
              "Unix seconds; defaults to the latest market close_time, capped at now",
          },
          {
            name: "period_interval",
            in: "query",
            required: false,
            schema: { type: "integer", enum: [1, 60, 1440] },
            description:
              "Candlestick/forecast bucket size in minutes. Defaults automatically: 60 (hourly) if the start/end window is 7 days or less, 1440 (daily) beyond that, to keep payload size bounded.",
          },
          {
            name: "percentiles",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Comma-separated percentiles on a 0-9999 scale (e.g. 5000 = 50th); default 1000,2500,5000,7500,9000",
          },
          {
            name: "compact",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["true"] },
            description:
              "Pass 'true' to get an LLM-friendly slimmed-down payload instead of the raw Kalshi response shape: drops legal/contract text, image URLs, and redundant candlestick fields, keeping only price/volume/open-interest per bucket. Cuts payload size by ~80-95% with no loss of predictive signal.",
          },
        ],
        responses: {
          "200": {
            description:
              "Aggregated event bundle retrieved successfully. Shape of 'data' depends on 'compact': the raw Kalshi response shape by default, or a slimmed-down { event, markets, priceHistory, forecastHistory?, multivariateEvents?, partialErrors? } shape when compact=true.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        event: { type: "object" },
                        markets: { type: "array", items: { type: "object" } },
                        metadata: { type: "object", nullable: true },
                        candlesticks: { type: "object", nullable: true },
                        forecastHistory: { type: "object", nullable: true },
                        multivariateEvents: { type: "object", nullable: true },
                        priceHistory: {
                          type: "array",
                          description: "compact=true only, replaces 'candlesticks'",
                          items: { type: "object" },
                        },
                        partialErrors: {
                          type: "object",
                          description:
                            "Keyed by section name (metadata/candlesticks/forecastHistory/multivariateEvents); present when that section failed to load, e.g. forecast history isn't available for events made up only of binary threshold markets.",
                          additionalProperties: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description:
              "Neither 'series_ticker'+'event_ticker' nor 'url' were provided",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
          "502": {
            description: "Kalshi request failed, or 'url' didn't resolve to a real event/market",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/polymarket/search-events": {
      get: {
        summary:
          "Find Polymarket events relevant to a match (ask 1: discovery). Polymarket splits one real-world match across several sibling event resources (e.g. '90 Min Result', 'Exact Score', 'Both Teams To Score?'), so this returns all matching candidates rather than a single event - review titles and feed the relevant ids into /polymarket/match-bundle.",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Free-text search, e.g. 'Chelsea vs PSG' or 'Spain France'",
          },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["active", "closed", "all"] },
            description: "Filter by event status; default 'all'",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "Max results; default 20",
          },
        ],
        responses: {
          "200": {
            description: "Candidate events retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    events: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          slug: { type: "string" },
                          title: { type: "string" },
                          startDate: { type: "string" },
                          endDate: { type: "string" },
                          closed: { type: "boolean" },
                          volume: { type: "number" },
                          category: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'q' query param",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
          "502": {
            description: "Polymarket request failed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/polymarket/resolve-url": {
      get: {
        summary: "Resolve a polymarket.com event page URL into an event id + slug",
        parameters: [
          {
            name: "url",
            in: "query",
            required: true,
            schema: { type: "string" },
            description:
              "A polymarket.com event URL, e.g. https://polymarket.com/event/fifa-club-world-cup-chelsea-vs-psg-exact-score",
          },
        ],
        responses: {
          "200": {
            description: "Resolved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    event_id: { type: "string" },
                    slug: { type: "string" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'url' query param",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
          "502": {
            description: "URL didn't resolve to a real Polymarket event",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/polymarket/match-bundle": {
      get: {
        summary:
          "Aggregate all Polymarket data for one match (ask 2: extraction). Flattens the markets of every given sibling event into one list (each tagged with its source event), plus per-market price history, mirroring Kalshi's event-bundle shape as closely as Polymarket's data model allows.",
        parameters: [
          {
            name: "event_ids",
            in: "query",
            required: true,
            schema: { type: "string" },
            description:
              "Comma-separated Polymarket event ids for the same match, from /polymarket/search-events",
          },
          {
            name: "start_ts",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "Unix seconds; defaults to the earliest startDate across the given events",
          },
          {
            name: "end_ts",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "Unix seconds; defaults to the latest endDate across the given events, capped at now",
          },
          {
            name: "fidelity",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description:
              "Price-history bucket size in minutes. Defaults to 60 (hourly) if the window is 7 days or less, 1440 (daily) beyond that.",
          },
          {
            name: "compact",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["true"] },
            description:
              "Pass 'true' for an LLM-friendly slimmed-down payload: drops descriptions/images and normalizes Polymarket's stringified numeric fields into the same { yes_price, yes_bid, yes_ask, volume } shape used for Kalshi's compact bundle.",
          },
        ],
        responses: {
          "200": {
            description: "Aggregated match bundle retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        match: { type: "object" },
                        events: { type: "array", items: { type: "object" } },
                        markets: { type: "array", items: { type: "object" } },
                        priceHistory: { type: "array", items: { type: "object" } },
                        partialErrors: {
                          type: "object",
                          description:
                            "Keyed by section (competition, priceHistory:<marketId>); present when that section failed to load",
                          additionalProperties: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_ids' query param",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
          "502": {
            description: "Polymarket request failed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/ping-poly": {
      get: {
        summary: "Ping Polymarket's CLOB server-time endpoint",
        responses: {
          "200": {
            description: "Polymarket server time retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    polymarket: {
                      type: "object",
                      properties: {
                        unixTimestamp: { type: "number" },
                      },
                    },
                  },
                },
                example: {
                  ok: true,
                  polymarket: { unixTimestamp: 1783745052 },
                },
              },
            },
          },
          "502": {
            description: "Polymarket request failed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
