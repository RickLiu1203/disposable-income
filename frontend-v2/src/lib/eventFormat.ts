import type { LiveEventStatus, PredictionRow } from "../types/events"

export function outcomeChipVariant(outcome: PredictionRow["outcome"]): "success" | "error" | "secondary" | "neutral" {
  if (outcome === "win") return "success"
  if (outcome === "loss") return "error"
  if (outcome === "void") return "secondary"
  return "neutral"
}

export function statusChipVariant(status: LiveEventStatus): "neutral" | "success" | "secondary" {
  if (status === "in_progress") return "success"
  if (status === "completed") return "secondary"
  return "neutral"
}

export function statusLabel(status: LiveEventStatus): string {
  if (status === "in_progress") return "In progress"
  if (status === "completed") return "Completed"
  return "Open"
}

/** Match kickoff for header display -- match_start_time (falling back to
 * open_time for pre-migration rows), never open_time alone. See the "Match
 * start vs. market open" note in the root CLAUDE.md: open_time is only when
 * Kalshi opened the market for trading, which is routinely days before the
 * real match. */
export function formatMatchDate(matchStartTime: string | null, openTime: string | null): string | null {
  const iso = matchStartTime ?? openTime
  if (!iso) return null
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** Renders an ISO timestamp as a `<input type="datetime-local">` value in
 * the browser's local time zone, so editing a match start time reads as the
 * same wall-clock time formatMatchDate above shows -- not UTC. */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
