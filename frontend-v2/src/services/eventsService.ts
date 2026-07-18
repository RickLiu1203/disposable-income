import { apiRequest } from "./api"
import type { BalanceHistoryRow, EventDetail, EventListRow, LifetimeRosterRow, MarketSnapshotRow } from "../types/events"

export async function getEventDetail(eventId: string): Promise<EventDetail> {
  const res = await apiRequest<{ data: EventDetail }>(`/api/events/detail?event_id=${eventId}`)
  return res.data
}

export async function getMarketSnapshot(eventId: string): Promise<MarketSnapshotRow[]> {
  const res = await apiRequest<{ data: { markets: MarketSnapshotRow[] } }>(
    `/api/events/market-snapshot?event_id=${eventId}`,
  )
  return res.data.markets
}

export async function getLifetimeLeaderboard(): Promise<LifetimeRosterRow[]> {
  const res = await apiRequest<{ data: LifetimeRosterRow[] }>("/api/events/lifetime-leaderboard")
  return res.data
}

export async function getEvents(): Promise<EventListRow[]> {
  const res = await apiRequest<{ events: EventListRow[] }>("/api/events")
  return res.events
}

/** Flat {event_id, model_name, ending_balance} across every settled match --
 * see GET /events/balance-history's doc comment for why this replaced N
 * per-event GET /events/detail calls in the MainScreen leaderboard chart. */
export async function getBalanceHistory(): Promise<BalanceHistoryRow[]> {
  const res = await apiRequest<{ data: BalanceHistoryRow[] }>("/api/events/balance-history")
  return res.data
}

export async function addEvent(url: string): Promise<void> {
  await apiRequest(`/api/kalshi/add-event?url=${encodeURIComponent(url)}&ingest_all_props=true`, { method: "POST" })
}

/** Corrects match_start_time after ingestion -- this is the one field the
 * value poller and computeEventStatus trust for "has this event actually
 * started" (see CLAUDE.md's "Match start vs. market open" note), so fixing
 * a wrong value here is what actually makes live polling/settlement kick in,
 * not just a cosmetic date fix. */
export async function updateMatchStartTime(eventId: string, matchStartTimeIso: string): Promise<void> {
  await apiRequest(`/api/events/match-start-time?event_id=${eventId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match_start_time: matchStartTimeIso }),
  })
}
