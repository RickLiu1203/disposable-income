import { ArrowLeft, Check, Pencil, X } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Chip, Input, Skeleton } from "../design-system"
import { useUpdateMatchStartTime } from "../hooks/eventMutations"
import { formatMatchDate, statusChipVariant, statusLabel, toDatetimeLocalValue } from "../lib/eventFormat"
import { detectSport, getSportIcon } from "../lib/sportIcon"
import type { EventDetail } from "../types/events"

interface EventHeaderProps {
  eventId: string | undefined
  event: EventDetail["event"] | null
  seriesTickers: string[]
  loading: boolean
  error: string | null
}

export function EventHeader({ eventId, event, seriesTickers, loading, error }: EventHeaderProps) {
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
        <EventHeaderContent eventId={eventId} event={event} seriesTickers={seriesTickers} />
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
  eventId,
  event,
  seriesTickers,
}: {
  eventId: string | undefined
  event: EventDetail["event"]
  seriesTickers: string[]
}) {
  const SportIcon = getSportIcon(detectSport(seriesTickers))
  const date = formatMatchDate(event.match_start_time, event.open_time)
  const meta = [event.competition, event.competition_scope].filter(Boolean).join(" · ")

  const { saving, error: saveError, updateMatchStartTime } = useUpdateMatchStartTime(eventId)
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState("")

  function startEditing() {
    setDraftValue(toDatetimeLocalValue(event.match_start_time ?? event.open_time))
    setIsEditing(true)
  }

  async function saveEdit() {
    if (!draftValue) return
    try {
      await updateMatchStartTime(new Date(draftValue).toISOString())
      setIsEditing(false)
    } catch {
      // saveError already surfaces the failure below; keep the editor open.
    }
  }

  return (
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
        <SportIcon size={22} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-900">{event.event_name}</h1>
          <Chip variant={statusChipVariant(event.live_status)} className="shrink-0 gap-1.5">
            {event.live_status === "in_progress" && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-600 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success-600" />
              </span>
            )}
            {statusLabel(event.live_status)}
          </Chip>
        </div>
        {event.sub_title && <p className="mt-0.5 text-sm text-neutral-500">{event.sub_title}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
          {meta && <span>{meta}</span>}
          {meta && date && <span>&middot;</span>}
          {isEditing ? (
            <div className="flex items-center gap-1.5">
              <Input
                type="datetime-local"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                disabled={saving}
                className="w-auto py-0.5 text-xs"
                autoFocus
              />
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving}
                className="text-success-600 hover:text-success-700 disabled:opacity-50"
                aria-label="Save start time"
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={saving}
                className="text-neutral-400 hover:text-neutral-700 disabled:opacity-50"
                aria-label="Cancel editing start time"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <>
              {date && <span>{date}</span>}
              {eventId && (
                <button
                  type="button"
                  onClick={startEditing}
                  className="text-neutral-300 hover:text-neutral-600"
                  aria-label="Edit start time"
                >
                  <Pencil size={11} />
                </button>
              )}
            </>
          )}
          {saveError && <span className="text-error-600">{saveError}</span>}
        </div>
      </div>
    </div>
  )
}
