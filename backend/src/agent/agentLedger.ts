import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../supabase/supabaseClient";

// ---------------------------------------------------------------------------
// Steps 1-3 of the agent pipeline: bankroll, leaderboard, past performance.
// Unlike agentKalshi.ts, this module never calls the Kalshi API -- tournament
// ledger data (bankroll, leaderboard, past results) is small and it *is* the
// source of truth for what must persist across matches, so it's read
// straight from the DB per the plan's ground rules.
// ---------------------------------------------------------------------------

function sortKeyOf(row: { close_time: string | null; created_at: string } | null): string {
  return row?.close_time ?? row?.created_at ?? "";
}

async function fetchStrategyHeadlines(
  supabase: SupabaseClient,
  pairs: Array<{ model_name: string; event_id: string }>
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (pairs.length === 0) return map;

  const eventIds = Array.from(new Set(pairs.map((p) => p.event_id)));
  const { data, error } = await supabase
    .from("model_event_strategies")
    .select("model_name, event_id, strategy_headline")
    .in("event_id", eventIds);
  if (error) {
    throw new Error(`Failed to load strategy headlines: ${error.message}`);
  }
  for (const row of (data ?? []) as { model_name: string; event_id: string; strategy_headline: string | null }[]) {
    map.set(`${row.model_name}:${row.event_id}`, row.strategy_headline);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Step 1 -- GET /agent/bankroll?model_name=
// ---------------------------------------------------------------------------

export interface BankrollInfo {
  model_name: string;
  current_balance: number;
  previous_balance: number | null;
  change: number | null;
}

export async function getBankroll(modelName: string): Promise<BankrollInfo> {
  const supabase = getSupabaseClient();

  const { data: model, error: modelError } = await supabase
    .from("models")
    .select("current_balance")
    .eq("model_name", modelName)
    .maybeSingle();
  if (modelError) {
    throw new Error(`Failed to load bankroll for ${modelName}: ${modelError.message}`);
  }
  if (!model) {
    throw new Error(`Unknown model: ${modelName}`);
  }

  const { data: history, error: historyError } = await supabase
    .from("model_event_results")
    .select("starting_balance, event_id, events(close_time, created_at)")
    .eq("model_name", modelName);
  if (historyError) {
    throw new Error(`Failed to load match history for ${modelName}: ${historyError.message}`);
  }

  type HistoryRow = {
    starting_balance: number;
    event_id: string;
    events: { close_time: string | null; created_at: string } | null;
  };
  const rows = (history ?? []) as unknown as HistoryRow[];
  rows.sort((a, b) => sortKeyOf(b.events).localeCompare(sortKeyOf(a.events)));

  const mostRecent = rows[0];
  const currentBalance = Number(model.current_balance);
  const previousBalance = mostRecent ? Number(mostRecent.starting_balance) : null;

  return {
    model_name: modelName,
    current_balance: currentBalance,
    previous_balance: previousBalance,
    change: previousBalance !== null ? Number((currentBalance - previousBalance).toFixed(4)) : null,
  };
}

// ---------------------------------------------------------------------------
// Step 2 -- GET /agent/leaderboard?model_name=&limit=3
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  model_name: string;
  lifetime_rank: number;
  avg_percent_change: number;
  best_match: {
    event_id: string;
    event_name: string;
    percent_change: number;
    strategy_headline: string | null;
  } | null;
}

export interface LeaderboardResult {
  top: LeaderboardEntry[];
  your_rank: LeaderboardEntry | null;
}

export async function getLeaderboard(modelName: string | undefined, limit: number): Promise<LeaderboardResult> {
  const supabase = getSupabaseClient();

  const { data: lifetimeRows, error: lifetimeError } = await supabase
    .from("lifetime_leaderboard")
    .select("model_name, lifetime_rank, avg_percent_change")
    .order("lifetime_rank", { ascending: true });
  if (lifetimeError) {
    throw new Error(`Failed to load lifetime leaderboard: ${lifetimeError.message}`);
  }

  const rows = (lifetimeRows ?? []) as { model_name: string; lifetime_rank: number; avg_percent_change: number }[];
  const topRows = rows.slice(0, limit);
  const ownRow = modelName ? rows.find((r) => r.model_name === modelName) ?? null : null;

  const relevantModelNames = Array.from(
    new Set([...topRows.map((r) => r.model_name), ...(ownRow ? [ownRow.model_name] : [])])
  );

  let bestByModel = new Map<string, { model_name: string; event_id: string; event_name: string; percent_change: number }>();
  if (relevantModelNames.length > 0) {
    const { data: bestRows, error: bestError } = await supabase
      .from("agent_best_performances")
      .select("model_name, event_id, event_name, percent_change, performance_rank")
      .in("model_name", relevantModelNames)
      .eq("performance_rank", 1);
    if (bestError) {
      throw new Error(`Failed to load best performances: ${bestError.message}`);
    }
    bestByModel = new Map(
      (
        (bestRows ?? []) as { model_name: string; event_id: string; event_name: string; percent_change: number }[]
      ).map((r) => [r.model_name, r])
    );
  }

  const headlines = await fetchStrategyHeadlines(
    supabase,
    [...bestByModel.values()].map((r) => ({ model_name: r.model_name, event_id: r.event_id }))
  );

  const buildEntry = (row: { model_name: string; lifetime_rank: number; avg_percent_change: number }): LeaderboardEntry => {
    const best = bestByModel.get(row.model_name);
    return {
      model_name: row.model_name,
      lifetime_rank: Number(row.lifetime_rank),
      avg_percent_change: Number(row.avg_percent_change),
      best_match: best
        ? {
            event_id: best.event_id,
            event_name: best.event_name,
            percent_change: Number(best.percent_change),
            strategy_headline: headlines.get(`${best.model_name}:${best.event_id}`) ?? null,
          }
        : null,
    };
  };

  return {
    top: topRows.map(buildEntry),
    your_rank: ownRow ? buildEntry(ownRow) : null,
  };
}

// ---------------------------------------------------------------------------
// Step 3 -- GET /agent/past-performance?model_name=&event_id=&pool_limit=5&own_limit=3
// ---------------------------------------------------------------------------

export interface PastPerformanceEntry {
  model_name: string;
  event_id: string;
  event_name: string;
  percent_change: number;
  strategy_headline: string | null;
}

export interface PastPerformanceResult {
  recent_pool_top: PastPerformanceEntry[];
  recent_pool_bottom: PastPerformanceEntry[];
  own_recent: PastPerformanceEntry[];
}

// Internally caps at 3-per-model before pooling, regardless of pool_limit --
// this bounds recent_pool_top/bottom to short-term individual-match form
// rather than letting one long-settled model dominate the pool.
const PER_MODEL_POOL_CAP = 3;

export async function getPastPerformance(
  modelName: string,
  currentEventId: string | undefined,
  poolLimit = 5,
  ownLimit = 3
): Promise<PastPerformanceResult> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("model_event_results")
    .select("model_name, event_id, percent_change, events(event_name, close_time, created_at)")
    .not("ending_balance", "is", null);
  if (error) {
    throw new Error(`Failed to load settled match history: ${error.message}`);
  }

  type Row = {
    model_name: string;
    event_id: string;
    percent_change: number;
    events: { event_name: string; close_time: string | null; created_at: string } | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.event_id !== currentEventId);

  const byModel = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byModel.get(row.model_name) ?? [];
    list.push(row);
    byModel.set(row.model_name, list);
  }
  for (const list of byModel.values()) {
    list.sort((a, b) => sortKeyOf(b.events).localeCompare(sortKeyOf(a.events)));
  }

  const pooled = [...byModel.values()].flatMap((list) => list.slice(0, PER_MODEL_POOL_CAP));
  const ownRows = (byModel.get(modelName) ?? []).slice(0, ownLimit);

  const headlines = await fetchStrategyHeadlines(
    supabase,
    [...pooled, ...ownRows].map((r) => ({ model_name: r.model_name, event_id: r.event_id }))
  );

  const toEntry = (row: Row): PastPerformanceEntry => ({
    model_name: row.model_name,
    event_id: row.event_id,
    event_name: row.events?.event_name ?? "Unknown event",
    percent_change: Number(row.percent_change),
    strategy_headline: headlines.get(`${row.model_name}:${row.event_id}`) ?? null,
  });

  const sortedDesc = [...pooled].sort((a, b) => Number(b.percent_change) - Number(a.percent_change));
  const sortedAsc = [...pooled].sort((a, b) => Number(a.percent_change) - Number(b.percent_change));

  return {
    recent_pool_top: sortedDesc.slice(0, poolLimit).map(toEntry),
    recent_pool_bottom: sortedAsc.slice(0, poolLimit).map(toEntry),
    own_recent: ownRows.map(toEntry),
  };
}
