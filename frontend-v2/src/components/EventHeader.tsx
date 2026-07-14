import { ArrowLeft } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Chip, Skeleton } from "../design-system"
import { formatMatchDate, statusChipVariant, statusLabel } from "../lib/eventFormat"
import { detectSport, getSportIcon } from "../lib/sportIcon"
import type { EventDetail } from "../types/events"

interface EventHeaderProps {
  event: EventDetail["event"] | null
  seriesTickers: string[]
  loading: boolean
  error: string | null
}

export function EventHeader({ event, seriesTickers, loading, error }: EventHeaderProps) {
  const navigate = useNavigate()

  return (
    <div className="border-b border-neutral-100 px-10 py-6">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800"
      >
        <ArrowLeft size={14} />
        Back to matches
      </button>

      {event ? (
        <EventHeaderContent event={event} seriesTickers={seriesTickers} />
      ) : error ? (
        <p className="text-sm text-error-700">{error}</p>
      ) : loading ? (
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function EventHeaderContent({
  event,
  seriesTickers,
}: {
  event: EventDetail["event"]
  seriesTickers: string[]
}) {
  const SportIcon = getSportIcon(detectSport(seriesTickers))
  const date = formatMatchDate(event.match_start_time, event.open_time)
  const meta = [event.competition, event.competition_scope].filter(Boolean).join(" · ")

  return (
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
        <SportIcon size={22} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-900">{event.event_name}</h1>
          <Chip variant={statusChipVariant(event.live_status)} className="shrink-0">
            {statusLabel(event.live_status)}
          </Chip>
        </div>
        {event.sub_title && <p className="mt-0.5 text-sm text-neutral-500">{event.sub_title}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
          {meta && <span>{meta}</span>}
          {meta && date && <span>&middot;</span>}
          {date && <span>{date}</span>}
        </div>
      </div>
    </div>
  )
}
