import { getSupabaseClient } from "../supabase/supabaseClient";

export interface UpdateMatchStartTimeResult {
  event_id: string;
  match_start_time: string;
}

/** Corrects events.match_start_time after ingestion -- Kalshi's per-market
 * occurrence_datetime (what this column is sourced from at ingest time, see
 * toCompactBundle() in kalshiEvents.ts) is occasionally wrong or shifts
 * after a schedule change, and this is the one signal the value poller's
 * gating query (findActiveEventIds() in valuePoller.ts) and computeEventStatus
 * both trust for "has this event actually started" -- so a wrong value here
 * doesn't just mis-render a date, it can delay live polling/settlement
 * until open_time (routinely days later) or hold it back if set too far in
 * the future. */
export async function updateMatchStartTime(
  eventId: string,
  matchStartTime: string,
): Promise<UpdateMatchStartTimeResult> {
  const supabase = getSupabaseClient();

  const parsed = new Date(matchStartTime);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid match_start_time: '${matchStartTime}'`);
  }

  const { data, error } = await supabase
    .from("events")
    .update({ match_start_time: parsed.toISOString() })
    .eq("id", eventId)
    .select("id, match_start_time")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update match_start_time for event ${eventId}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`Event not found: ${eventId}`);
  }

  return { event_id: data.id as string, match_start_time: data.match_start_time as string };
}
