# Agent Decision Pipeline: Atomic Endpoints, Trace Logging, Prompt Rewrite

**Scope note:** this is a pure backend/model-process change. No frontend UI work is in scope — the pipeline trace is logged to the database for direct SQL/audit access, but no viewer is being built for it here.

## Context

Right now an agent's "research" step is one giant, ad hoc block: the system prompt (`backend/prediction-market-agent-system-prompt.md`) tells the model to write its own raw SQL against Supabase (via MCP) for balances/leaderboards/history, separately browse a couple of URLs, separately web-search, then produce a JSON file. This has three concrete problems surfaced in planning, all grounded in the real database:

1. **Unbounded context.** One real match (Argentina vs Switzerland) has 22 sibling Kalshi tickers and 240+ markets. An unfiltered `SELECT * FROM markets WHERE event_id=...` returns everything, most of it (thin prop bets) irrelevant to any one decision.
2. **Staleness.** The DB's `markets`/`market_price_history`/`event_forecast_snapshots` are snapshots frozen at ingestion time — the agent has never been re-fetching live Kalshi odds before betting.
3. **No traceability.** There's no record of what data a model actually looked at before deciding — CLAUDE.md's own "Next steps" section still lists the Supabase MCP exposure as unimplemented, and nothing in this repo logs which steps a run performed.

The user has decided **not** to build an in-repo LLM-calling orchestrator (confirmed) — models keep running manually (pasted into a chat session, JSON output POSTed to `/predictions/place`). The fix is to turn the single "research" blob into 9 explicit, independently-tunable, independently-testable steps, each backed by a small dedicated endpoint (or an existing tool for the two pure-search steps), with each step's finding logged to the database so there's an exact record of what a model did — queryable directly, no UI required.

**Ground rules carried through every endpoint below** (confirmed against real data):
- **Price/odds/forecast data is always fetched live from Kalshi**, never read from the DB's ingestion-time snapshot tables — solves staleness by construction.
- **Structural mapping (which sibling tickers belong to this event) reads from the DB** (`event_tickers`) — it's metadata, not price data, and re-fetching it from Kalshi would be pure waste.
- **Tournament ledger data (bankroll, leaderboard, past results) reads from the DB** — it's small, and it *is* the source of truth for what must persist across matches.
- Every endpoint returns a **bounded, capped shape** by default, with an explicit "N more omitted" manifest and a drill-down param/endpoint for going deeper on one specific market — never a silent full dump.

---

## The 9 pipeline steps

| # | Step | Backed by |
|---|------|-----------|
| 1 | Fetch bankroll | `GET /agent/bankroll?model_name=` — DB (`models`) |
| 2 | Fetch leaderboard | `GET /agent/leaderboard?limit=3` — DB (`lifetime_leaderboard` + `agent_best_performances` views, already exist) |
| 3 | Fetch past performance | `GET /agent/past-performance?model_name=&event_id=&limit=3` — DB (`events_with_previous` + `model_event_results`, already exist) |
| 4 | Fetch markets | `GET /agent/markets?event_id=&expand_ticker=` — live Kalshi |
| 5 | Fetch history (price trend) | `GET /agent/history?event_id=&window_hours=24` — live Kalshi |
| 6 | Fetch forecast | `GET /agent/forecast?event_id=&window_hours=24` — live Kalshi |
| 7 | Search relevant links | existing fetch/browser tool, orchestrator-provided URLs (unchanged) |
| 8 | Search web | existing web-search tool, weighted 80% market data / 10% news / 10% forum (Reddit + X) — see amendment below |
| 9 | Generate final output | `POST /predictions/place` (extended to accept `pipeline_trace`) |

Plus one on-demand, non-linear step: `GET /agent/market-detail?ticker=` — full candlestick history, full forecast history, full rules text for one specific market, for when the agent is about to commit real capital and wants more than the default summary.

