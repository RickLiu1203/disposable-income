import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  Card,
  Chip,
  Dropdown,
  Input,
  LineChart,
  ListRow,
  LlmLogo,
  Modal,
  Skeleton,
  Sparkline,
  Toggle,
} from "../design-system";
import { EventHeader } from "../components/EventHeader";
import {
  DEFAULT_BACKEND_URL,
  useCopySystemPrompt,
  useSubmitPredictionFiles,
} from "../hooks/eventMutations";
import {
  useEventDetailQuery,
  useLifetimeRosterQuery,
  useMarketSnapshotQuery,
  useValueHistoryQuery,
} from "../hooks/eventQueries";
import { PanelLayout } from "../layouts/PanelLayout";
import { outcomeChipVariant } from "../lib/eventFormat";
import { deltaColor } from "../lib/deltaColor";
import { getModelIcon } from "../lib/modelIcons";
import { buildValueChart, formatAsOf } from "../lib/valueChart";
import { cx } from "../lib/cx";
import type { MarketSnapshotRow, PredictionRow } from "../types/events";

const CHART_SKELETON_BAR_HEIGHTS = [45, 68, 55, 82, 60, 40, 74, 52, 66, 78];
const LEFTOVER_SUFFIX = "-LEFTOVER";
const MARKET_SORTS = [
  "Default",
  "Top gainers",
  "Top losers",
  "Highest price",
  "Lowest price",
] as const;
type MarketSort = (typeof MARKET_SORTS)[number];

