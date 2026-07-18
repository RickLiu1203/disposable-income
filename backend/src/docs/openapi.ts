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
          {
            name: "ingest_all_props",
            in: "query",
            required: false,
            schema: { type: "boolean" },
            description:
              "If true, resolves the sports match milestone and automatically ingests all related sibling event tickers (moneyline, spread, totals, correct score, etc.) in a single call. In either mode, markets are capped once at ingestion via the same core+top-props-by-volume selection GET /agent/markets computes live (core siblings kept in full, non-core props pooled and capped to a floor of 50 total) -- only the selected markets are written, so GET /events/market-snapshot and the agent pipeline read the same frozen set. Not re-evaluated after ingestion.",
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
                          status: { type: "string", nullable: true, description: "Raw ingestion-time status column -- set once at ingest and never updated again, so it goes stale the moment any prediction settles. Prefer live_status." },
                          live_status: {
                            type: "string",
                            enum: ["open", "in_progress", "completed"],
                            description: "Freshly-derived event state, computed on every read from match_start_time (falling back to open_time for pre-migration rows) and whether any prediction is still pending: 'completed' once at least one prediction exists and none are pending; 'in_progress' once at least one pending prediction exists and match_start_time has passed; 'open' otherwise (including an event that's started but never received a single bet).",
                          },
                          open_time: { type: "string", nullable: true, description: "When Kalshi opened this event's earliest market for trading -- often days before the real match. Not a reliable 'has it started' signal; prefer match_start_time / live_status." },
                          match_start_time: { type: "string", nullable: true, description: "The real-world match kickoff, sourced from Kalshi's occurrence_datetime. Null for events ingested before this field existed." },
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
      delete: {
        summary: "Delete (nuke) one ingested event and all its related records from the database",
        description:
          "Deletes the event and all matching predictions, model results, model strategies, payouts, forecast percentiles, forecast snapshots, related events, markets, and market price history from Supabase.",
        parameters: [
          {
            name: "event_ticker",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Kalshi event ticker of the event to nuke.",
          },
        ],
        responses: {
          "200": {
            description: "Event and all related records deleted successfully",
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
                        predictions_deleted: { type: "number" },
                        model_results_deleted: { type: "number" },
                        model_strategies_deleted: { type: "number" },
                        payouts_deleted: { type: "number" },
                        forecast_percentiles_deleted: { type: "number" },
                        forecast_snapshots_deleted: { type: "number" },
                        related_events_deleted: { type: "number" },
                        market_price_history_deleted: { type: "number" },
                        markets_deleted: { type: "number" },
                        event_deleted: { type: "boolean" },
                      },
                    },
                  },
                },
                example: {
                  ok: true,
                  data: {
                    event_ticker: "KXWCADVANCE-26JUL11NORENG",
                    predictions_deleted: 1,
                    model_results_deleted: 1,
                    model_strategies_deleted: 1,
                    payouts_deleted: 0,
                    forecast_percentiles_deleted: 0,
                    forecast_snapshots_deleted: 0,
                    related_events_deleted: 0,
                    market_price_history_deleted: 96,
                    markets_deleted: 2,
                    event_deleted: true,
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
            description: "Event not found",
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
    "/events/match-start-time": {
      patch: {
        summary: "Correct one event's match_start_time (the real-world kickoff), for when Kalshi's sourced value is wrong",
        description:
          "Overwrites events.match_start_time with a caller-supplied ISO 8601 timestamp. This is the one column the value poller's gating query and computeEventStatus both trust for 'has this event actually started' (see the 'Match start vs. market open' note in CLAUDE.md) -- correcting it here immediately makes the event eligible for the next live-poll cycle (within 5 minutes) if the new time is in the past and the event has a pending prediction, without needing to re-ingest.",
        parameters: [
          {
            name: "event_id",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "UUID of the consolidated parent event to correct.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["match_start_time"],
                properties: {
                  match_start_time: {
                    type: "string",
                    description: "New real-world kickoff time, any format the JS Date constructor accepts (ISO 8601 recommended). Stored normalized to ISO 8601 UTC.",
                    example: "2026-07-15T19:00:00.000Z",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "match_start_time updated successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        event_id: { type: "string" },
                        match_start_time: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_id' query param, missing 'match_start_time' body field, or an unparseable timestamp",
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
            description: "No event found for the given event_id",
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
                        event: {
                          type: "object",
                          description:
                            "Includes live_status: 'open' | 'in_progress' | 'completed', freshly derived on every read from match_start_time (the real match kickoff, sourced from Kalshi's occurrence_datetime -- falls back to open_time for pre-migration rows) and whether any prediction is still pending -- not the raw (and stale-after-settlement) status column. Also includes open_time (when Kalshi opened the market for trading, often days before match_start_time) and match_start_time directly.",
                        },
                        markets: { type: "array", items: { type: "object" } },
                        priceHistory: { type: "array", items: { type: "object" } },
                        forecastHistory: { type: "array", items: { type: "object" } },
                        relatedEvents: { type: "array", items: { type: "object" } },
                        predictions: {
                          type: "array",
                          items: { type: "object" },
                          description:
                            "Every model prediction placed against this consolidated event: model_name, market_ticker, side, stake, entry_price, justification, outcome, payout, placed_at, settled_at, live_value, live_value_as_of. live_value is the poller's live mark-to-market dollar value for a still-pending prediction (same number, same cycle, as what feeds that model's model_event_value_snapshots row) -- null until the poller has run at least once for this event. Once outcome is no longer 'pending', prefer payout (the real, final number) over live_value, which simply stops updating.",
                        },
                        strategies: {
                          type: "array",
                          items: { type: "object" },
                          description: "Per-model overall strategy notes for this consolidated event: model_name, strategy_notes, strategy_headline (nullable -- null for rows written before that column existed), created_at.",
                        },
                        leaderboard: {
                          type: "array",
                          items: { type: "object" },
                          description: "Event-level leaderboard for participating models: model_name, starting_balance, ending_balance, percent_change, event_rank, prediction_count, strategy_notes, strategy_headline.",
                        },
                        starting_balances: {
                          type: "object",
                          additionalProperties: { type: "number" },
                          description: "Every model's starting bankroll ('pot') for this specific event, keyed by model_name -- prefers model_event_results.starting_balance, falls back to the model's current live overall balance before that's seeded. Use this as the baseline for any per-event chart/display; do not assume a fresh $10 per event, since balances carry forward continuously across matches.",
                        },
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
    "/events/lifetime-leaderboard": {
      get: {
        summary: "Retrieve the global lifetime leaderboard across all models",
        description: "Queries the lifetime_leaderboard view and returns aggregate model standings sorted by rank.",
        responses: {
          "200": {
            description: "Lifetime leaderboard retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          model_name: { type: "string" },
                          events_participated: { type: "number" },
                          avg_percent_change: { type: "number" },
                          total_pnl: { type: "number" },
                          total_rewards_earned: { type: "number" },
                          lifetime_rank: { type: "number" },
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
    "/events/balance-history": {
      get: {
        summary: "Flat per-event, per-model ending balance for every settled match, for the MainScreen leaderboard chart",
        description:
          "One cheap query straight against model_event_results (event_id, model_name, ending_balance), no per-event fan-out. Exists to replace the N+1 pattern of calling GET /events/detail once per event just to read each response's leaderboard.ending_balance out of an otherwise-unused full markets/predictions/price-history bundle -- that pattern was slow (N heavy fetches) and, under React StrictMode's double-invoked effects, could leave the frontend's loading state stuck. Callers group rows by event_id client-side after already having the ordered event list from GET /events.",
        responses: {
          "200": {
            description: "Balance history retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          event_id: { type: "string" },
                          model_name: { type: "string" },
                          ending_balance: { type: "number", nullable: true },
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
    "/events/market-snapshot": {
      get: {
        summary: "Volume-sorted live-ish price snapshot of every market in an event, for the EventScreen Markets panel",
        description:
          "For each market in the event, prefers the latest market_price_history row if one exists (is_live_priced: true, as_of = that row's period_end_ts), else falls back to the ingestion-time markets row (is_live_priced: false, as_of = ingestion time). Note market_price_history is written by both ingestion-time candlestick backfill and the live value poller (valuePoller.ts) -- is_live_priced doesn't strictly mean 'from the last 5 minutes', it means 'has a real timestamped price point'. Render as_of directly rather than inferring freshness from is_live_priced alone. 'Every market in the event' means every row in the markets table for it -- for events ingested after the ingestion-time cap was added (see POST /kalshi/add-event), that's already the frozen core+top-50-props selection, not Kalshi's full market list; this endpoint does no additional filtering of its own. Sorted by resolved volume descending, server-side. Also returns `history` (the market's full priced market_price_history series, ascending, {price, as_of} per point -- backs a per-market sparkline; no new polling needed, this just reads the series the value poller was already writing) and `change` (last history price minus first, null with fewer than two priced points -- backs gainers/losers/highest/lowest sorting client-side). Only market label is meant to be shown to end users -- ticker/event_ticker are included for internal lookups only.",
        parameters: [
          {
            name: "event_id",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "The consolidated parent event id (UUID).",
          },
        ],
        responses: {
          "200": {
            description: "Snapshot retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        event_id: { type: "string" },
                        markets: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              ticker: { type: "string" },
                              event_ticker: { type: "string" },
                              label: { type: "string", nullable: true },
                              price: { type: "number", nullable: true },
                              volume: { type: "number", nullable: true },
                              as_of: { type: "string", nullable: true },
                              is_live_priced: { type: "boolean" },
                              history: {
                                type: "array",
                                items: {
                                  type: "object",
                                  properties: { price: { type: "number" }, as_of: { type: "string" } },
                                },
                              },
                              change: { type: "number", nullable: true },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_id' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "404": {
            description: "No ingested event found for that id",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Database read failed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
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
    "/predictions/adjust-balance": {
      post: {
        summary: "Manually adjust a model's ending balance for a settled event, propagating the change",
        description:
          "Manually sets the ending balance for a model on a specific settled event. This recalculates the event's payouts and propagates the balance shift forward through the starting/ending balances of all subsequent settled events that any model participated in, keeping the database consistent and updating models.current_balance.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["event_id", "model_name", "ending_balance"],
                properties: {
                  event_id: { type: "string", format: "uuid", description: "The UUID of the parent event." },
                  model_name: { type: "string", description: "The name of the model to adjust." },
                  ending_balance: { type: "number", minimum: 0, description: "The new manual ending balance." },
                },
              },
              example: {
                event_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                model_name: "sonnet-5",
                ending_balance: 12.5,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Balance adjusted and propagated successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        success: { type: "boolean", example: true },
                        propagatedEvents: { type: "array", items: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid input values",
          },
          "502": {
            description: "Propagation failed or database request failed",
          },
        },
      },
    },
    "/agent/bankroll": {
      get: {
        summary: "Agent pipeline step 1: fetch a model's current bankroll and its change since its last match",
        description:
          "Returns three numbers: current_balance (models.current_balance), previous_balance (this model's starting_balance on its most recently played match, from model_event_results), and change (computed server-side). previous_balance/change are null if the model has no settled match history yet.",
        parameters: [
          {
            name: "model_name",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "The model to fetch bankroll info for.",
          },
        ],
        responses: {
          "200": {
            description: "Bankroll info retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        model_name: { type: "string" },
                        current_balance: { type: "number" },
                        previous_balance: { type: "number", nullable: true },
                        change: { type: "number", nullable: true },
                      },
                    },
                  },
                },
                example: { ok: true, data: { model_name: "sonnet-5", current_balance: 12.4, previous_balance: 10, change: 2.4 } },
              },
            },
          },
          "400": {
            description: "Missing 'model_name' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Unknown model or Supabase request failed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
        },
      },
    },
    "/agent/leaderboard": {
      get: {
        summary: "Agent pipeline step 2: fetch the tournament's top-3 lifetime leaderboard, plus the requesting model's own rank",
        description:
          "Returns exactly 3 leaderboard entries (ranked by lifetime average performance) plus 1 own-rank entry, regardless of tournament length. Each entry includes its single best-ever match (from the agent_best_performances view, performance_rank=1) with a one-sentence strategy_headline (may be null for rows written before the headline column existed).",
        parameters: [
          {
            name: "model_name",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "The requesting model, to populate 'your_rank' even when it isn't in the top 3.",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 3 },
            description: "Number of top leaderboard entries to return; default 3.",
          },
        ],
        responses: {
          "200": {
            description: "Leaderboard retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        top: { type: "array", items: { type: "object" } },
                        your_rank: { type: "object", nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
          "502": {
            description: "Supabase request failed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
        },
      },
    },
    "/agent/past-performance": {
      get: {
        summary: "Agent pipeline step 3: fetch recent (short-term) match-form signals, distinct from step 2's lifetime average",
        description:
          "Returns three bounded signals: recent_pool_top/recent_pool_bottom (pools each model's last-up-to-3 settled matches, capped to the best/worst pool_limit by percent_change), and own_recent (the requesting model's own last-up-to-own_limit settled matches, always included). Bounded to at most pool_limit*2 + own_limit entries (13 by default) regardless of how many models/matches accumulate.",
        parameters: [
          { name: "model_name", in: "query", required: true, schema: { type: "string" } },
          { name: "event_id", in: "query", required: false, schema: { type: "string", format: "uuid" }, description: "Current event id, excluded from the pooled/own history if already present." },
          { name: "pool_limit", in: "query", required: false, schema: { type: "integer", default: 5 } },
          { name: "own_limit", in: "query", required: false, schema: { type: "integer", default: 3 } },
        ],
        responses: {
          "200": {
            description: "Past performance retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        recent_pool_top: { type: "array", items: { type: "object" } },
                        recent_pool_bottom: { type: "array", items: { type: "object" } },
                        own_recent: { type: "array", items: { type: "object" } },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'model_name' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Supabase request failed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
        },
      },
    },
    "/agent/markets": {
      get: {
        summary: "Agent pipeline step 4: fetch this event's live markets, bounded to core markets + top props by volume",
        description:
          "Live-fetches every sibling event ticker (from event_tickers) from Kalshi for fresh prices, then restricts each sibling's markets down to the ticker set frozen at ingestion (every ticker in the markets table for this event_id -- see POST /kalshi/add-event) before splitting into core_markets (always included in full, per CORE_SERIES_SUFFIXES_BY_PREFIX in agentMarketConfig.ts) and top_prop_markets (pooled across all non-core siblings, highest volume first). The agent can only ever pick from this frozen set, matching what GET /events/market-snapshot shows -- for events ingested after the cap was added the set is already <= core + 50 props, so 'omitted' is normally empty. Pass expand_ticker to bypass the frozen-set restriction and get the full unbounded live market list of one specific sibling.",
        parameters: [
          { name: "event_id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          { name: "expand_ticker", in: "query", required: false, schema: { type: "string" }, description: "One sibling event_ticker to return the full (unbounded) market list for." },
        ],
        responses: {
          "200": {
            description: "Market selection retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        siblings: { type: "array", items: { type: "object" } },
                        core_markets: { type: "array", items: { type: "object" } },
                        top_prop_markets: { type: "array", items: { type: "object" } },
                        omitted: { type: "array", items: { type: "object" } },
                        expanded: { type: "object", nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_id' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Event not ingested (no sibling tickers), or a Kalshi request failed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
        },
      },
    },
    "/agent/history": {
      get: {
        summary: "Agent pipeline step 5: fetch live price-trend deltas for the same core+top-props markets step 4 shows",
        description:
          "Reuses the exact same core+top-props market selection as GET /agent/markets so the deltas line up with the markets just shown. Per market: price_now, delta_1h, delta_6h, delta_24h, direction_24h, all derived from live Kalshi candlesticks over the given window (no raw candlestick point arrays in the default response -- use GET /agent/market-detail for that).",
        parameters: [
          { name: "event_id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          { name: "window_hours", in: "query", required: false, schema: { type: "integer", default: 24 }, description: "How far back to fetch candlesticks for; deltas beyond the available window are null." },
        ],
        responses: {
          "200": {
            description: "Price history deltas retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: { window_hours: { type: "number" }, markets: { type: "array", items: { type: "object" } } },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_id' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Event not ingested, or a Kalshi request failed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
        },
      },
    },
    "/agent/forecast": {
      get: {
        summary: "Agent pipeline step 6: fetch a deterministic forecast band-width summary, live from Kalshi",
        description:
          "Catches a bias risk a naive 'median moved from A to B' hides: the median can stay flat while the 90th-percentile band swings widely across consecutive snapshots. Computed in code (not SQL, not LLM-narrated) from live getEventForecastPercentileHistory. Forecast history only resolves for numeric-scalar siblings (e.g. totals), not binary threshold markets, so this tries each core sibling in turn and returns the first with data; siblings that had no forecast data are listed in unavailable_siblings with a reason, not treated as a request failure.",
        parameters: [
          { name: "event_id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          { name: "window_hours", in: "query", required: false, schema: { type: "integer", default: 24 } },
        ],
        responses: {
          "200": {
            description: "Forecast summary retrieved successfully (data may be an empty object plus unavailable_siblings if no sibling had resolvable forecast history)",
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
                        latest: { type: "object", properties: { median: { type: "number", nullable: true }, p10: { type: "number", nullable: true }, p90: { type: "number", nullable: true }, band_width: { type: "number", nullable: true } } },
                        window_delta_median: { type: "number", nullable: true },
                        band_width_min_in_window: { type: "number", nullable: true },
                        band_width_max_in_window: { type: "number", nullable: true },
                        snapshot_count_in_window: { type: "number" },
                        unavailable_siblings: { type: "array", items: { type: "object" } },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_id' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Event not ingested, or a Kalshi request failed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
        },
      },
    },
    "/agent/market-detail": {
      get: {
        summary: "On-demand pipeline drill-down: full candlestick history, full forecast history, and full rules text for one market",
        description:
          "For when the agent is about to commit real capital to a specific market and wants more than GET /agent/markets / GET /agent/history's bounded summaries. Live-fetches the market's parent event and returns its full (unbounded) candlestick series and forecast history alongside the market's full rules text.",
        parameters: [{ name: "ticker", in: "query", required: true, schema: { type: "string" }, description: "The specific Kalshi market ticker to drill into." }],
        responses: {
          "200": {
            description: "Market detail retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        ticker: { type: "string" },
                        label: { type: "string" },
                        status: { type: "string" },
                        result: { type: "string" },
                        yes_price: { type: "number", nullable: true },
                        yes_bid: { type: "number", nullable: true },
                        yes_ask: { type: "number", nullable: true },
                        rules_primary: { type: "string" },
                        rules_secondary: { type: "string" },
                        candlesticks: { type: "array", items: { type: "object" } },
                        forecast_history: { type: "array", items: { type: "object" }, nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'ticker' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Kalshi request failed (unknown ticker, etc.)",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
        },
      },
    },
    "/agent/value-history": {
      get: {
        summary: "Live mark-to-market bankroll history per model for one event, over time",
        description:
          "Reads the persisted output of the server-side value poller (backend/src/agent/valuePoller.ts): every 5 minutes, for each event that has started (Kalshi-sourced match_start_time, the real match kickoff -- not open_time, which is when Kalshi opened the market for trading and is routinely days earlier), has at least one prediction placed, and still has a pending prediction, the poller live-fetches Kalshi and writes each model's current mark-to-market bankroll for that event to model_event_value_snapshots. This endpoint is a pure DB read of that history (one series per model, ordered by snapshot_ts) -- it never calls Kalshi itself, so it's safe to poll from the frontend as often as needed. Distinct from GET /events/detail's leaderboard, which only has the one final ending_balance written at settlement; this has the whole path to get there. Returns an empty array for an event with no bets yet, or one that hasn't started, or one that's already fully settled (the poller only writes new points for events currently live).",
        parameters: [
          {
            name: "event_id",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "The consolidated parent event id (UUID) to read value history for.",
          },
        ],
        responses: {
          "200": {
            description: "Value history retrieved successfully (possibly empty)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          model_name: { type: "string" },
                          points: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                snapshot_ts: { type: "string", format: "date-time" },
                                unrealized_balance: { type: "number" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_id' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Database read failed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
        },
      },
    },
    "/agent/system-prompt": {
      get: {
        summary: "Renders the agent system prompt, adapted for one model, one event, and a custom backend URL",
        description:
          "Reads backend/prediction-market-agent-system-prompt.md and substitutes {{CURRENT_EVENT_ID}}, {{YOUR_MODEL_NAME}}, and {{BACKEND_BASE_URL}} with the given query params or auto-inferred request host context. Backs the EventScreen 'Copy system prompt' control in a model's Predictions view. Pure text substitution, no DB or Kalshi calls.",
        parameters: [
          { name: "event_id", in: "query", required: true, schema: { type: "string" }, description: "Consolidated parent event id to fill into {{CURRENT_EVENT_ID}}." },
          { name: "model_name", in: "query", required: true, schema: { type: "string" }, description: "Model name to fill into {{YOUR_MODEL_NAME}}, e.g. sonnet-5." },
          { name: "backend_base_url", in: "query", required: false, schema: { type: "string" }, description: "Base URL to fill into {{BACKEND_BASE_URL}}. If omitted, defaults to the request host/protocol." },
        ],
        responses: {
          "200": {
            description: "Prompt rendered successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    data: { type: "object", properties: { prompt: { type: "string" } } },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing 'event_id' or 'model_name' query param",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
          },
          "502": {
            description: "Failed to read the prompt file",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
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
