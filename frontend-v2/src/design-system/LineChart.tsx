import { useEffect, useRef, useState } from "react"
import type { MouseEvent as ReactMouseEvent, PointerEvent } from "react"
import { cx } from "../lib/cx"

export interface LineChartSeries {
  key: string
  name: string
  shortName?: string
  badge: string
  /** Optional brand icon image src, rendered in place of the `badge` initials. */
  badgeIcon?: string
  values: number[]
  /** Overrides the computed up/down trend used for the click highlight and popover. */
  positive?: boolean
  /** Overrides the computed change text shown in the popover, e.g. "+18.4%". */
  delta?: string
}

interface LineChartProps {
  series: LineChartSeries[]
  xLabels: string[]
  valueFormat?: (value: number) => string
  className?: string
}

// Lines share the accent hue at rest; opacity is the only thing that
// separates overlapping series. The click highlight is the only place
// color communicates meaning (green/red for up/down).
const ACCENT_OPACITIES = [1, 0.6, 0.35]

// How close (in svg units, out of a 240-tall viewBox) a click needs to
// land to a line before it counts as clicking that line.
const LINE_HIT_RADIUS = 18

function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain
  const [r0, r1] = range
  return (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)
}

function niceTicks(min: number, max: number, count: number) {
  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, i) => Math.round(min + step * i))
}

// Caps how many x-axis labels render at once so they never crowd together --
// full-resolution data still backs the line itself and the hover tooltip,
// this only thins the ticks drawn along the bottom.
const MAX_X_LABELS = 6

function pickLabelIndices(length: number, max: number): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i)
  const step = (length - 1) / (max - 1)
  const indices = new Set<number>()
  for (let i = 0; i < max; i++) indices.add(Math.round(i * step))
  return Array.from(indices).sort((a, b) => a - b)
}

function isSeriesPositive(s: LineChartSeries) {
  if (s.positive !== undefined) return s.positive
  return s.values[s.values.length - 1] >= s.values[0]
}

function seriesDeltaText(s: LineChartSeries) {
  if (s.delta) return s.delta
  const first = s.values[0]
  const last = s.values[s.values.length - 1]
  const pct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
}

