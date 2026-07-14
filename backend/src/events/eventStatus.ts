// ---------------------------------------------------------------------------
// events.status is written once at ingestion (see deriveEventStatus() in
// kalshiIngest.ts) and never updated again -- not even at settlement -- so
// it's stale the moment any prediction actually resolves. This is the real,
// freshly-computed replacement, derived the same way every time from data
// that's always current: the match's real start time plus whether any
// prediction is still pending. No DB access here on purpose, so it's
// trivially reusable from both a bulk list read and a single detail read
// without duplicating logic.
// ---------------------------------------------------------------------------

export type LiveEventStatus = "open" | "in_progress" | "completed";

export function computeEventStatus(params: {
  // The real-world match start (events.match_start_time), NOT open_time --
  // open_time is when Kalshi opened the market for trading, which routinely
  // happens days before the actual match. Callers should pass
  // match_start_time ?? open_time so pre-migration rows without
  // match_start_time still fall back to the old (approximate) behavior.
  matchStartTime: string | null;
  totalPredictions: number;
  pendingPredictions: number;
  now?: Date;
}): LiveEventStatus {
  const { matchStartTime, totalPredictions, pendingPredictions } = params;
  const now = params.now ?? new Date();

  // Mirrors settleEvent's own "nothing left pending" drop-out condition.
  if (totalPredictions > 0 && pendingPredictions === 0) {
    return "completed";
  }

  // Mirrors valuePoller.ts's findActiveEventIds() gating exactly: a pending
  // bet exists AND the match has actually started. An event that started
  // but never got a single bet stays "open" indefinitely -- there's nothing
  // live to track, same as the poller never activating for it.
  if (pendingPredictions > 0 && matchStartTime !== null && new Date(matchStartTime) <= now) {
    return "in_progress";
  }

  return "open";
}
