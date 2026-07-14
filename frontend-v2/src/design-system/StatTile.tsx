import type { ReactNode } from "react"
import { cx } from "../lib/cx"

type Trend = "up" | "down" | "flat"

interface StatTileProps {
  label: string
  value: string
  delta?: string
  trend?: Trend
  icon?: ReactNode
  sparkline?: number[]
  className?: string
}

const deltaColor: Record<Trend, string> = {
  up: "text-success-600",
  down: "text-error-600",
  flat: "text-neutral-500",
}

const sparklineColor: Record<Trend, string> = {
  up: "text-success-600",
  down: "text-error-600",
  flat: "text-primary-600",
}

function sparklinePath(values: number[], width: number, height: number, padding: number) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = padding + i * stepX
      const y = height - padding - ((v - min) / range) * (height - padding * 2)
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
}

export function StatTile({
  label,
  value,
  delta,
  trend,
  icon,
  sparkline,
  className,
}: StatTileProps) {
  return (
    <div
      className={cx(
        "rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.05)]",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-xs font-bold uppercase tracking-wide text-neutral-400">
          {label}
        </div>
      </div>
      <div className="my-0.5 text-xl font-bold tabular-nums text-neutral-900">
        {value}
      </div>
      {delta && trend && <div className={cx("text-xs font-semibold", deltaColor[trend])}>{delta}</div>}
      {sparkline && sparkline.length > 1 && trend && (
        <svg
          viewBox="0 0 120 32"
          preserveAspectRatio="none"
          className={cx("mt-2 h-8 w-full", sparklineColor[trend])}
        >
          <path
            d={sparklinePath(sparkline, 120, 32, 2)}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  )
}
