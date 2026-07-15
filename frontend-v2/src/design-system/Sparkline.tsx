import { cx } from "../lib/cx"
import { smoothPath, type Point } from "../lib/smoothPath"

interface SparklineProps {
  points: number[]
  /** Overrides the computed up/down trend used for the stroke color. */
  positive?: boolean
  width?: number
  height?: number
  className?: string
}

// Deliberately dumb otherwise: no hover state, no event listeners, no axes
// -- just a static <path>. Meant to be cheap to mount by the dozen in a
// market list, unlike LineChart (tooltips, click-to-select, legend), which
// is built for one chart per page, not one per row.
export function Sparkline({ points, positive, width = 56, height = 24, className }: SparklineProps) {
  if (points.length < 2) {
    return <div className={cx("shrink-0", className)} style={{ width, height }} />
  }

  // Vertical inset so a smoothed curve's control points can overshoot a
  // sharp peak/trough slightly without clipping against the SVG edge.
  const padY = height * 0.12
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const stepX = width / (points.length - 1)
  const coords: Point[] = points.map((p, i) => ({
    x: i * stepX,
    y: padY + (height - padY * 2) * (1 - (p - min) / range),
  }))
  const d = smoothPath(coords)
  const isPositive = positive ?? points[points.length - 1] >= points[0]

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cx("shrink-0 overflow-visible", className)}
    >
      <path
        d={d}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isPositive ? "stroke-success-600" : "stroke-error-600"}
      />
    </svg>
  )
}
