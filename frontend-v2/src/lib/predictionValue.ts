// Client-side mirror of backend/src/agent/valuePoller.ts's currentValue()
// formula, for a display-only live estimate in the Predictions tab. NOT
// authoritative -- the poller's own snapshot (model_event_value_snapshots)
// and real settlement remain the source of truth. This can momentarily
// disagree with that backend value since it's computed from whatever price
// the frontend last fetched (market-snapshot), not necessarily the same
// moment the poller last ran.

export interface LiveValueInput {
  side: "yes" | "no"
  stake: number
  entryPrice: number
}

/** Dollar value of a still-pending prediction right now, given the market's
 * current live yes-price. Returns the stake unchanged (no gain/loss) if no
 * live price is available. */
export function estimateCurrentValue(prediction: LiveValueInput, liveYesPrice: number | null): number {
  if (liveYesPrice == null) return prediction.stake
  const currentSidePrice = prediction.side === "yes" ? liveYesPrice : 1 - liveYesPrice
  return (prediction.stake * currentSidePrice) / prediction.entryPrice
}
