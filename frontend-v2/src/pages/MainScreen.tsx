import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Button,
  Card,
  Chip,
  Input,
  LineChart,
  ListRow,
  LlmLogo,
  Skeleton,
} from "../design-system"
import type { LineChartSeries } from "../design-system"
import { PanelLayout } from "../layouts/PanelLayout"
import { getModelIcon } from "../lib/modelIcons"

type LiveEventStatus = "open" | "in_progress" | "completed"

interface EventListItem {
  id: string
  event_name: string
  sub_title: string | null
  competition: string | null
  competition_scope: string | null
  live_status: LiveEventStatus
  market_count: number
  open_time: string | null
  match_start_time: string | null
  created_at: string
}

interface EventLeaderboardRow {
  model_name: string
  ending_balance: number | null
}

interface LifetimeLeaderboardRow {
  model_name: string
  events_participated: number
  avg_percent_change: number
  total_pnl: number
  total_rewards_earned: number
  lifetime_rank: number
}

function statusChipVariant(status: LiveEventStatus): "neutral" | "primary" | "secondary" {
  if (status === "in_progress") return "primary"
  if (status === "completed") return "secondary"
  return "neutral"
}

function statusLabel(status: LiveEventStatus): string {
  if (status === "in_progress") return "In progress"
  if (status === "completed") return "Completed"
  return "Open"
}

