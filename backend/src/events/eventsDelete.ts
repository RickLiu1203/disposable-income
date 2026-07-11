import { getSupabaseClient } from "../supabase/supabaseClient";

export interface DeleteEventResult {
  event_id: string;
  event_deleted: boolean;
}

export async function deleteEvent(eventIdOrTicker: string): Promise<DeleteEventResult> {
  const supabase = getSupabaseClient();

  let eventId = eventIdOrTicker;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventIdOrTicker);
  if (!isUuid) {
    const { data: tickerInfo, error: tickerError } = await supabase
      .from("event_tickers")
      .select("event_id")
      .eq("event_ticker", eventIdOrTicker)
      .maybeSingle();

    if (tickerError) {
      throw new Error(`Failed to resolve ticker: ${tickerError.message}`);
    }
    if (tickerInfo) {
      eventId = tickerInfo.event_id;
    } else {
      throw new Error(`Event or ticker not found: ${eventIdOrTicker}`);
    }
  }

  const { error, count } = await supabase
    .from("events")
    .delete({ count: "exact" })
    .eq("id", eventId);

  if (error) {
    throw new Error(`Failed to delete event ${eventId}: ${error.message}`);
  }

  return {
    event_id: eventId,
    event_deleted: (count ?? 0) > 0,
  };
}
