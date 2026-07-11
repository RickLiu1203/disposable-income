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
