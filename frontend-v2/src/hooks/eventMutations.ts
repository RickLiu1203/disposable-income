import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { getSystemPrompt } from "../services/agentService"
import { updateMatchStartTime as updateMatchStartTimeRequest } from "../services/eventsService"

export type CopyStatus = "idle" | "copied" | "error"

export const DEFAULT_BACKEND_URL = "http://localhost:3000"

export function useCopySystemPrompt(eventId: string | undefined) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle")

  const copySystemPrompt = async (modelName: string, backendUrl?: string) => {
    if (!eventId) return
    try {
      const prompt = await getSystemPrompt(eventId, modelName, backendUrl)
      await navigator.clipboard.writeText(prompt)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("error")
    } finally {
      setTimeout(() => setCopyStatus("idle"), 2000)
    }
  }

  return { copyStatus, copySystemPrompt }
}

/** Corrects an event's match_start_time -- the field the value poller and
 * computeEventStatus trust for "has this actually started" (see CLAUDE.md's
 * "Match start vs. market open" note), so a wrong Kalshi-sourced value here
 * can hold back live polling/settlement, not just mis-render a date.
 * Invalidates eventDetail so the corrected time (and any live_status shift
 * it causes) shows up immediately. */
export function useUpdateMatchStartTime(eventId: string | undefined) {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateMatchStartTime = async (matchStartTimeIso: string) => {
    if (!eventId) return
    setSaving(true)
    setError(null)
    try {
      await updateMatchStartTimeRequest(eventId, matchStartTimeIso)
      await queryClient.invalidateQueries({ queryKey: ["eventDetail", eventId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update start time")
      throw err
    } finally {
      setSaving(false)
    }
  }

  return { saving, error, updateMatchStartTime }
}
