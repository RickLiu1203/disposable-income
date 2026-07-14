import { getSupabaseClient } from "../supabase/supabaseClient";

// ---------------------------------------------------------------------------
// A model's starting bankroll for one event -- the "pot" it brought into
// that specific match, which is what any per-event chart or balance display
// should baseline against, NOT a hardcoded $10. Balances carry forward
// continuously across events (see CLAUDE.md "Settlement approach"), so a
// model's Nth match starts at whatever it ended the previous one with, not
// a fresh $10 reset -- $10 is only actually correct for a model's very
// first-ever match.
//
// Shared by valuePoller.ts (needs this to compute live mark-to-market
// balances) and eventsRead.ts (needs this to expose the real per-event
// baseline to the frontend) so the fallback logic can't drift between them.
// ---------------------------------------------------------------------------

/** Each model's starting bankroll for a specific event. Prefers
 * model_event_results.starting_balance (seeded once the model's first
 * prediction in this event settles); before that, falls back to the
 * model's current live overall balance (models.current_balance), which is
 * what actually carried into this event as its budget. */
export async function getEventStartingBalances(
  eventId: string,
  modelNames: string[]
): Promise<Record<string, number>> {
  const supabase = getSupabaseClient();
  const balances: Record<string, number> = {};
  if (modelNames.length === 0) return balances;

  const { data: seeded, error: seededError } = await supabase
    .from("model_event_results")
    .select("model_name, starting_balance")
    .eq("event_id", eventId)
    .in("model_name", modelNames);
  if (seededError) {
    throw new Error(`Failed to load starting balances for event ${eventId}: ${seededError.message}`);
  }
  for (const row of seeded ?? []) {
    balances[row.model_name as string] = Number(row.starting_balance);
  }

  const missing = modelNames.filter((m) => !(m in balances));
  if (missing.length > 0) {
    const { data: models, error: modelsError } = await supabase
      .from("models")
      .select("model_name, current_balance")
      .in("model_name", missing);
    if (modelsError) {
      throw new Error(`Failed to load fallback balances: ${modelsError.message}`);
    }
    for (const row of models ?? []) {
      balances[row.model_name as string] = Number(row.current_balance);
    }
  }

  return balances;
}