Two views already exist from a recent migration (`20260711110000_agent_best_performances.sql`, `20260711120000_top_3_and_previous_3.sql`) and do exactly the heavy lifting steps 2–3 need — the new endpoints wrap them rather than reimplementing the SQL:
- `agent_best_performances` — top-3 best events per model, with chronological prev-event context.
- `events_with_previous` — each event's `previous_event_id_1/2/3` by close_time.

### Step 1 — `GET /agent/bankroll?model_name=`

Returns three numbers, not one: `current_balance`, `previous_balance` (the model's `starting_balance` on its most recently played match, already stored in `model_event_results`), and `change` (the difference, computed server-side so the model doesn't do the subtraction itself). Still trivially small — no filtering/capping needed. Slight overlap with Step 3 (past performance) is intentional: Step 1 is a quick "am I up or down" number, Step 3 is the fuller multi-match retrospective with reasoning attached.

### Step 2 — `GET /agent/leaderboard?model_name=&limit=3`

Returns the top 3 models across the tournament's whole history (ranked by average performance across all their matches), each with its single best match ever (`agent_best_performances`, `performance_rank=1`) — match name, result, and a one-sentence `strategy_headline` of what worked.

Also returns `your_rank`: the requesting model's own current lifetime rank and average performance, even when it isn't in the top 3 — so a call to this one endpoint always gives the full "here's where the leaders are, and here's where I am" picture, not just the leaders.

Still small and bounded: exactly 3 leaderboard entries + 1 own-rank entry, regardless of how long the tournament runs.

### Step 3 — `GET /agent/past-performance?model_name=&event_id=&pool_limit=5&own_limit=3`

Three related but distinct signals, all returned from one call:
- `recent_pool_top`: pools each model's last-up-to-3 settled matches together (5 models → up to 15 individual match results), sorted best-to-worst by `percent_change`, capped to the top 5. This is *recent individual-match form* (short-term, can include multiple entries from one hot model), distinct from Step 2's *lifetime average* leaderboard.
- `recent_pool_bottom`: the same pooled set, capped to the worst 5 — so the model can see what's been going badly across the field, not just what's working.
- `own_recent`: the requesting model's own last-up-to-3 settled matches (via `events_with_previous`), always included regardless of whether they placed in either pool — so the model never loses sight of its own trajectory.

Each entry: `model_name`, `event_name`, `percent_change`, `strategy_headline`. Bounded regardless of how many models/matches accumulate (internally caps at 3-per-model before pooling; returns at most `pool_limit*2 + own_limit` entries, i.e. 13 by default).

Both Step 2 and Step 3 serve the short **`strategy_headline`** by default instead of the full `strategy_notes` — full notes stay in the DB for audit/drill-down, never permanently discarded.

### Step 4 — `GET /agent/markets?event_id=&expand_ticker=`

New file `backend/src/agent/agentMarketConfig.ts` defines a small allowlist of "core" market concepts per sport/series-family:
```ts
export const CORE_SERIES_SUFFIXES_BY_PREFIX: Record<string, string[]> = {
  KXWC: ["ADVANCE", "GAME", "SPREAD", "TOTAL"],
};
```
(Verified against real data: for Argentina vs Switzerland this yields exactly `ADVANCE`+`GAME`+`SPREAD`+`TOTAL` = 16 markets, cleanly separated from every prop-grid sibling. Needs a one-time check the first time a non-soccer series is ingested.)

`backend/src/agent/agentKalshi.ts` resolves siblings from `event_tickers` (DB), then live-fetches each sibling via the existing `getEventBundle()` (`backend/src/kalshi/kalshiEvents.ts`) in parallel — the same fan-out pattern `POST /kalshi/add-event?ingest_all_props=true` already does in `server.ts`. Response:
```json
{
  "core_markets": [ /* full list, always included */ ],
  "top_prop_markets": [ /* top props by volume, pooled across ALL non-core siblings */ ],
  "omitted": [ { "event_ticker": "...", "sibling_title": "Anytime Goalscorer", "omitted_count": 15, "total_volume": 812345 } ],
  "expanded": { /* full markets for one sibling, only if expand_ticker was passed */ }
}
```

