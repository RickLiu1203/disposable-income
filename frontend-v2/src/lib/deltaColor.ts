/** Shared green/red tint for any +/- delta (percent change, price change,
 * P&L) -- used across MainScreen, EventScreen, and design-system components.
 * Centralizes what used to be an inline `positive ? "text-success-600" :
 * "text-error-600"` ternary repeated (and drifting -- some 600, some 700)
 * in half a dozen places. Class names are returned as full literal strings,
 * not built via template interpolation, so Tailwind's static scanner can
 * still find them. */
export function deltaColor(isPositive: boolean, shade: 600 | 700 = 600): string {
  if (shade === 700) {
    return isPositive ? "text-success-700" : "text-error-700"
  }
  return isPositive ? "text-success-600" : "text-error-600"
}
