import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { getSystemPrompt } from "../services/agentService"
import { placePredictions } from "../services/predictionsService"
import { updateMatchStartTime as updateMatchStartTimeRequest } from "../services/eventsService"

export interface UploadResult {
  fileName: string
  status: "success" | "error"
  message: string
}

/** Submits one or more prediction JSON files sequentially, tracking a
 * per-file success/error result (a single bad file in a batch shouldn't
 * sink the rest), then invalidates every query this event's screen reads
 * from so the just-placed predictions show up immediately. */
export function useSubmitPredictionFiles(eventId: string | undefined) {
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([])

  const submitFiles = async (files: FileList) => {
    setUploading(true)
    const results: UploadResult[] = []
    for (const file of Array.from(files)) {
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const data = await placePredictions(parsed)
        results.push({
          fileName: file.name,
          status: "success",
          message: `${parsed.model_name}: ${data.predictions_inserted} prediction(s) placed`,
        })
      } catch (err) {
        results.push({
          fileName: file.name,
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }
    setUploadResults((prev) => [...results, ...prev])
    setUploading(false)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["eventDetail", eventId] }),
      queryClient.invalidateQueries({ queryKey: ["marketSnapshot", eventId] }),
      queryClient.invalidateQueries({ queryKey: ["valueHistory", eventId] }),
    ])
  }

  return { uploading, uploadResults, submitFiles }
}

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