**Amendment (confirmed):** never limit the AI's visible options below a floor of 50 total markets. Instead of a hard cap of 30 `top_prop_markets`, the prop cutoff is dynamic: keep adding props (highest volume first) until `core_markets.length + top_prop_markets.length >= 50`, i.e. `props_limit = max(30, 50 - core_markets.length)`. If a match has fewer than 50 markets total, return everything. Anything still left out beyond that floor is summarized in `omitted`, never silently dropped.

### Step 5 — `GET /agent/history?event_id=&window_hours=24`

Reuses the exact same core+top-props selection as step 4 (shared helper) so the deltas line up with the markets just shown. Per market: `price_now`, `delta_1h`, `delta_6h`, `delta_24h`, `direction_24h` — computed from the already-fetched `priceHistory` in the live bundle. No raw candlestick point arrays in the default response.

**Considered and rejected:** adding `delta_5m`/`delta_15m`/`delta_30m` short-window deltas. Verified live against Kalshi that `period_interval=1` (1-minute candles) is genuinely supported by their API, so it was technically feasible — but rejected because (a) this pipeline runs once per decision, not continuously, so a 5-minute-old momentum reading is stale before the agent ever acts on it again; (b) most of the ~50 markets are thin props where minute-level wiggles are single-trade noise, not signal; (c) it would mean ~1,440 data points per market fetched instead of ~24, a 60x cost increase for a one-shot decision. Staying at 1h/6h/24h keeps requests fast (~24 points/market) and avoids feeding noise to the agent.

### Step 6 — `GET /agent/forecast?event_id=&window_hours=24`

This is the fix for a bias risk found in real data: a naive "median moved from A to B" hid a real case in this DB where the median stayed flat while the 90th-percentile band swung between 6.00 and 10.99 across consecutive snapshots. Computed deterministically in code (not SQL, not LLM-narrated) from the live `getEventForecastPercentileHistory` response:
```json
{
  "latest": { "median": 2.5, "p10": 1.8, "p90": 3.9, "band_width": 2.1 },
  "window_delta_median": 0.0,
  "band_width_min_in_window": 1.4,
  "band_width_max_in_window": 4.99,
  "snapshot_count_in_window": 18
}
```
Because this reads live Kalshi timestamps, the known `event_forecast_snapshots.end_period_ts` corruption bug in the DB (rows showing 1970-01-21 instead of real 2026 dates) doesn't carry over into this endpoint — flagged as a separate pre-existing bug, not fixed as part of this plan.

### Step 7 — Search relevant links (unchanged)

Existing fetch/browser tool against orchestrator-provided URLs. No new endpoint. Renumbered into the pipeline purely so its finding gets logged in `pipeline_trace` alongside every other step.

### Step 8 — Search web (amended)

Existing web-search tool, unchanged mechanically, but the weighting rule is amended:

- **Previous rule:** 80% weight on market data, 20% on general web search (undifferentiated).
- **New rule (confirmed):** 80% market data / 10% news sources (formal reporting — injury reports, official announcements, match previews) / 10% forum & social commentary, specifically Reddit and X (Twitter).

Rationale: news and forum chatter are different kinds of signal — news is slower but more verified, forum/social is faster and messier but sometimes surfaces things (injury leaks, lineup rumors, in-stadium reports) before formal reporting catches up. Splitting them into distinct sub-steps means the agent is explicitly told to check both rather than treating "the internet" as one undifferentiated bucket, and both get their own line in the `pipeline_trace`.

