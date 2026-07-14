import { useState } from "react"
import { useParams } from "react-router-dom"
import {
  Button,
  Card,
  Chip,
  LineChart,
  ListRow,
  LlmLogo,
  Modal,
  Skeleton,
  StatTile,
  Toggle,
} from "../design-system"
import { EventHeader } from "../components/EventHeader"
import { useCopySystemPrompt, useSubmitPredictionFiles } from "../hooks/eventMutations"
import { useEventDetailQuery, useLifetimeRosterQuery, useMarketSnapshotQuery, useValueHistoryQuery } from "../hooks/eventQueries"
import { PanelLayout } from "../layouts/PanelLayout"
import { outcomeChipVariant } from "../lib/eventFormat"
import { getModelIcon } from "../lib/modelIcons"
import { estimateCurrentValue } from "../lib/predictionValue"
import { buildValueChart, formatAsOf } from "../lib/valueChart"
import { cx } from "../lib/cx"
import type { PredictionRow } from "../types/events"

const CHART_SKELETON_BAR_HEIGHTS = [45, 68, 55, 82, 60, 40, 74, 52, 66, 78]
const LEFTOVER_SUFFIX = "-LEFTOVER"

function EventScreen() {
  const { eventId } = useParams<{ eventId: string }>()

  const eventDetailQuery = useEventDetailQuery(eventId)
  const marketSnapshotQuery = useMarketSnapshotQuery(eventId)
  const lifetimeRosterQuery = useLifetimeRosterQuery()

  const eventDetail = eventDetailQuery.data ?? null
  const loadingDetail = eventDetailQuery.isFetching
  const detailError = eventDetailQuery.error instanceof Error ? eventDetailQuery.error.message : null

  const marketSnapshot = marketSnapshotQuery.data ?? []
  const loadingSnapshot = marketSnapshotQuery.isFetching
  const snapshotError = marketSnapshotQuery.error instanceof Error ? marketSnapshotQuery.error.message : null

  const lifetimeRoster = lifetimeRosterQuery.data ?? []

  const liveStatus = eventDetail?.event.live_status
  const valueHistoryQuery = useValueHistoryQuery(eventId, liveStatus)
  const valueHistory = valueHistoryQuery.data ?? []
  const loadingHistory = valueHistoryQuery.isFetching

  const { uploading, uploadResults, submitFiles } = useSubmitPredictionFiles(eventId)
  const { copyStatus, copySystemPrompt } = useCopySystemPrompt(eventId)

  const [rightMode, setRightMode] = useState<"markets" | "model">("markets")
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [marketsFilter, setMarketsFilter] = useState<"All" | "Predicted">("All")
  const [modelTab, setModelTab] = useState<"Predictions" | "Strategies">("Predictions")

  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const modelRoster =
    eventDetail && eventDetail.leaderboard.length > 0
      ? eventDetail.leaderboard.map((r) => r.model_name)
      : lifetimeRoster.map((r) => r.model_name)

  // Each model's real pot for this event -- never a hardcoded $10, since
  // balances carry forward continuously across matches.
  const startingBalances = eventDetail?.starting_balances ?? {}
  function startingBalanceFor(modelName: string): number {
    return startingBalances[modelName] ?? 10
  }

  // ---- Left panel: chart ----
  const chartLoading = loadingDetail || loadingHistory
  const chartData =
    liveStatus && liveStatus !== "open"
      ? buildValueChart(
          valueHistory,
          modelRoster,
          startingBalances,
          eventDetail?.event.match_start_time ?? eventDetail?.event.open_time ?? null,
        )
      : null
  let finalChartXLabels = chartData?.xLabels ?? []
  let finalChartSeries = chartData?.series ?? []
  if (liveStatus === "completed" && eventDetail) {
    // A completed event should always be able to show a Start -> Final
    // trend from the leaderboard alone, even if the value poller never
    // captured a single live tick for it (e.g. it settled faster than one
    // 10-minute cycle, or it predates the poller entirely).
    const base =
      chartData && chartData.xLabels.length > 0
        ? chartData
        : {
            xLabels: ["Start"],
            series: modelRoster.map((m) => {
              const { icon, badge } = getModelIcon(m)
              return { key: m, name: m, badge, badgeIcon: icon, values: [startingBalanceFor(m)] }
            }),
          }
    finalChartXLabels = [...base.xLabels, "Final"]
    finalChartSeries = base.series.map((s) => {
      const row = eventDetail.leaderboard.find((r) => r.model_name === s.name)
      const finalValue = row?.ending_balance ?? s.values[s.values.length - 1] ?? startingBalanceFor(s.name)
      return { ...s, values: [...s.values, finalValue] }
    })
  }

  // ---- Left panel: ranked model list ----
  // A model only gets a model_event_results row (and so shows up in
  // eventDetail.leaderboard) once ALL of its own predictions for this event
  // have settled -- that's tracked per-model, independent of other models.
  // So once the first model finishes, the naive "leaderboard.length > 0 ?
  // leaderboard : roster" branch used to make every other still-pending
  // model vanish from the list entirely. Split into a Resolved section
  // (leaderboard rows) and a Pending resolution section (models that have
  // placed predictions in this event -- per eventDetail.predictions -- but
  // haven't settled yet) so pending models stay visible with a live
  // mark-to-market estimate instead of disappearing.
  const hasAnyPredictions = (eventDetail?.predictions.length ?? 0) > 0

  const resolvedRows = (eventDetail?.leaderboard ?? [])
    .slice()
    .sort((a, b) => a.event_rank - b.event_rank)
    .map((row) => ({
      model_name: row.model_name,
      rank: row.event_rank as number | null,
      balance: row.ending_balance ?? row.starting_balance,
      percentChange: row.percent_change,
    }))

  function buildLiveEstimateRow(modelName: string) {
    const series = valueHistory.find((s) => s.model_name === modelName)
    const last = series?.points[series.points.length - 1]
    const starting = startingBalanceFor(modelName)
    const balance = last?.unrealized_balance ?? starting
    return {
      model_name: modelName,
      rank: null as number | null,
      balance,
      percentChange: ((balance - starting) / starting) * 100,
    }
  }

  const settledModelNames = new Set(resolvedRows.map((r) => r.model_name))
  const pendingRows = Array.from(new Set((eventDetail?.predictions ?? []).map((p) => p.model_name)))
    .filter((name) => !settledModelNames.has(name))
    .map(buildLiveEstimateRow)

  // Before anyone has placed a single prediction yet, show the full known
  // roster (lifetime history) as a preview lineup rather than two empty
  // sections.
  const previewRows = !hasAnyPredictions ? lifetimeRoster.map((row) => buildLiveEstimateRow(row.model_name)) : []

  function renderModelRow(row: { model_name: string; rank: number | null; balance: number; percentChange: number | null }) {
    const { icon, badge } = getModelIcon(row.model_name)
    const positive = (row.percentChange ?? 0) >= 0
    return (
      <ListRow
        key={row.model_name}
        className="cursor-pointer"
        onClick={() => {
          setSelectedModel(row.model_name)
          setRightMode("model")
          setModelTab("Predictions")
        }}
        logo={
          <div className="flex items-center gap-2">
            {row.rank !== null && (
              <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-neutral-400">{row.rank}</span>
            )}
            <LlmLogo label={badge} icon={icon} size="sm" />
          </div>
        }
        title={row.model_name}
        subtitle={
          <>
            ${row.balance.toFixed(2)} &middot;{" "}
            <span className={positive ? "font-semibold text-success-600" : "font-semibold text-error-600"}>
              {positive ? "+" : ""}
              {(row.percentChange ?? 0).toFixed(1)}%
            </span>
          </>
        }
      />
    )
  }

  const left = (
    <div className="flex flex-col gap-10 py-10">
      <div>
        <h2 className="mb-4 text-sm font-medium text-neutral-500">Value</h2>
        {chartLoading ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[26px] w-20 rounded-full" />
              ))}
            </div>
            <div className="flex h-56 items-end gap-3 border-b border-neutral-100 pb-px">
              {CHART_SKELETON_BAR_HEIGHTS.map((h, i) => (
                <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        ) : detailError ? (
          <p className="text-sm text-error-700">{detailError}</p>
        ) : liveStatus === "open" ? (
          <div className="flex flex-wrap gap-3">
            {lifetimeRoster.map((row) => {
              const { icon, badge } = getModelIcon(row.model_name)
              return (
                <div key={row.model_name} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2">
                  <LlmLogo label={badge} icon={icon} size="sm" />
                  <div>
                    <div className="text-sm font-semibold tabular-nums text-neutral-900">
                      ${startingBalanceFor(row.model_name).toFixed(2)}
                    </div>
                    <div className="text-xs text-neutral-500">{row.model_name}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : finalChartXLabels.length < 2 ? (
          <p className="text-sm text-neutral-500">Not enough live data yet to chart a trend.</p>
        ) : (
          <LineChart xLabels={finalChartXLabels} series={finalChartSeries} />
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Models</h2>
        {loadingDetail ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <ListRow
                key={i}
                logo={<Skeleton className="h-5 w-5 rounded" />}
                title={<Skeleton className="h-3 w-24" />}
                subtitle={<Skeleton className="mt-1 h-2.5 w-16" />}
              />
            ))}
          </div>
        ) : hasAnyPredictions ? (
          <div className="flex flex-col gap-5">
            {resolvedRows.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Resolved</h3>
                <div>{resolvedRows.map(renderModelRow)}</div>
              </div>
            )}
            {pendingRows.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Pending resolution
                </h3>
                <div>{pendingRows.map(renderModelRow)}</div>
              </div>
            )}
          </div>
        ) : (
          <div>{previewRows.map(renderModelRow)}</div>
        )}
      </div>

      <Card className="cursor-pointer" onClick={() => setUploadModalOpen(true)}>
        <div className="text-sm font-semibold text-neutral-900">Submit predictions</div>
        <div className="mt-0.5 text-xs text-neutral-500">Drag and drop JSON files for any model</div>
      </Card>
    </div>
  )

  // ---- Right panel: Markets mode ----
  const predictedByTicker = new Map<string, string[]>()
  eventDetail?.predictions.forEach((p) => {
    if (p.market_ticker.endsWith(LEFTOVER_SUFFIX)) return
    const list = predictedByTicker.get(p.market_ticker) ?? []
    if (!list.includes(p.model_name)) list.push(p.model_name)
    predictedByTicker.set(p.market_ticker, list)
  })
  const visibleMarkets =
    marketsFilter === "All" ? marketSnapshot : marketSnapshot.filter((m) => predictedByTicker.has(m.ticker))

  const marketsView = (
    <div>
      <Toggle options={["All", "Predicted"]} value={marketsFilter} onChange={(v) => setMarketsFilter(v as "All" | "Predicted")} />
      <div className="mt-4">
        {loadingSnapshot ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : snapshotError ? (
          <p className="text-sm text-error-700">{snapshotError}</p>
        ) : visibleMarkets.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {marketsFilter === "Predicted" ? "No predictions placed yet." : "No markets found."}
          </p>
        ) : (
          <div>
            {visibleMarkets.map((m) => (
              <div key={m.ticker} className="flex items-center justify-between gap-3 border-b border-neutral-100 py-2.5 last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-neutral-900">{m.label ?? "Market"}</div>
                  <div className="text-xs text-neutral-500">
                    {m.price !== null ? `${Math.round(m.price * 100)}¢` : "—"}
                    {m.as_of && <> &middot; as of {formatAsOf(m.as_of)}</>}
                  </div>
                </div>
                {marketsFilter === "Predicted" && (
                  <div className="flex -space-x-1.5 shrink-0">
                    {(predictedByTicker.get(m.ticker) ?? []).map((modelName) => {
                      const { icon, badge } = getModelIcon(modelName)
                      return (
                        <LlmLogo
                          key={modelName}
                          label={badge}
                          icon={icon}
                          size="sm"
                          className="ring-2 ring-secondary-50"
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  // ---- Right panel: Model mode ----
  const modelPredictions = (eventDetail?.predictions ?? []).filter(
    (p) => p.model_name === selectedModel && !p.market_ticker.endsWith(LEFTOVER_SUFFIX),
  )
  const allModelPredictions = (eventDetail?.predictions ?? []).filter((p) => p.model_name === selectedModel)
  const priceByTicker = new Map(marketSnapshot.map((m) => [m.ticker, m.price]))
  const labelByTicker = new Map((eventDetail?.markets ?? []).map((m) => [m.ticker, m.label]))
  const startingBalance = selectedModel ? startingBalanceFor(selectedModel) : 10
  const realStakedTotal = allModelPredictions
    .filter((p) => !p.market_ticker.endsWith(LEFTOVER_SUFFIX))
    .reduce((sum, p) => sum + p.stake, 0)
  const remainingBankroll = startingBalance - realStakedTotal

  function predictionDisplayValue(p: PredictionRow): number {
    if (p.outcome !== "pending") return p.payout ?? 0
    const livePrice = priceByTicker.get(p.market_ticker) ?? null
    return estimateCurrentValue({ side: p.side, stake: p.stake, entryPrice: p.entry_price }, livePrice)
  }

  const strategy = eventDetail?.strategies.find((s) => s.model_name === selectedModel)

  const modelView = selectedModel && (
    <div>
      <button
        type="button"
        onClick={() => setRightMode("markets")}
        className="mb-4 text-xs font-medium text-neutral-500 hover:text-neutral-800"
      >
        ← Markets
      </button>

      <StatTile label="Remaining bankroll" value={`$${remainingBankroll.toFixed(2)}`} className="mb-4" />

      <Toggle options={["Predictions", "Strategies"]} value={modelTab} onChange={(v) => setModelTab(v as "Predictions" | "Strategies")} />

      <div className="mt-4">
        {modelTab === "Predictions" ? (
          modelPredictions.length === 0 ? (
            <p className="text-sm text-neutral-500">No predictions placed yet.</p>
          ) : (
            <div>
              {modelPredictions.map((p) => {
                const value = predictionDisplayValue(p)
                return (
                  <div key={p.id} className="border-b border-neutral-100 py-3 last:border-b-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-neutral-900">
                          {labelByTicker.get(p.market_ticker) ?? "Market"}
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-500">
                          {p.side === "yes" ? "Yes" : "No"} &middot; ${p.stake.toFixed(2)} staked
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold tabular-nums text-neutral-900">${value.toFixed(2)}</div>
                        {p.outcome !== "pending" ? (
                          <Chip variant={outcomeChipVariant(p.outcome)} className="mt-1">
                            {p.outcome}
                          </Chip>
                        ) : (
                          <div className="mt-1 text-[10px] text-neutral-400">estimated</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <div>
            <div className="mb-4">
              {strategy?.strategy_headline && (
                <div className="text-sm font-semibold text-neutral-900">{strategy.strategy_headline}</div>
              )}
              <p className="mt-1 text-sm text-neutral-600">{strategy?.strategy_notes ?? "No strategy notes yet."}</p>
            </div>
            <div className="border-t border-neutral-100 pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Bet justifications
              </div>
              {modelPredictions.length === 0 ? (
                <p className="text-sm text-neutral-500">No predictions placed yet.</p>
              ) : (
                modelPredictions.map((p) => (
                  <div key={p.id} className="border-b border-neutral-100 py-2.5 last:border-b-0">
                    <div className="text-sm font-medium text-neutral-900">
                      {labelByTicker.get(p.market_ticker) ?? "Market"}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">{p.justification}</p>
                  </div>
                ))
              )}
            </div>
            <Button
              variant="secondary"
              className="mt-4 w-full justify-center"
              onClick={() => selectedModel && copySystemPrompt(selectedModel)}
            >
              {copyStatus === "copied" ? "Copied!" : copyStatus === "error" ? "Failed to copy" : "Copy system prompt"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )

  const rightTitle =
    rightMode === "model" && selectedModel
      ? (() => {
          const { icon, badge } = getModelIcon(selectedModel)
          return (
            <div className="flex items-center gap-2">
              <LlmLogo label={badge} icon={icon} size="sm" />
              <span>{selectedModel}</span>
            </div>
          )
        })()
      : "Markets"

  const right = rightMode === "model" ? modelView : marketsView

  const header = (
    <EventHeader
      event={eventDetail?.event ?? null}
      seriesTickers={(eventDetail?.tickers ?? []).map((t) => t.series_ticker)}
      loading={loadingDetail}
      error={detailError}
    />
  )

  return (
    <>
      <PanelLayout header={header} rightTitle={rightTitle} left={left} right={right} />

      <Modal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} title="Submit predictions">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (e.dataTransfer.files.length > 0) submitFiles(e.dataTransfer.files)
          }}
          className={cx(
            "rounded-lg border-2 border-dashed p-8 text-center",
            isDragging ? "border-accent-500 bg-accent-50" : "border-neutral-200",
          )}
        >
          <p className="text-sm text-neutral-600">
            {uploading ? "Uploading..." : "Drop one or more prediction JSON files here"}
          </p>
          <p className="mt-1 text-xs text-neutral-400">or</p>
          <label className="mt-2 inline-block cursor-pointer text-sm font-medium text-accent-600 hover:text-accent-700">
            Browse files
            <input
              type="file"
              accept=".json,application/json"
              multiple
              disabled={uploading}
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) submitFiles(e.target.files)
                e.target.value = ""
              }}
            />
          </label>
        </div>

        {uploadResults.length > 0 && (
          <div className="mt-4 max-h-48 overflow-y-auto">
            {uploadResults.map((r, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-neutral-100 py-2 last:border-b-0">
                <Chip variant={r.status === "success" ? "success" : "error"}>{r.status}</Chip>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-neutral-900">{r.fileName}</div>
                  <div className="text-xs text-neutral-500">{r.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  )
}

export default EventScreen