export function LineChart({
  series,
  xLabels,
  valueFormat = (v) => `$${v.toFixed(2)}`,
  className,
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<{ series: number; idx: number } | null>(null)
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)

  useEffect(() => {
    if (selected === null) return
    function handleOutside(evt: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(evt.target as Node)) {
        setSelected(null)
      }
    }
    document.addEventListener("mousedown", handleOutside)
    return () => document.removeEventListener("mousedown", handleOutside)
  }, [selected])

  const W = 640
  const H = 240
  const mL = 40
  const mR = 78
  const mT = 20
  const mB = 28
  const plotW = W - mL - mR
  const plotH = H - mT - mB

  const allValues = series.flatMap((s) => s.values)
  const rawMin = Math.min(...allValues)
  const rawMax = Math.max(...allValues)
  const pad = (rawMax - rawMin || 2) * 0.2
  const yMin = Math.floor((rawMin - pad) / 2) * 2
  const yMax = Math.ceil((rawMax + pad) / 2) * 2

  const x = scaleLinear([0, xLabels.length - 1], [mL, mL + plotW])
  const y = scaleLinear([yMin, yMax], [mT + plotH, mT])
  const ticks = niceTicks(yMin, yMax, 5)
  const xLabelIndices = pickLabelIndices(xLabels.length, MAX_X_LABELS)

  function colorClass(i: number, kind: "line" | "dot") {
    const isSelected = selected?.series === i
    const isDimmed = selected !== null && !isSelected
    if (isSelected) {
      const positive = isSeriesPositive(series[i])
      if (kind === "line") return positive ? "stroke-success-600" : "stroke-error-600"
      return positive ? "fill-success-600" : "fill-error-600"
    }
    if (isDimmed) return kind === "line" ? "stroke-neutral-300" : "fill-neutral-300"
    return kind === "line" ? "stroke-accent-500" : "fill-accent-500"
  }

  function indexAt(clientX: number, svgRect: DOMRect) {
    const scaleX = W / svgRect.width
    const px = (clientX - svgRect.left) * scaleX
    const idx = Math.round(((px - mL) / plotW) * (xLabels.length - 1))
    return Math.max(0, Math.min(xLabels.length - 1, idx))
  }

  function handleMove(evt: PointerEvent<SVGRectElement>) {
    const svgRect = evt.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const wrapRect = wrapRef.current!.getBoundingClientRect()
    const idx = indexAt(evt.clientX, svgRect)
    setHover({ index: idx, x: evt.clientX - wrapRect.left, y: evt.clientY - wrapRect.top })
  }

  function handleClick(evt: ReactMouseEvent<SVGRectElement>) {
    const svgRect = evt.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const scaleY = H / svgRect.height
    const py = (evt.clientY - svgRect.top) * scaleY
    const idx = indexAt(evt.clientX, svgRect)

    let nearestI = -1
    let nearestDist = Infinity
    series.forEach((s, i) => {
      const dist = Math.abs(y(s.values[idx]) - py)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestI = i
      }
    })

    if (nearestI === -1 || nearestDist > LINE_HIT_RADIUS) {
      setSelected(null)
      return
    }
    setSelected((cur) => (cur?.series === nearestI ? null : { series: nearestI, idx }))
  }

  return (
    <div ref={wrapRef} className={cx("relative", className)}>
      <div className="mb-3 flex flex-wrap gap-1">
        {series.map((s, i) => {
          const isSelected = selected?.series === i
          const positive = isSeriesPositive(s)
          const trendText = positive ? "text-success-700" : "text-error-700"
          const trendBg = positive ? "bg-success-50" : "bg-error-50"
          const trendChip = positive ? "bg-success-600 text-white" : "bg-error-600 text-white"
          return (
            <button
              key={s.key}
              type="button"
              onClick={() =>
                setSelected((cur) => (cur?.series === i ? null : { series: i, idx: s.values.length - 1 }))
              }
              className={cx(
                "flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-xs text-neutral-600 hover:bg-neutral-100",
                isSelected && cx(trendBg, "font-semibold", trendText),
              )}
            >
              <span
                className={cx(
                  "flex h-[18px] w-[18px] items-center justify-center overflow-hidden rounded text-[8px] font-bold",
                  isSelected ? trendChip : "bg-primary-100 text-primary-700",
                )}
              >
                {s.badgeIcon ? (
                  <img src={s.badgeIcon} alt={s.badge} className="h-full w-full object-contain p-0.5" />
                ) : (
                  s.badge
                )}
              </span>
              {s.shortName ?? s.name}
            </button>
          )
        })}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={mL} x2={mL + plotW} y1={y(t)} y2={y(t)} className="stroke-neutral-200" strokeWidth={1} />
              <text x={mL - 8} y={y(t) + 3} textAnchor="end" className="fill-neutral-400 text-[10px]">
                ${t}
              </text>
            </g>
          ))}
          {xLabelIndices.map((i) => (
            <text
              key={xLabels[i] + i}
              x={x(i)}
              y={mT + plotH + 18}
              textAnchor="middle"
              className="fill-neutral-400 text-[10px]"
            >
              {xLabels[i]}
            </text>
          ))}

          {series.map((s, i) => {
            const d = s.values.map((v, j) => `${j === 0 ? "M" : "L"} ${x(j)} ${y(v)}`).join(" ")
            const lastI = s.values.length - 1
            const ex = x(lastI)
            const ey = y(s.values[lastI])
            const isSelected = selected?.series === i
            const isDimmed = selected !== null && !isSelected
            const restOpacity = ACCENT_OPACITIES[i % ACCENT_OPACITIES.length]
            const opacity = isSelected ? 1 : isDimmed ? 0.25 : restOpacity
            const positive = isSeriesPositive(s)
            return (
              <g key={s.key} style={{ opacity }}>
                <path
                  d={d}
                  fill="none"
                  strokeWidth={isSelected ? 3 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={colorClass(i, "line")}
                />
                <rect
                  x={ex + 9}
                  y={ey - 11}
                  width={22}
                  height={22}
                  rx={6}
                  className={isSelected ? (positive ? "fill-success-50" : "fill-error-50") : "fill-primary-50"}
                />
                {s.badgeIcon ? (
                  <image href={s.badgeIcon} x={ex + 13} y={ey - 7} width={14} height={14} />
                ) : (
                  <text
                    x={ex + 20}
                    y={ey + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className={cx(
                      "text-[9px] font-bold",
                      isSelected ? (positive ? "fill-success-700" : "fill-error-700") : "fill-primary-700",
                    )}
                  >
                    {s.badge}
                  </text>
                )}
                <text x={ex + 34} y={ey + 4} className="fill-neutral-900 text-[11px] font-bold">
                  {valueFormat(s.values[lastI])}
                </text>
              </g>
            )
          })}

          {hover && (
            <>
              <line
                x1={x(hover.index)}
                x2={x(hover.index)}
                y1={mT}
                y2={mT + plotH}
                className="stroke-neutral-300"
                strokeWidth={1}
              />
              {series.map((s, i) => (
                <circle
                  key={s.key}
                  cx={x(hover.index)}
                  cy={y(s.values[hover.index])}
                  r={5}
                  strokeWidth={2}
                  className={cx("stroke-white", colorClass(i, "dot"))}
                />
              ))}
            </>
          )}

          <rect
            x={mL}
            y={mT}
            width={plotW}
            height={plotH}
            fill="transparent"
            className="cursor-pointer"
            onPointerMove={handleMove}
            onPointerLeave={() => setHover(null)}
            onClick={handleClick}
          />
        </svg>

        {selected &&
          (() => {
            const s = series[selected.series]
            const positive = isSeriesPositive(s)
            const leftPct = (x(selected.idx) / W) * 100
            const topPct = (y(s.values[selected.idx]) / H) * 100
            return (
              <div
                className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-neutral-900 px-2 py-1.5 text-xs text-white shadow-lg"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  transform: "translate(-50%, calc(-100% - 10px))",
                }}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <span
                    className={cx(
                      "flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded text-[7px] font-bold",
                      positive ? "bg-success-600" : "bg-error-600",
                    )}
                  >
                    {s.badgeIcon ? (
                      <img src={s.badgeIcon} alt={s.badge} className="h-full w-full object-contain p-px" />
                    ) : (
                      s.badge
                    )}
                  </span>
                  {s.shortName ?? s.name}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="font-bold tabular-nums">{valueFormat(s.values[selected.idx])}</span>
                  <span className={cx("font-semibold", positive ? "text-success-400" : "text-error-400")}>
                    {positive ? "▲" : "▼"} {seriesDeltaText(s)}
                  </span>
                </div>
              </div>
            )
          })()}
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg bg-neutral-900 px-2.5 py-2 text-xs text-white"
          style={{ left: hover.x + 14, top: hover.y - 10 }}
        >
          <div className="mb-1 font-bold">{xLabels[hover.index]}</div>
          {series.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span
                className={cx(
                  "flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-[3px] text-[6.5px] font-bold",
                  selected?.series === i
                    ? isSeriesPositive(s)
                      ? "bg-success-600 text-white"
                      : "bg-error-600 text-white"
                    : "bg-primary-100 text-primary-700",
                )}
              >
                {s.badgeIcon ? (
                  <img src={s.badgeIcon} alt={s.badge} className="h-full w-full object-contain p-px" />
                ) : (
                  s.badge
                )}
              </span>
              <span>{s.shortName ?? s.name}</span>
              <span className="ml-auto pl-3 font-bold tabular-nums">{valueFormat(s.values[hover.index])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