Implementation note: the agent is instructed to run targeted site-scoped searches (e.g. `site:reddit.com`, `site:x.com`) for the forum/social slice rather than relying on general search results to surface them incidentally. Flagged caveat: X/Twitter content is less consistently indexed by general web search than Reddit (much of it requires being logged into X to view), so that half of the 10% should be treated as best-effort — Reddit is the more reliable of the two.

### Step 9 — `POST /predictions/place` (extended, includes a correctness fix)

**Bug found during planning review:** `placeModelPredictions` (`backend/src/predictions/predictionsPlace.ts`) currently derives `entry_price` by reading `markets.yes_price` from the database — and that column is never updated after ingestion (confirmed by grepping `kalshiSettle.ts`: no write ever touches it post-insert). This directly violates this plan's own ground rule that price data must always be live — steps 4–6 show the agent fresh Kalshi prices, but the price actually recorded against its bet could be hours or days stale from whenever the event was first ingested. The same code path also never checks a market's `status` before accepting a bet, so a model could in theory bet against an already-closed market as long as a stale price row still exists for it.

**Fix, part of this plan:** `ModelPredictionPayload`/`PredictionInput` gains a required `observed_price` field per prediction — the live price the agent actually saw for that market during Steps 4–6, which it must echo back at submission time. `placeModelPredictions` is extended to:
1. Live-fetch each predicted market's current price and status from Kalshi at submission time (not from the DB `markets` table).
2. Reject the prediction (added to the existing `details` validation array, same all-or-nothing behavior) if the market's live `status` is not open/tradable.
3. Use the live-fetched price as `entry_price`, and flag (not necessarily reject) predictions where `observed_price` diverges significantly from the live price at submission — signals that meaningful time passed between research and execution.

Also extended to accept `pipeline_trace` — see migration section below.

---

## Database migration

New file `supabase/migrations/20260711130000_agent_pipeline.sql`, following this project's existing convention (comment on every table/column, `references ... on delete cascade`, no explicit RLS statements — matches all prior migrations):

- `alter table model_event_strategies add column strategy_headline text` — nullable, 1-sentence thesis the model writes itself alongside the existing full `strategy_notes`. Null for any row written before this migration; endpoints must handle that gracefully, not treat it as an error.
- New table `model_event_pipeline_steps` (`model_name`, `event_id`, `step_order`, `step_name`, `summary`, `created_at`) with FKs to `models`/`events` (`on delete cascade`), unique on `(model_name, event_id, step_order)` — one row per step per model per event, in run order. This is the traceability record — queryable directly via SQL/Supabase, no UI attached.

