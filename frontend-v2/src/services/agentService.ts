import { apiRequest } from "./api"
import type { ValueHistorySeries } from "../types/events"

export async function getValueHistory(eventId: string): Promise<ValueHistorySeries[]> {
  const res = await apiRequest<{ data: ValueHistorySeries[] }>(`/api/agent/value-history?event_id=${eventId}`)
  return res.data
}

export async function getSystemPrompt(eventId: string, modelName: string): Promise<string> {
  const res = await apiRequest<{ data: { prompt: string } }>(
    `/api/agent/system-prompt?event_id=${eventId}&model_name=${encodeURIComponent(modelName)}`,
  )
  return res.data.prompt
}
