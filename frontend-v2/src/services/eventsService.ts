import { apiRequest } from "./api"
import type { EventDetail, LifetimeRosterRow, MarketSnapshotRow } from "../types/events"

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