`placeModelPredictions` (`backend/src/predictions/predictionsPlace.ts`) gets a new optional field on `ModelPredictionPayload`: `pipeline_trace?: Array<{ step_name: string; summary: string }>`, validated the same way existing fields are (added to the existing all-or-nothing `details` array), inserted as a third write after the existing predictions-insert and strategies-upsert (still no cross-table transaction, matching the file's existing pattern).

---

## System prompt rewrite (`backend/prediction-market-agent-system-prompt.md`)

- **Tools section**: drop "Supabase MCP Connection" entirely — replace with "Backend HTTP API (fetch tool)" against `/agent/*` and `/predictions/place`. All context (ledger and market data alike) now goes through our own endpoints, so we fully control what SQL runs and can tune/version it without touching the prompt.
- **Anti-bias file-isolation section**: update the one sentence naming Supabase MCP as the data source to name the new endpoints instead; the actual isolation rules (don't read source/CLAUDE.md/migrations) are unchanged.
- **Execution Workflow**: replace the current raw-SQL blocks with the 9 numbered steps above, each naming its exact endpoint call, including the amended Step 4 (50-market floor) and Step 8 (80/10/10 split) wording.
- **Output schema**: add required `strategy_headline` (1 sentence) alongside `strategy_notes`, and required `pipeline_trace` (one `{step_name, summary}` per step 1–8).
- **Not touched**: the 50%/25% staking rules, fee-adjusted EV formulas — explicitly out of scope.

Known pre-existing issue, not fixed here: `backend/src/docs/openapi.ts` documents a different (`models[]`-grouped) request shape for `/predictions/place` than what `placeModelPredictions` actually accepts (single model per call, keyed by `event_id`). The rewritten prompt must match the *real* code shape; the docs drift is a separate cleanup.

---

## Sequencing

1. **Migration** — apply first (`strategy_headline` column + `model_event_pipeline_steps` table). Verify independently via Supabase (insert a dummy row, confirm cascade-delete).
2. **`/agent/*` endpoints** — `markets` → `history` (reuses markets' selection) → `forecast` (independent) → `market-detail` (independent) can be built in one pass; `bankroll`/`leaderboard`/`past-performance` are a fully independent pass over the small ledger tables. Add each to `backend/src/docs/openapi.ts` and the CLAUDE.md Routes list in the same change (existing project convention). Test against the real ingested Argentina vs Switzerland event.
3. **`placeModelPredictions` extension** — depends on the migration; includes the live-price/status fix (Step 9) and `pipeline_trace` support; testable with a raw POST before touching the prompt.
4. **System prompt rewrite** — depends on 2–3 existing and being manually verified against their real JSON responses (this file isn't covered by any compiler/test, so it needs a human read-through against live endpoint output before it's trusted).

## Verification

- Migration: apply via Supabase, run a manual insert/cascade-delete check.
- Each new `/agent/*` endpoint: hit it directly (`curl`/browser) against the already-ingested Argentina vs Switzerland event (`event_id` visible via `GET /events`) and confirm the core/top-props/omitted split (with the 50-market floor), the price deltas, and the forecast band-width fields look sane against the raw Kalshi data already spot-checked in planning.
- `placeModelPredictions`: POST a payload including `pipeline_trace` and confirm rows land in `model_event_pipeline_steps` in the right order and cascade-delete correctly when the event is deleted. Separately confirm the live-price fix: POST a prediction with a deliberately stale/wrong `observed_price` against a market whose DB `yes_price` differs from its current live Kalshi price, and confirm the inserted `entry_price` matches the *live* price, not the DB snapshot; also confirm a bet against a closed/non-tradable market is rejected.
- System prompt: manually run it once against a real event with the new endpoints live, confirm the output JSON validates against the extended schema (`strategy_headline` + `pipeline_trace` present, Step 8 shows separate news/forum sub-findings, each prediction includes `observed_price`).

### Deferred, not addressed in this plan
Raised during the gap-analysis review, deliberately left out for now:
- No step gives the agent an explicit live game score / match clock for in-play sports — Kalshi's data has no structured score field, so this only reaches the agent indirectly via Step 7/8 web search.
- `models.current_balance` only updates at settlement, so if a model ever had two matches in flight concurrently, Step 1's bankroll figure wouldn't reflect capital already at risk elsewhere. Likely moot given matches run one-at-a-time per model; not verified further here.

### Critical files
- `backend/src/kalshi/kalshiEvents.ts` (reused: `getEventBundle`, `getEventCandlesticks`, `getEventForecastPercentileHistory`)
- `backend/src/predictions/predictionsPlace.ts` (extend `ModelPredictionPayload`/`placeModelPredictions`: `pipeline_trace`, `observed_price`, live price/status fetch replacing the stale DB read)
- `backend/src/server.ts` (new `/agent/*` routes)
- `backend/src/agent/agentMarketConfig.ts` (new)
- `backend/src/agent/agentKalshi.ts` (new)
- `backend/prediction-market-agent-system-prompt.md` (rewrite)
- `supabase/migrations/20260711120000_top_3_and_previous_3.sql` (existing views being wrapped, not modified)
- `supabase/migrations/20260711130000_agent_pipeline.sql` (new)
- `backend/src/docs/openapi.ts` + `CLAUDE.md` (route docs, same-change convention)
