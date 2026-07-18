import { apiRequest } from "./api"
import type { ValueHistorySeries } from "../types/events"

export async function getValueHistory(eventId: string): Promise<ValueHistorySeries[]> {
  const res = await apiRequest<{ data: ValueHistorySeries[] }>(`/api/agent/value-history?event_id=${eventId}`)
  return res.data
}

export async function getSystemPrompt(
  eventId: string,
  modelName: string,
  backendBaseUrl?: string,
): Promise<string> {
  const params = new URLSearchParams({ event_id: eventId, model_name: modelName })
  if (backendBaseUrl?.trim()) {
    params.set("backend_base_url", backendBaseUrl.trim())
  }
  const res = await apiRequest<{ data: { prompt: string } }>(
    `/api/agent/system-prompt?${params.toString()}`,
  )
  return res.data.prompt
}