function EventScreen() {
  const { eventId } = useParams<{ eventId: string }>();

  const eventDetailQuery = useEventDetailQuery(eventId);
  const eventDetail = eventDetailQuery.data ?? null;
  const loadingDetail = eventDetailQuery.isFetching;
  const detailError =
    eventDetailQuery.error instanceof Error
      ? eventDetailQuery.error.message
      : null;

  const liveStatus = eventDetail?.event.live_status;

  const marketSnapshotQuery = useMarketSnapshotQuery(eventId, liveStatus);
  const lifetimeRosterQuery = useLifetimeRosterQuery();

  const marketSnapshot = marketSnapshotQuery.data ?? [];
  const loadingSnapshot = marketSnapshotQuery.isFetching;
  const snapshotError =
    marketSnapshotQuery.error instanceof Error
      ? marketSnapshotQuery.error.message
      : null;

  const lifetimeRoster = lifetimeRosterQuery.data ?? [];

  const valueHistoryQuery = useValueHistoryQuery(eventId, liveStatus);
  const valueHistory = valueHistoryQuery.data ?? [];
  const loadingHistory = valueHistoryQuery.isFetching;

  const { uploading, uploadResults, submitFiles } =
    useSubmitPredictionFiles(eventId);
  const { copyStatus, copySystemPrompt } = useCopySystemPrompt(eventId);

  const [rightMode, setRightMode] = useState<"markets" | "model">("markets");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [predictedSort, setPredictedSort] = useState<MarketSort>("Default");
  const [allSort, setAllSort] = useState<MarketSort>("Default");
  const [modelTab, setModelTab] = useState<"Predictions" | "Strategies">(
    "Predictions",
  );

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [backendUrl, setBackendUrl] = useState("");

  const modelRoster =
    eventDetail && eventDetail.leaderboard.length > 0
      ? eventDetail.leaderboard.map((r) => r.model_name)
      : lifetimeRoster.map((r) => r.model_name);

  // Each model's real pot for this event -- never a hardcoded $10, since
  // balances carry forward continuously across matches.
  const startingBalances = eventDetail?.starting_balances ?? {};
  function startingBalanceFor(modelName: string): number {
    return startingBalances[modelName] ?? 10;
  }

  // ---- Left panel: chart ----
  const chartLoading = loadingDetail || loadingHistory;
  const chartData =
    liveStatus && liveStatus !== "open"
      ? buildValueChart(
          valueHistory,
          modelRoster,
          startingBalances,
          eventDetail?.event.match_start_time ??
            eventDetail?.event.open_time ??
            null,
        )
      : null;
  let finalChartXLabels = chartData?.xLabels ?? [];
  let finalChartSeries = chartData?.series ?? [];
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
              const { icon, badge } = getModelIcon(m);
              return {
                key: m,
                name: m,
                badge,
                badgeIcon: icon,
                values: [startingBalanceFor(m)],
              };
            }),
          };
    finalChartXLabels = [...base.xLabels, "Final"];
    finalChartSeries = base.series.map((s) => {
      const row = eventDetail.leaderboard.find((r) => r.model_name === s.name);
      const finalValue =
        row?.ending_balance ??
        s.values[s.values.length - 1] ??
        startingBalanceFor(s.name);
      return { ...s, values: [...s.values, finalValue] };
    });
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
  const hasAnyPredictions = (eventDetail?.predictions.length ?? 0) > 0;

  const resolvedRows = (eventDetail?.leaderboard ?? [])
    .slice()
    .sort((a, b) => a.event_rank - b.event_rank)
    .map((row) => ({
      model_name: row.model_name,
      rank: row.event_rank as number | null,
      balance: row.ending_balance ?? row.starting_balance,
      percentChange: row.percent_change,
    }));

  function buildLiveEstimateRow(modelName: string) {
    const series = valueHistory.find((s) => s.model_name === modelName);
    const last = series?.points[series.points.length - 1];
    const starting = startingBalanceFor(modelName);
    const balance = last?.unrealized_balance ?? starting;
    return {
      model_name: modelName,
      rank: null as number | null,
      balance,
      percentChange: ((balance - starting) / starting) * 100,
    };
  }

  const settledModelNames = new Set(resolvedRows.map((r) => r.model_name));
  const pendingRows = Array.from(
    new Set((eventDetail?.predictions ?? []).map((p) => p.model_name)),
  )
    .filter((name) => !settledModelNames.has(name))
    .map(buildLiveEstimateRow);

  // Every model in the lifetime roster should stay selectable (e.g. to copy
  // its system prompt) even if it hasn't placed a prediction in this event
  // yet -- not just the ones with resolved/pending rows.
  const pendingModelNames = new Set(pendingRows.map((r) => r.model_name));
  const notPredictedRows = lifetimeRoster
    .map((row) => row.model_name)
    .filter(
      (name) => !settledModelNames.has(name) && !pendingModelNames.has(name),
    )
    .map(buildLiveEstimateRow);

  function renderModelRow(row: {
    model_name: string;
    rank: number | null;
    balance: number;
    percentChange: number | null;
  }) {
    const { icon, badge } = getModelIcon(row.model_name);
    const positive = (row.percentChange ?? 0) >= 0;
    return (
      <ListRow
        key={row.model_name}
        className="cursor-pointer"
        onClick={() => {
          setSelectedModel(row.model_name);
          setRightMode("model");
          setModelTab("Predictions");
        }}
        logo={
          <div className="flex items-center gap-2">
            {row.rank !== null && (
              <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-neutral-400">
                {row.rank}
              </span>
            )}
            <LlmLogo label={badge} icon={icon} size="sm" />
          </div>
        }
        title={row.model_name}
        subtitle={
          <>
            <span className={cx("font-semibold", deltaColor(positive))}>
              ${row.balance.toFixed(2)}
            </span>{" "}
            &middot;{" "}
            <span className={cx("font-semibold", deltaColor(positive))}>
              {positive ? "+" : ""}
              {(row.percentChange ?? 0).toFixed(1)}%
            </span>
          </>
        }
      />
    );
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
                <Skeleton
                  key={i}
                  className="flex-1"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        ) : detailError ? (
          <p className="text-sm text-error-700">{detailError}</p>
        ) : liveStatus === "open" ? (
          <div className="flex flex-wrap gap-3">
            {lifetimeRoster.map((row) => {
              const { icon, badge } = getModelIcon(row.model_name);
              return (
                <div
                  key={row.model_name}
                  className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2"
                >
                  <LlmLogo label={badge} icon={icon} size="sm" />
                  <div>
                    <div className="text-sm font-semibold tabular-nums text-neutral-900">
                      ${startingBalanceFor(row.model_name).toFixed(2)}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {row.model_name}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : finalChartXLabels.length < 2 ? (
          <p className="text-sm text-neutral-500">
            Not enough live data yet to chart a trend.
          </p>
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
        ) : (
          <div className="flex flex-col gap-5">
            {resolvedRows.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Resolved
                </h3>
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
            {notPredictedRows.length > 0 && (
              <div>
                {hasAnyPredictions && (
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Not yet predicted
                  </h3>
                )}
                <div>{notPredictedRows.map(renderModelRow)}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <Card className="cursor-pointer" onClick={() => setUploadModalOpen(true)}>
        <div className="text-sm font-semibold text-neutral-900">
          Submit predictions
        </div>
        <div className="mt-0.5 text-xs text-neutral-500">
          Drag and drop JSON files for any model
        </div>
      </Card>
    </div>
  );

  // ---- Right panel: Markets mode ----
  // Tracks each model's side too (not just that it predicted) -- two models
  // predicting the same market on opposite sides should never look like a
  // duplicate bet in the market card view.
  const predictedByTicker = new Map<
    string,
    { modelName: string; side: "yes" | "no" }[]
  >();
  eventDetail?.predictions.forEach((p) => {
    if (p.market_ticker.endsWith(LEFTOVER_SUFFIX)) return;
    const list = predictedByTicker.get(p.market_ticker) ?? [];
    if (!list.some((entry) => entry.modelName === p.model_name))
      list.push({ modelName: p.model_name, side: p.side });
    predictedByTicker.set(p.market_ticker, list);
  });
  // "Leftover Capital" is a synthetic markets row predictionsPlace.ts writes
  // to track a model's unstaked bankroll as a virtual prediction (ticker
  // ends in -LEFTOVER, see LEFTOVER_SUFFIX) -- real bookkeeping, not a
  // tradeable market, so it never belongs in this market browser.
  const realMarkets = marketSnapshot.filter(
    (m) => !m.ticker.endsWith(LEFTOVER_SUFFIX),
  );
  // Two permanent sections instead of a toggle: Predicted markets always
  // shown first, then every other market below -- "All" now means "all the
  // rest" so nothing appears twice.
  const predictedMarkets = realMarkets.filter((m) =>
    predictedByTicker.has(m.ticker),
  );
  const otherMarkets = realMarkets.filter(
    (m) => !predictedByTicker.has(m.ticker),
  );

  // Gainers/losers/highest/lowest are individual-market rankings, so they
  // deliberately break out of the prop-family grouping below (a "top
  // gainer" buried inside a 20-row card isn't findable) -- default sort
  // keeps the grouped-by-market card view, everything else flattens. Each
  // section sorts independently (its own dropdown), not holistically.
  function sortMarkets(
    markets: MarketSnapshotRow[],
    sort: MarketSort,
  ): MarketSnapshotRow[] {
    if (sort === "Default") return markets;
    const copy = [...markets];
    switch (sort) {
      case "Top gainers":
        return copy
          .filter((m) => m.change !== null)
          .sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
      case "Top losers":
        return copy
          .filter((m) => m.change !== null)
          .sort((a, b) => (a.change ?? 0) - (b.change ?? 0));
      case "Highest price":
        return copy
          .filter((m) => m.price !== null)
          .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
      case "Lowest price":
        return copy
          .filter((m) => m.price !== null)
          .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
      default:
        return copy;
    }
  }

  // Prop markets under the same sibling event_ticker (e.g. every "Over/Under
  // N corners" threshold under a single "Total Corners" Kalshi event) are
  // really variants of one underlying question, so group by event_ticker and
  // fold every group into a card -- only for the default sort; any ranked
  // sort is a deliberately flat list (see above).
  const titleByEventTicker = new Map(
    (eventDetail?.tickers ?? []).map((t) => [t.event_ticker, t.title]),
  );
  interface MarketGroup {
    key: string;
    title: string | null;
    markets: MarketSnapshotRow[];
  }
  function buildMarketGroups(
    markets: MarketSnapshotRow[],
    sort: MarketSort,
  ): MarketGroup[] {
    if (sort === "Default") {
      const order: string[] = [];
      const groups = new Map<string, MarketSnapshotRow[]>();
      markets.forEach((m) => {
        if (!groups.has(m.event_ticker)) {
          groups.set(m.event_ticker, []);
          order.push(m.event_ticker);
        }
        groups.get(m.event_ticker)!.push(m);
      });
      return order.map((key) => ({
        key,
        title: titleByEventTicker.get(key) ?? null,
        markets: groups.get(key)!,
      }));
    }
    return sortMarkets(markets, sort).map((m) => ({
      key: m.ticker,
      title: null,
      markets: [m],
    }));
  }

  const predictedGroups = buildMarketGroups(predictedMarkets, predictedSort);
  const otherGroups = buildMarketGroups(otherMarkets, allSort);

  // Every market in an event is written by the same live-poller cycle (one
  // shared timestamp per pass, see valuePoller.ts's fetchLiveSidePrices), so
  // a per-row "as of" is the same string repeated 50 times -- surface the
  // freshest one once above both sections instead.
  const latestAsOf = realMarkets.reduce<string | null>(
    (latest, m) =>
      m.as_of && (!latest || m.as_of > latest) ? m.as_of : latest,
    null,
  );

  function renderMarketRow(m: MarketSnapshotRow, showPredictedBadges: boolean) {
    const changeCents = m.change !== null ? Math.round(m.change * 100) : null;
    const positive = (changeCents ?? 0) >= 0;
    const predictedModels = predictedByTicker.get(m.ticker) ?? [];
    // "First" is the earliest priced point this market has in
    // market_price_history -- almost always from ingestion-time candlestick
    // backfill (Kalshi's real history back toward market open), not "the
    // first live poll", since the value poller only starts once a match has
    // begun. Only shown once there are two priced points to compare.
    const firstCents =
      m.history.length > 0 ? Math.round(m.history[0].price * 100) : null;
    const currentCents = m.price !== null ? Math.round(m.price * 100) : null;
    return (
      <div
        key={m.ticker}
        className="flex items-stretch gap-3 border-b border-neutral-100 py-2.5 last:border-b-0"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-900">
            {m.label ?? "Market"}
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            {changeCents !== null &&
            firstCents !== null &&
            currentCents !== null ? (
              <>
                <span>{firstCents}¢</span>
                <span className={cx("text-[8px]", deltaColor(positive))}>▶</span>
                <span className={cx("font-semibold tabular-nums", deltaColor(positive))}>
                  {currentCents}¢
                </span>
              </>
            ) : (
              <span>{currentCents !== null ? `${currentCents}¢` : "—"}</span>
            )}
          </div>
          {showPredictedBadges && predictedModels.length > 0 && (
            <div className="mt-1.5 flex gap-2.5">
              {predictedModels.map(({ modelName, side }) => {
                const { icon, badge } = getModelIcon(modelName);
                return (
                  <div key={modelName} className="flex items-center gap-1">
                    <LlmLogo label={badge} icon={icon} size="sm" />
                    <span
                      className={cx(
                        "text-[9px] font-bold uppercase tracking-wide",
                        side === "yes" ? "text-success-600" : "text-error-600",
                      )}
                    >
                      {side}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Sparkline
            points={m.history.map((h) => h.price)}
            positive={positive}
            className="hidden sm:block"
          />
          {changeCents !== null && (
            <Chip
              variant={positive ? "success" : "error"}
              className="shrink-0 tabular-nums"
            >
              {positive ? "▲" : "▼"} {Math.abs(changeCents)}¢
            </Chip>
          )}
        </div>
      </div>
    );
  }

  function renderMarketSection(
    title: string,
    groups: MarketGroup[],
    sort: MarketSort,
    onSortChange: (sort: MarketSort) => void,
    showPredictedBadges: boolean,
    emptyText: string,
  ) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-neutral-500">{title}</h3>
          <Dropdown
            className="w-40"
            options={MARKET_SORTS.map((s) => ({ label: s, value: s }))}
            value={sort}
            onChange={(v) => onSortChange(v as MarketSort)}
          />
        </div>
        <div className="mt-3">
          {groups.length === 0 ? (
            <p className="text-sm text-neutral-500">{emptyText}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <Card key={group.key} className="p-4">
                  {group.title && (
                    <div className="mb-1.5 truncate text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      {group.title}
                    </div>
                  )}
                  <div>
                    {group.markets.map((m) =>
                      renderMarketRow(m, showPredictedBadges),
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const marketsView = (
    <div>
      {latestAsOf && (
        <p className="text-xs text-neutral-400">
          As of {formatAsOf(latestAsOf)}
        </p>
      )}
      {loadingSnapshot ? (
        <div className="mt-3 flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : snapshotError ? (
        <p className="mt-3 text-sm text-error-700">{snapshotError}</p>
      ) : realMarkets.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">No markets found.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-8">
          {renderMarketSection(
            "Predicted",
            predictedGroups,
            predictedSort,
            setPredictedSort,
            true,
            "No predictions placed yet.",
          )}
          {renderMarketSection(
            "All",
            otherGroups,
            allSort,
            setAllSort,
            false,
            "No other markets found.",
          )}
        </div>
      )}
    </div>
  );

  // ---- Right panel: Model mode ----
  const modelPredictions = (eventDetail?.predictions ?? []).filter(
    (p) =>
      p.model_name === selectedModel &&
      !p.market_ticker.endsWith(LEFTOVER_SUFFIX),
  );
  const allModelPredictions = (eventDetail?.predictions ?? []).filter(
    (p) => p.model_name === selectedModel,
  );
  const labelByTicker = new Map(
    (eventDetail?.markets ?? []).map((m) => [m.ticker, m.label]),
  );
  const startingBalance = selectedModel
    ? startingBalanceFor(selectedModel)
    : 10;
  const realStakedTotal = allModelPredictions
    .filter((p) => !p.market_ticker.endsWith(LEFTOVER_SUFFIX))
    .reduce((sum, p) => sum + p.stake, 0);
  const remainingBankroll = startingBalance - realStakedTotal;
  const settledPredictions = modelPredictions.filter(
    (p) => p.outcome !== "pending",
  );
  const wins = settledPredictions.filter((p) => p.outcome === "win").length;
  const losses = settledPredictions.filter((p) => p.outcome === "loss").length;
  const voids = settledPredictions.filter((p) => p.outcome === "void").length;
  // resolvedRows only contains a model once ALL of its predictions for this
  // event have settled, so presence here doubles as the "fully resolved" check.
  // Before that, fall back to the same live mark-to-market estimate the
  // left-panel model list uses, so this card shows a real current bankroll
  // instead of a dash while a model still has pending bets.
  const resolvedRow = resolvedRows.find((r) => r.model_name === selectedModel);
  const liveRow = selectedModel ? buildLiveEstimateRow(selectedModel) : null;
  const isResultFinal = !!resolvedRow;
  const resultBalance = resolvedRow?.balance ?? liveRow?.balance ?? null;
  const resultPercent = resolvedRow?.percentChange ?? liveRow?.percentChange ?? null;
  const resultPositive = (resultPercent ?? 0) >= 0;

  // Reads the value poller's own persisted number (predictions.live_value)
  // rather than re-deriving an estimate client-side -- this is the exact
  // same figure, from the same poll cycle, that feeds the model's
  // unrealized_balance shown in the left-panel model list/chart, so the two
  // can no longer disagree. Falls back to stake (no gain/loss) only before
  // the poller has ever run for this event.
  function predictionDisplayValue(p: PredictionRow): number {
    if (p.outcome !== "pending") return p.payout ?? 0;
    return p.live_value ?? p.stake;
  }

  const strategy = eventDetail?.strategies.find(
    (s) => s.model_name === selectedModel,
  );

  const modelView = selectedModel && (
    <div>
      <button
        type="button"
        onClick={() => setRightMode("markets")}
        className="mb-4 text-xs font-medium text-neutral-500 hover:text-neutral-800"
      >
        ← Markets
      </button>

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-400">
              Starting bankroll
            </div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-neutral-900">
              ${startingBalance.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-400">
              {isResultFinal ? "Result bankroll" : "Current bankroll"}
            </div>
            {resultBalance !== null ? (
              <div className={deltaColor(resultPositive)}>
                <div className="mt-1 text-3xl font-bold tabular-nums">
                  ${resultBalance.toFixed(2)}
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums">
                  {resultPositive ? "+" : ""}${(resultBalance - startingBalance).toFixed(2)} (
                  {resultPositive ? "+" : ""}
                  {resultPercent!.toFixed(1)}%)
                </div>
              </div>
            ) : (
              <div className="mt-1 text-3xl font-bold tabular-nums text-neutral-300">
                —
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-neutral-100 pt-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Staked
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-700">
              ${realStakedTotal.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Unstaked
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-700">
              ${remainingBankroll.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Bets placed
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-700">
              {modelPredictions.length}
            </div>
          </div>
        </div>

        {settledPredictions.length > 0 && (
          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-400">
              Record
            </div>
            <div className="text-sm font-semibold tabular-nums text-neutral-900">
              <span className="text-success-600">{wins}W</span>
              <span className="text-neutral-300"> · </span>
              <span className="text-error-600">{losses}L</span>
              {voids > 0 && (
                <>
                  <span className="text-neutral-300"> · </span>
                  <span className="text-neutral-500">{voids}V</span>
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      <Toggle
        options={["Predictions", "Strategies"]}
        value={modelTab}
        onChange={(v) => setModelTab(v as "Predictions" | "Strategies")}
      />

      <div className="mt-4">
        {modelTab === "Predictions" ? (
          modelPredictions.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No predictions placed yet.
            </p>
          ) : (
            <div>
              {modelPredictions.map((p) => {
                const value = predictionDisplayValue(p);
                const changePercent = ((value - p.stake) / p.stake) * 100;
                const changePositive = changePercent >= 0;
                return (
                  <div
                    key={p.id}
                    className="border-b border-neutral-100 py-3 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-neutral-900">
                          {labelByTicker.get(p.market_ticker) ?? "Market"}
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-500">
                          {p.side === "yes" ? "Yes" : "No"} &middot; $
                          {p.stake.toFixed(2)} staked
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={cx(
                            "text-sm font-semibold tabular-nums",
                            p.outcome === "pending" ? deltaColor(changePositive) : "text-neutral-900",
                          )}
                        >
                          ${value.toFixed(2)}
                        </div>
                        {p.outcome !== "pending" ? (
                          <Chip
                            variant={outcomeChipVariant(p.outcome)}
                            className="mt-1"
                          >
                            {p.outcome}
                          </Chip>
                        ) : (
                          <div
                            className={cx(
                              "mt-0.5 text-xs font-semibold tabular-nums",
                              deltaColor(changePositive),
                            )}
                          >
                            {changePositive ? "+" : ""}
                            {changePercent.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div>
            <div className="mb-4">
              {strategy?.strategy_headline && (
                <div className="text-sm font-semibold text-neutral-900">
                  {strategy.strategy_headline}
                </div>
              )}
              <p className="mt-1 text-sm text-neutral-600">
                {strategy?.strategy_notes ?? "No strategy notes yet."}
              </p>
            </div>
            <div className="border-t border-neutral-100 pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Bet justifications
              </div>
              {modelPredictions.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  No predictions placed yet.
                </p>
              ) : (
                modelPredictions.map((p) => (
                  <div
                    key={p.id}
                    className="border-b border-neutral-100 py-2.5 last:border-b-0"
                  >
                    <div className="text-sm font-medium text-neutral-900">
                      {labelByTicker.get(p.market_ticker) ?? "Market"}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {p.justification}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Backend URL
              </label>
              <Input
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder={DEFAULT_BACKEND_URL}
              />
            </div>
            <Button
              variant="secondary"
              className="mt-3 w-full justify-center"
              onClick={() =>
                selectedModel && copySystemPrompt(selectedModel, backendUrl)
              }
            >
              {copyStatus === "copied"
                ? "Copied!"
                : copyStatus === "error"
                  ? "Failed to copy"
                  : "Copy system prompt"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const rightTitle =
    rightMode === "model" && selectedModel
      ? (() => {
          const { icon, badge } = getModelIcon(selectedModel);
          return (
            <div className="flex items-center gap-2">
              <LlmLogo label={badge} icon={icon} size="sm" />
              <span>{selectedModel}</span>
            </div>
          );
        })()
      : "Markets";

  const right = rightMode === "model" ? modelView : marketsView;

  const header = (
    <EventHeader
      eventId={eventId}
      event={eventDetail?.event ?? null}
      seriesTickers={(eventDetail?.tickers ?? []).map((t) => t.series_ticker)}
      loading={loadingDetail}
      error={detailError}
    />
  );

  return (
    <>
      <PanelLayout
        header={header}
        rightTitle={rightTitle}
        left={left}
        right={right}
      />

      <Modal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Submit predictions"
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files.length > 0)
              submitFiles(e.dataTransfer.files);
          }}
          className={cx(
            "rounded-lg border-2 border-dashed p-8 text-center",
            isDragging
              ? "border-secondary-500 bg-secondary-50"
              : "border-neutral-200",
          )}
        >
          <p className="text-sm text-neutral-600">
            {uploading
              ? "Uploading..."
              : "Drop one or more prediction JSON files here"}
          </p>
          <p className="mt-1 text-xs text-neutral-400">or</p>
          <label className="mt-2 inline-block cursor-pointer text-sm font-medium text-secondary-600 hover:text-secondary-700">
            Browse files
            <input
              type="file"
              accept=".json,application/json"
              multiple
              disabled={uploading}
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0)
                  submitFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {uploadResults.length > 0 && (
          <div className="mt-4 max-h-48 overflow-y-auto">
            {uploadResults.map((r, i) => (
              <div
                key={i}
                className="flex items-start gap-2 border-b border-neutral-100 py-2 last:border-b-0"
              >
                <Chip variant={r.status === "success" ? "success" : "error"}>
                  {r.status}
                </Chip>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-neutral-900">
                    {r.fileName}
                  </div>
                  <div className="text-xs text-neutral-500">{r.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

export default EventScreen;
