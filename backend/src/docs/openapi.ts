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
        ],
        responses: {
          "200": {
            description:
              "Aggregated event bundle retrieved successfully, always in the LLM-friendly compact shape: legal/contract text, image URLs, and redundant candlestick fields are stripped, keeping only price/volume/open-interest per bucket (~80-95% smaller than Kalshi's raw response with no loss of predictive signal). There is no way to request the raw shape.",
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
                        priceHistory: { type: "array", items: { type: "object" } },
                        forecastHistory: { type: "object", nullable: true },
                        multivariateEvents: { type: "object", nullable: true },
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
    "/kalshi/add-event": {
      post: {
        summary: "Ingest one Kalshi event into Supabase (event + markets + price history + forecast + related events)",
        description:
          "Resolves the given URL (or series_ticker+event_ticker), fetches the same compact bundle GET /kalshi/event-bundle returns, and writes it into Supabase across events/markets/market_price_history/event_forecast_snapshots/event_forecast_percentiles/event_related_events. Insert-only: markets rows are a snapshot as of ingestion, not kept live, so re-submitting an event_ticker that's already in the events table returns 409 without touching any rows rather than overwriting it.",
        parameters: [
          {
            name: "series_ticker",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Kalshi series ticker the event belongs to. Required unless 'url' is given.",
          },
          {
            name: "event_ticker",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Kalshi event ticker identifying the specific match/event. Required unless 'url' is given.",
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
            description: "Unix seconds; defaults to the earliest open_time across the event's markets",
          },
          {
            name: "end_ts",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "Unix seconds; defaults to the latest market close_time, capped at now",
          },
          {
            name: "period_interval",
            in: "query",
            required: false,
            schema: { type: "integer", enum: [1, 60, 1440] },
            description:
              "Candlestick/forecast bucket size in minutes, also stored as market_price_history.period_interval. Defaults automatically: 60 (hourly) if the start/end window is 7 days or less, 1440 (daily) beyond that.",
          },
          {
            name: "percentiles",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Comma-separated percentiles on a 0-9999 scale (e.g. 5000 = 50th); default 1000,2500,5000,7500,9000",
          },
        ],
        responses: {
          "200": {
            description: "Event ingested successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    event_ticker: { type: "string" },
                    series_ticker: { type: "string" },
                    markets: { type: "number" },
                    price_history_points: { type: "number" },
                    forecast_percentiles: { type: "number" },
                    related_events: { type: "number" },
                    partialErrors: {
                      type: "object",
                      description:
                        "Passed through from the compact bundle fetch; present when a section (e.g. forecastHistory) failed to load from Kalshi. Not a write failure.",
                      additionalProperties: { type: "string" },
                    },
                  },
                },
                example: {
                  ok: true,
                  event_ticker: "KXWCADVANCE-26JUL11NORENG",
                  series_ticker: "KXWCADVANCE",
                  markets: 2,
                  price_history_points: 96,
                  forecast_percentiles: 0,
                  related_events: 0,
                },
              },
            },
          },
          "400": {
            description: "Neither 'series_ticker'+'event_ticker' nor 'url' were provided",
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
          "409": {
            description: "This event_ticker already has a row in the events table; no rows were touched",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
                example: { ok: false, error: "Event already ingested: KXWCADVANCE-26JUL11NORENG" },
              },
            },
          },
          "502": {
            description: "Kalshi request failed, 'url' didn't resolve, or a Supabase write failed",
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
    "/events": {
      get: {
        summary: "List all ingested events, for a frontend event picker/list view",
        description:
          "Reads the events table (not live Kalshi data) — only events that have gone through POST /kalshi/add-event show up here. Ordered most-recently-ingested first.",
        responses: {
          "200": {
            description: "Events listed successfully (empty array if nothing has been ingested yet)",
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
                          event_ticker: { type: "string" },
                          series_ticker: { type: "string" },
                          event_name: { type: "string" },
                          sub_title: { type: "string", nullable: true },
                          competition: { type: "string", nullable: true },
                          competition_scope: { type: "string", nullable: true },
                          status: { type: "string", nullable: true },
                          open_time: { type: "string", nullable: true },
                          close_time: { type: "string", nullable: true },
                          created_at: { type: "string" },
                          market_count: { type: "number" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "502": {
            description: "Supabase request failed",
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
    "/events/detail": {
      get: {
        summary: "Full detail for one ingested event (event + markets + price history + forecast + related events)",
        description:
          "Reads the Supabase rows POST /kalshi/add-event wrote, reshaped back into the same {event, markets, priceHistory, forecastHistory, relatedEvents} shape the compact Kalshi bundle uses — for a frontend event detail page. Unlike GET /kalshi/event-bundle, this never calls Kalshi; it only reflects whatever was ingested (and won't include activity newer than the last ingestion).",
        parameters: [
          {
            name: "event_ticker",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Kalshi event ticker to look up (must have been ingested via POST /kalshi/add-event first).",
          },
        ],
        responses: {
          "200": {
            description: "Event detail retrieved successfully",
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
                        priceHistory: { type: "array", items: { type: "object" } },
                        forecastHistory: { type: "array", items: { type: "object" } },
                        relatedEvents: { type: "array", items: { type: "object" } },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_ticker' query param",
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
          "404": {
            description: "No ingested event found for this event_ticker",
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
            description: "Supabase request failed",
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
    "/predictions/settle": {
      post: {
        summary: "Settle one event's pending predictions against Kalshi's results",
        description:
          "Pulls this event's pending predictions, calls Kalshi's getEvent() once to see which underlying markets have resolved, settles whichever ones have (win/loss/void), recomputes model_event_results for any model whose predictions are now fully settled, and computes event_payouts once nothing is left pending for the event. Computing event_payouts also writes each participating model's total_payout into models.current_balance, which becomes that model's starting_balance the next time it participates in an event — capital carries over continuously rather than resetting to a fixed $10 each event. Safe to call repeatedly: if a market hasn't resolved yet, its predictions are left pending and no error is thrown — predictions_settled will just be 0. The leaderboard views (event_leaderboard, lifetime_leaderboard, event_overall_performance) read model_event_results/event_payouts live, so they reflect the new numbers immediately with no extra step.",
        parameters: [
          {
            name: "event_ticker",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Kalshi event ticker whose pending predictions should be settled.",
          },
        ],
        responses: {
          "200": {
            description: "Settlement pass completed (may have settled 0 predictions if none were newly resolvable)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        event_ticker: { type: "string" },
                        predictions_checked: { type: "number" },
                        predictions_settled: { type: "number" },
                        predictions_still_pending: { type: "number" },
                        models_finalized: { type: "array", items: { type: "string" } },
                        event_payouts_computed: { type: "boolean" },
                      },
                    },
                  },
                },
                example: {
                  ok: true,
                  data: {
                    event_ticker: "KXWCADVANCE-26JUL11NORENG",
                    predictions_checked: 4,
                    predictions_settled: 4,
                    predictions_still_pending: 0,
                    models_finalized: ["opus-4.8", "sonnet-5"],
                    event_payouts_computed: true,
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_ticker' query param",
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
            description: "Kalshi or Supabase request failed",
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
    "/predictions/place": {
      post: {
        summary: "Bulk-place predictions (and optional strategy notes) for one event, grouped by model",
        description:
          "Accepts one JSON config for an already-ingested event, grouped per model rather than a flat predictions list, so a model's overall strategy and all its per-market bets travel together. entry_price is never supplied by the caller - it's derived from the market's already-ingested yes_price (1 - yes_price for a 'no' side) at the moment the bet is placed. Validates the whole config up front (event exists, model names are known, market tickers belong to this event, side/stake/justification are well-formed) and writes nothing if anything fails - a single 400 lists every issue found, tagged by model_name and (for prediction-level issues) index within that model's predictions array. On success, inserts all prediction rows in one INSERT and upserts any model_event_strategies rows (one per model with strategy_notes, keyed by model_name+event_ticker).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["event_ticker", "models"],
                properties: {
                  event_ticker: { type: "string", description: "Kalshi event ticker; must already be ingested via POST /kalshi/add-event." },
                  models: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["model_name"],
                      properties: {
                        model_name: { type: "string" },
                        strategy_notes: { type: "string", description: "Optional overall strategy for this model on this event; upserts model_event_strategies." },
                        predictions: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["market_ticker", "side", "stake", "justification"],
                            properties: {
                              market_ticker: { type: "string", description: "Must belong to event_ticker." },
                              side: { type: "string", enum: ["yes", "no"] },
                              stake: { type: "number", description: "Dollars staked; must be > 0." },
                              justification: { type: "string", description: "This prediction's reasoning." },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              example: {
                event_ticker: "KXWCADVANCE-26JUL11NORENG",
                models: [
                  {
                    model_name: "sonnet-5",
                    strategy_notes: "Favoring stronger historical squads across all matches in this round.",
                    predictions: [
                      {
                        market_ticker: "KXWCADVANCE-26JUL11NORENG-ENG",
                        side: "yes",
                        stake: 3.5,
                        justification: "England's recent form and squad depth favor advancing over Norway.",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "All predictions inserted (and any strategy notes upserted)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        event_ticker: { type: "string" },
                        predictions_inserted: { type: "number" },
                        predictions: { type: "array", items: { type: "object" } },
                        strategies_upserted: { type: "number" },
                      },
                    },
                  },
                },
                example: {
                  ok: true,
                  data: {
                    event_ticker: "KXWCADVANCE-26JUL11NORENG",
                    predictions_inserted: 1,
                    predictions: [
                      {
                        id: 42,
                        model_name: "sonnet-5",
                        event_ticker: "KXWCADVANCE-26JUL11NORENG",
                        market_ticker: "KXWCADVANCE-26JUL11NORENG-ENG",
                        side: "yes",
                        stake: 3.5,
                        entry_price: 0.62,
                        justification: "England's recent form and squad depth favor advancing over Norway.",
                        outcome: "pending",
                        placed_at: "2026-07-11T12:00:00.000Z",
                      },
                    ],
                    strategies_upserted: 1,
                  },
                },
              },
            },
          },
          "400": {
            description:
              "Missing 'event_ticker'/'models', malformed JSON body, or a validation failure (unknown event/model/market, bad side/stake/justification) - includes a 'details' array covering every issue found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: false },
                    error: { type: "string" },
                    details: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          model_name: { type: "string" },
                          index: { type: "number" },
                          field: { type: "string" },
                          message: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "502": {
            description: "Supabase request failed",
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
    "/ping-supabase": {
      get: {
        summary: "Ping Supabase with a zero-row-fetch connectivity check",
        responses: {
          "200": {
            description: "Supabase reachable and schema migrations applied",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    supabase: {
                      type: "object",
                      properties: {
                        reachable: { type: "boolean", example: true },
                        models_count: { type: "number", nullable: true },
                      },
                    },
                  },
                },
                example: {
                  ok: true,
                  supabase: { reachable: true, models_count: 5 },
                },
              },
            },
          },
          "502": {
            description:
              "Supabase request failed (missing/invalid env vars, or migrations not yet applied)",
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
