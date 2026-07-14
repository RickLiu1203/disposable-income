import { apiRequest } from "./api"

export interface PlacePredictionsResult {
  predictions_inserted: number
}

export async function placePredictions(payload: unknown): Promise<PlacePredictionsResult> {
  const res = await apiRequest<{ data: PlacePredictionsResult }>("/api/predictions/place", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return res.data
}
