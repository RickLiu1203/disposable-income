import type { LineChartSeries } from "../design-system"
import { getModelIcon } from "./modelIcons"
import type { ValueHistorySeries } from "../types/events"

// Compact, locale-independent tick format ("11:35am") -- toLocaleTimeString
// varies by locale (e.g. "11:35 a.m.") and is too wide once several ticks
// share the x-axis.
export function formatTickTime(iso: string): string {
  const d = new Date(iso)
  const hours24 = d.getHours()
  const minutes = d.getMinutes().toString().padStart(2, "0")
  const suffix = hours24 >= 12 ? "pm" : "am"
  const hours = hours24 % 12 || 12
  return `${hours}:${minutes}${suffix}`
}

export function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

// The poller skips writing a snapshot for a model whose value hasn't moved,
// so different models' point arrays can have different lengths/timestamps.
// Forward-fill every model across the union of all observed timestamps so
// LineChart (which indexes series by position, not by matching timestamps)
// gets equal-length arrays.
//
// The poller only ever writes a snapshot for an event once it's actually
// started (match_start_time <= now -- see findActiveEventIds in
// valuePoller.ts), so in practice every point already lands at/after
// matchStartIso. Points are still filtered against it here defensively,
// and a synthetic point pinned to matchStartIso (at each model's starting
// balance) is always prepended so the axis begins at the match's real
// kickoff rather than whatever moment the first poll happened to land on.
// matchStartIso should be event.match_start_time (falling back to
// event.open_time for pre-migration rows) -- NOT open_time alone, which is
// when Kalshi opened the market for trading and is routinely days earlier
// than the real match.
export function buildValueChart(
  series: ValueHistorySeries[],
  modelRoster: string[],
  startingBalances: Record<string, number>,
  matchStartIso: string | null,
): { xLabels: string[]; series: LineChartSeries[] } {
  const matchStartMs = matchStartIso ? new Date(matchStartIso).getTime() : null

  const filteredSeries = series.map((s) => ({
    model_name: s.model_name,
    points:
      matchStartMs == null ? s.points : s.points.filter((p) => new Date(p.snapshot_ts).getTime() >= matchStartMs),
  }))

  const timestampSet = new Set<string>()
  filteredSeries.forEach((s) => s.points.forEach((p) => timestampSet.add(p.snapshot_ts)))
  const timestamps = Array.from(timestampSet).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  if (timestamps.length === 0 && matchStartMs == null) return { xLabels: [], series: [] }

  const byModel = new Map(filteredSeries.map((s) => [s.model_name, s.points]))
  const chartSeries: LineChartSeries[] = modelRoster.map((m) => {
    const points = byModel.get(m) ?? []
    let idx = 0
    let lastValue = startingBalances[m] ?? 10
    const values = timestamps.map((ts) => {
      const tsMs = new Date(ts).getTime()
      while (idx < points.length && new Date(points[idx].snapshot_ts).getTime() <= tsMs) {
        lastValue = points[idx].unrealized_balance
        idx++
      }
      return lastValue
    })
    const { icon, badge } = getModelIcon(m)
    return { key: m, name: m, badge, badgeIcon: icon, values: matchStartMs == null ? values : [startingBalances[m] ?? 10, ...values] }
  })

  return {
    xLabels:
      matchStartMs == null
        ? timestamps.map(formatTickTime)
        : [formatTickTime(matchStartIso!), ...timestamps.map(formatTickTime)],
    series: chartSeries,
  }
}
