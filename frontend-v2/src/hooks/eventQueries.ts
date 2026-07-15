import { useQuery } from "@tanstack/react-query"
import { getValueHistory } from "../services/agentService"
import { getBalanceHistory, getEventDetail, getEvents, getLifetimeLeaderboard, getMarketSnapshot } from "../services/eventsService"

export function useEventDetailQuery(eventId: string | undefined) {
  return useQuery({
    queryKey: ["eventDetail", eventId],
    queryFn: () => getEventDetail(eventId!),
    enabled: !!eventId,
  })
}

export function useMarketSnapshotQuery(eventId: string | undefined) {
  return useQuery({
    queryKey: ["marketSnapshot", eventId],
    queryFn: () => getMarketSnapshot(eventId!),
    enabled: !!eventId,
  })
}

export function useLifetimeRosterQuery() {
  return useQuery({
    queryKey: ["lifetimeLeaderboard"],
    queryFn: getLifetimeLeaderboard,
  })
}

export function useEventsQuery() {
  return useQuery({
    queryKey: ["events"],
    queryFn: getEvents,
  })
}

/** One lightweight query backing the MainScreen leaderboard chart -- see
 * getBalanceHistory()'s doc comment for why this replaced N per-event
 * GET /events/detail fetches. Cached like every other query here, so
 * navigating away from MainScreen and back doesn't refetch until stale. */
export function useBalanceHistoryQuery() {
  return useQuery({
    queryKey: ["balanceHistory"],
    queryFn: getBalanceHistory,
  })
}

/** Only fetches once the event has moved past "open" (mirrors the value
 * poller itself, which never writes a snapshot before match_start_time),
 * and polls every 60s while the match is actually in progress. */
export function useValueHistoryQuery(eventId: string | undefined, liveStatus: string | undefined) {
  const shouldFetch = !!eventId && !!liveStatus && liveStatus !== "open"
  return useQuery({
    queryKey: ["valueHistory", eventId],
    queryFn: () => getValueHistory(eventId!),
    enabled: shouldFetch,
    refetchInterval: shouldFetch && liveStatus === "in_progress" ? 60_000 : false,
  })
}