function truncateLabel(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

// Fixed varying heights so the loading chart reads as a plausible trend
// silhouette rather than a uniform block.
const CHART_SKELETON_BAR_HEIGHTS = [45, 68, 55, 82, 60, 40, 74, 52, 66, 78]

function MainScreen() {
  const navigate = useNavigate()

  const [events, setEvents] = useState<EventListItem[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)

  const [urlInput, setUrlInput] = useState("")
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [lifetimeLeaderboard, setLifetimeLeaderboard] = useState<LifetimeLeaderboardRow[]>([])
  const [loadingLifetime, setLoadingLifetime] = useState(false)
  const [lifetimeError, setLifetimeError] = useState<string | null>(null)

  const [chartXLabels, setChartXLabels] = useState<string[]>([])
  const [chartSeries, setChartSeries] = useState<LineChartSeries[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const fetchEvents = async () => {
    setLoadingEvents(true)
    setEventsError(null)
    try {
      const res = await fetch("/api/events")
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`)
      }
      setEvents(data.events)
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoadingEvents(false)
    }
  }

  const fetchLifetimeLeaderboard = async () => {
    setLoadingLifetime(true)
    setLifetimeError(null)
    try {
      const res = await fetch("/api/events/lifetime-leaderboard")
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`)
      }
      setLifetimeLeaderboard(data.data)
    } catch (err) {
      setLifetimeError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoadingLifetime(false)
    }
  }

  useEffect(() => {
    fetchEvents()
    fetchLifetimeLeaderboard()
  }, [])

  // Builds the per-event balance history chart once both the event list
  // and the model roster (from the lifetime leaderboard) are available.
  useEffect(() => {
    if (events.length < 2 || lifetimeLeaderboard.length === 0) {
      setChartXLabels([])
      setChartSeries([])
      return
    }

    const ordered = [...events].sort((a, b) => {
      // match_start_time (the real match kickoff) orders these more
      // accurately than open_time, which is when the Kalshi market opened
      // for trading and can be days ahead of the actual match.
      const at = new Date(a.match_start_time ?? a.open_time ?? a.created_at).getTime()
      const bt = new Date(b.match_start_time ?? b.open_time ?? b.created_at).getTime()
      return at - bt
    })
    const modelNames = lifetimeLeaderboard.map((row) => row.model_name)

    let cancelled = false
    const fetchHistory = async () => {
      setLoadingHistory(true)
      setHistoryError(null)
      try {
        const details = await Promise.all(
          ordered.map((e) =>
            fetch(`/api/events/detail?event_id=${e.id}`).then((r) => r.json()),
          ),
        )
        if (cancelled) return

        const balances: Record<string, number> = {}
        const values: Record<string, number[]> = {}
        modelNames.forEach((m) => {
          balances[m] = 10
          values[m] = []
        })

        details.forEach((d) => {
          const rows: EventLeaderboardRow[] = d.ok ? d.data.leaderboard : []
          modelNames.forEach((m) => {
            const row = rows.find((r) => r.model_name === m)
            if (row && row.ending_balance !== null) {
              balances[m] = row.ending_balance
            }
            values[m].push(balances[m])
          })
        })

        setChartXLabels(ordered.map((e) => truncateLabel(e.event_name)))
        setChartSeries(
          modelNames.map((m) => {
            const { icon, badge } = getModelIcon(m)
            return { key: m, name: m, badge, badgeIcon: icon, values: values[m] }
          }),
        )
      } catch (err) {
        if (!cancelled) {
          setHistoryError(err instanceof Error ? err.message : "Unknown error")
        }
      } finally {
        if (!cancelled) setLoadingHistory(false)
      }
    }

    fetchHistory()
    return () => {
      cancelled = true
    }
  }, [events, lifetimeLeaderboard])

  const handleAddEvent = async () => {
    if (!urlInput.trim()) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch(
        `/api/kalshi/add-event?url=${encodeURIComponent(urlInput.trim())}&ingest_all_props=true`,
        { method: "POST" },
      )
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to add event")
      }
      setUrlInput("")
      await fetchEvents()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add event")
    } finally {
      setAdding(false)
    }
  }

  const right = (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-500">
          Add event
        </h2>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Kalshi URL
        </label>
        <Input
          type="text"
          placeholder="https://kalshi.com/markets/..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={adding}
        />
        <Button
          variant="primary"
          className="mt-3 w-full justify-center"
          onClick={handleAddEvent}
          disabled={adding || !urlInput.trim()}
        >
          {adding ? "Adding..." : "Add event"}
        </Button>
        {addError && (
          <p className="mt-2 text-xs text-error-700">{addError}</p>
        )}
      </div>

      <div>
        {loadingEvents ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                  <Skeleton className="h-5 w-14 shrink-0" />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-2.5 w-12" />
                </div>
                <Skeleton className="mt-4 h-8 w-full" />
              </Card>
            ))}
          </div>
        ) : eventsError ? (
          <p className="text-sm text-error-700">{eventsError}</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-neutral-500">No events yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {events.map((evt) => (
              <Card
                key={evt.id}
                className="cursor-pointer"
                onClick={() => navigate(`/event/${evt.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-neutral-900">
                      {evt.event_name}
                    </div>
                    {evt.sub_title && (
                      <div className="mt-0.5 text-xs text-neutral-500">
                        {evt.sub_title}
                      </div>
                    )}
                  </div>
                  <Chip variant={statusChipVariant(evt.live_status)}>
                    {statusLabel(evt.live_status)}
                  </Chip>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
                  <span>
                    {evt.competition || evt.competition_scope || "General"}
                  </span>
                  <span>
                    {evt.market_count} market
                    {evt.market_count !== 1 ? "s" : ""}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  className="mt-4 w-full justify-center"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/event/${evt.id}`)
                  }}
                >
                  View match
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const chartLoading = loadingEvents || loadingLifetime || loadingHistory

  const left = (
    <div className="flex flex-col gap-10 py-10">
      <div>
        <h2 className="mb-4 text-sm font-medium text-neutral-500">
          Leaderboard
        </h2>
        {chartLoading ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[26px] w-20 rounded-full" />
              ))}
            </div>
            <div className="flex h-56 items-end gap-3 border-b border-neutral-100 pb-px">
              {CHART_SKELETON_BAR_HEIGHTS.map((h, i) => (
                <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        ) : historyError ? (
          <p className="text-sm text-error-700">{historyError}</p>
        ) : chartXLabels.length < 2 ? (
          <p className="text-sm text-neutral-500">
            Not enough settled events yet to chart a trend.
          </p>
        ) : (
          <LineChart xLabels={chartXLabels} series={chartSeries} />
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Models</h2>
        {loadingLifetime ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <ListRow
                key={i}
                logo={<Skeleton className="h-5 w-5 rounded" />}
                title={<Skeleton className="h-3 w-24" />}
                subtitle={<Skeleton className="mt-1 h-2.5 w-16" />}
              />
            ))}
          </div>
        ) : lifetimeError ? (
          <p className="text-sm text-error-700">{lifetimeError}</p>
        ) : lifetimeLeaderboard.length === 0 ? (
          <p className="text-sm text-neutral-500">No models yet.</p>
        ) : (
          <div>
            {lifetimeLeaderboard.map((row) => {
              const { icon, badge } = getModelIcon(row.model_name)
              const positive = row.avg_percent_change >= 0
              return (
                <ListRow
                  key={row.model_name}
                  logo={
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-neutral-400">
                        {row.lifetime_rank}
                      </span>
                      <LlmLogo label={badge} icon={icon} size="sm" />
                    </div>
                  }
                  title={row.model_name}
                  subtitle={
                    <>
                      {row.events_participated} match
                      {row.events_participated !== 1 ? "es" : ""} &middot;{" "}
                      <span
                        className={
                          positive
                            ? "font-semibold text-success-600"
                            : "font-semibold text-error-600"
                        }
                      >
                        {positive ? "+" : ""}
                        {row.avg_percent_change.toFixed(1)}%
                      </span>
                    </>
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  return <PanelLayout rightTitle="Events" left={left} right={right} />
}

export default MainScreen
