import { useState, useEffect } from "react";
import {
  Search,
  Plus,
  Loader2,
  TrendingUp,
  Activity,
  CheckCircle2,
  AlertCircle,
  FileJson,
  X,
  RefreshCw,
  Coins,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";

// Types matching the backend schema
interface EventListItem {
  id: string; // consolidated parent event_id
  event_name: string;
  sub_title: string | null;
  competition: string | null;
  competition_scope: string | null;
  status: string | null;
  open_time: string | null;
  close_time: string | null;
  created_at: string;
  market_count: number;
  tickers: Array<{
    event_ticker: string;
    series_ticker: string;
    title: string;
  }>;
}

interface MarketRow {
  ticker: string;
  event_ticker: string;
  label: string | null;
  status: string | null;
  result: string | null;
  yes_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  volume_24h: number | null;
  open_interest: number | null;
  open_time: string | null;
  close_time: string | null;
  rules: string | null;
}

interface PricePoint {
  period_end_ts: string;
  period_interval: number;
  price: number | null;
  volume: number | null;
  open_interest: number | null;
}

interface PriceHistorySeries {
  market_ticker: string;
  points: PricePoint[];
}

interface PercentilePoint {
  percentile: number;
  numerical_forecast: number | null;
  raw_numerical_forecast: number | null;
  formatted_forecast: string | null;
}

interface ForecastSnapshot {
  end_period_ts: string;
  period_interval: number;
  percentile_points: PercentilePoint[];
}

interface EventDetail {
  event: {
    id: string;
    event_name: string;
    sub_title: string | null;
    competition: string | null;
    competition_scope: string | null;
    status: string | null;
    open_time: string | null;
    close_time: string | null;
    created_at: string;
  };
  tickers: Array<{
    event_ticker: string;
    series_ticker: string;
    title: string;
  }>;
  markets: MarketRow[];
  priceHistory: PriceHistorySeries[];
  forecastHistory: ForecastSnapshot[];
}

interface IngestResult {
  event_id: string;
  event_ticker: string;
  series_ticker: string;
  markets: number;
  price_history_points: number;
  forecast_percentiles: number;
  partialErrors?: Record<string, string>;
}

export default function App() {
  // Navigation & Lists state
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // Ingestion state
  const [urlInput, setUrlInput] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestSuccess, setIngestSuccess] = useState<IngestResult | null>(null);
  const [ingestAllProps, setIngestAllProps] = useState(false);

  // Detail state
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Settlement state
  const [settling, setSettling] = useState(false);
  const [settleResult, setSettleResult] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Connection status state
  const [backendStatus, setBackendStatus] = useState<
    "connected" | "disconnected" | "checking"
  >("checking");

  // Expanded rules and JSON tabs
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>(
    {},
  );
  const [showRawJson, setShowRawJson] = useState(false);

  // Fetch events list
  const fetchEvents = async (selectTickerAfterFetch?: string) => {
    setLoadingEvents(true);
    setEventsError(null);
    try {
      const res = await fetch("/api/events");
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      if (data.ok) {
        setEvents(data.events);
        if (selectTickerAfterFetch) {
          setSelectedTicker(selectTickerAfterFetch);
        }
      } else {
        throw new Error(data.error || "Failed to fetch events");
      }
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingEvents(false);
    }
  };

  // Check backend connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await fetch("/api/ping-supabase");
        if (res.ok) {
          setBackendStatus("connected");
        } else {
          setBackendStatus("disconnected");
        }
      } catch {
        setBackendStatus("disconnected");
      }
    };
    checkConnection();
    fetchEvents();
  }, []);

  // Fetch event details when selection changes
  useEffect(() => {
    if (!selectedTicker) {
      setDetail(null);
      return;
    }

    const fetchDetail = async () => {
      setLoadingDetail(true);
      setDetailError(null);
      setSettleResult(null);
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedTicker);
        const queryParam = isUuid ? `event_id=${selectedTicker}` : `event_ticker=${selectedTicker}`;
        const res = await fetch(`/api/events/detail?${queryParam}`);
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const data = await res.json();
        if (data.ok) {
          setDetail(data.data);
          // If we resolved by ticker, upgrade state to parent UUID
          if (!isUuid && data.data.event.id) {
            setSelectedTicker(data.data.event.id);
          }
        } else {
          throw new Error(data.error || "Failed to fetch details");
        }
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : "Unknown error");
        setDetail(null);
      } finally {
        setLoadingDetail(false);
      }
    };

    fetchDetail();
  }, [selectedTicker]);

  // Handle event ingestion
  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setIngesting(true);
    setIngestError(null);
    setIngestSuccess(null);

    try {
      const res = await fetch(
        `/api/kalshi/add-event?url=${encodeURIComponent(urlInput.trim())}&ingest_all_props=${ingestAllProps}`,
        {
          method: "POST",
        },
      );
      const data = await res.json();

      if (res.ok && data.ok) {
        setIngestSuccess(data);
        setUrlInput("");
        // Refetch and select the newly ingested event by parent UUID
        await fetchEvents(data.event_id);
      } else {
        // If event already exists, select it and notify
        if (
          res.status === 409 ||
          (data.error && data.error.includes("Event already ingested"))
        ) {
          // Parse ticker from error message: "Event already ingested: TICKER"
          const match = data.error.match(/Event already ingested:\s*(.+)/);
          const existingTicker = match ? match[1].trim() : null;

          if (existingTicker) {
            setIngestError(`Event is already ingested. Selecting it below.`);
            setSelectedTicker(existingTicker);
            // Search might filter it out, so clear search query if needed
            setSearchQuery("");
          } else {
            throw new Error(data.error || "Event already exists");
          }
        } else {
          throw new Error(data.error || "Failed to ingest event");
        }
      }
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setIngesting(false);
    }
  };

  // Handle predictions settlement
  const handleSettle = async () => {
    if (!selectedTicker) return;

    setSettling(true);
    setSettleResult(null);
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedTicker);
      const queryParam = isUuid ? `event_id=${selectedTicker}` : `event_ticker=${selectedTicker}`;
      const res = await fetch(
        `/api/predictions/settle?${queryParam}`,
        {
          method: "POST",
        },
      );
      const data = await res.json();
      if (data.ok) {
        setSettleResult(data.data);
        // Refresh detail to show new status/results
        const detailRes = await fetch(
          `/api/events/detail?${queryParam}`,
        );
        const detailData = await detailRes.json();
        if (detailData.ok) {
          setDetail(detailData.data);
        }
        // Refresh events list to update status badges
        fetchEvents();
      } else {
        alert(`Settlement failed: ${data.error}`);
      }
    } catch (err) {
      alert(
        `Settlement failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSettling(false);
    }
  };

  // Handle event deletion
  const handleDelete = async () => {
    if (!selectedTicker) return;

    const confirmed = window.confirm(
      `Are you sure you want to permanently delete (nuke) this event and ALL of its associated data (predictions, history, results, etc.)? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedTicker);
      const queryParam = isUuid ? `event_id=${selectedTicker}` : `event_ticker=${selectedTicker}`;
      const res = await fetch(
        `/api/events?${queryParam}`,
        {
          method: "DELETE",
        }
      );
      const data = await res.json();
      if (data.ok) {
        alert("Event successfully deleted!");
        setSelectedTicker(null);
        setDetail(null);
        fetchEvents();
      } else {
        alert(`Deletion failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Deletion failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeleting(false);
    }
  };

  const toggleRules = (ticker: string) => {
    setExpandedRules((prev) => ({
      ...prev,
      [ticker]: !prev[ticker],
    }));
  };

  const filteredEvents = events.filter(
    (e) =>
      e.event_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.tickers && e.tickers.some((t) => t.event_ticker.toLowerCase().includes(searchQuery.toLowerCase()))) ||
      (e.competition &&
        e.competition.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const getStatusBadge = (status: string | null) => {
    const s = (status || "").toLowerCase();
    if (s === "open") {
      return (
        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          Open
        </span>
      );
    } else if (s === "settled") {
      return (
        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
          Settled
        </span>
      );
    } else {
      return (
        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
          Closed
        </span>
      );
    }
  };

  return (
    <div className="min-h-screen overflow-y-hidden bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Coins className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Disposable Income
            </h1>
            <p className="text-xs text-slate-500 font-mono">
              Kalshi Event Ingestion Hub
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${backendStatus === "connected" ? "bg-emerald-500 animate-pulse" : backendStatus === "checking" ? "bg-yellow-500" : "bg-rose-500"}`}
            />
            <span className="text-xs text-slate-400 font-mono">
              {backendStatus === "connected"
                ? "DB Connected"
                : backendStatus === "checking"
                  ? "Checking DB..."
                  : "DB Offline"}
            </span>
          </div>
          <button
            onClick={() => fetchEvents()}
            className="p-1.5 rounded-lg hover:bg-slate-900 border border-slate-900 text-slate-400 hover:text-white transition"
            title="Refresh list"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex overflow-hidden max-w-[1600px] mx-auto w-full">
        {/* Left Panel - Ingest & Events List */}
        <section className="w-96 border-r border-slate-900 flex flex-col bg-slate-950/50 shrink-0">
          {/* Ingestion Box */}
          <div className="p-5 border-b border-slate-900">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Ingest Kalshi Event
            </h2>
            <form onSubmit={handleIngest} className="space-y-3">
              <div className="relative">
                <input
                  type="url"
                  placeholder="Paste Kalshi Market URL..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={ingesting}
                  className="w-full pl-3 pr-10 py-2 text-sm bg-slate-900/60 border border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition text-slate-100 placeholder-slate-500 disabled:opacity-55"
                />
                <button
                  type="submit"
                  disabled={ingesting || !urlInput.trim()}
                  className="absolute right-1.5 top-1.5 p-1 rounded bg-purple-600 hover:bg-purple-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition"
                >
                  {ingesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>
              </div>
              <label className="flex items-center space-x-2 text-xs text-slate-400 select-none cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={ingestAllProps}
                  onChange={(e) => setIngestAllProps(e.target.checked)}
                  disabled={ingesting}
                  className="rounded border-slate-800 bg-slate-900 text-purple-600 focus:ring-purple-500/50 focus:ring-offset-slate-950"
                />
                <span>Ingest all sibling props (moneyline, totals, spreads, etc.)</span>
              </label>
            </form>

            {/* Ingestion Statuses */}
            {ingestError && (
              <div className="mt-3 p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start space-x-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{ingestError}</span>
              </div>
            )}
            {ingestSuccess && (
              <div className="mt-3 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-start space-x-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Successfully Ingested!</p>
                  <p className="text-slate-400 mt-0.5">
                    ID:{" "}
                    <code className="text-emerald-300">
                      {ingestSuccess.event_id}
                    </code>
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {ingestSuccess.markets} markets •{" "}
                    {ingestSuccess.price_history_points} price pts
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Search Box */}
          <div className="px-5 py-3 border-b border-slate-900 bg-slate-950/20 flex items-center space-x-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search ingested events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm bg-slate-900/40 border border-slate-800/80 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 transition text-slate-200 placeholder-slate-500"
              />
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-900 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Events List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-900/60 custom-scrollbar">
            {loadingEvents && events.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm flex flex-col items-center justify-center space-y-2">
                <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
                <span>Loading ingested events...</span>
              </div>
            ) : eventsError ? (
              <div className="p-6 text-center text-xs text-rose-400">
                <AlertCircle className="mx-auto h-5 w-5 mb-2 text-rose-500" />
                <span>Failed to load events: {eventsError}</span>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No events found.
              </div>
            ) : (
              filteredEvents.map((evt) => {
                const isSelected = selectedTicker === evt.id;
                const primaryTicker = evt.tickers[0]?.event_ticker || "UNKNOWN";
                return (
                  <button
                    key={evt.id}
                    onClick={() => setSelectedTicker(evt.id)}
                    className={`w-full text-left p-4 hover:bg-slate-900/40 transition flex flex-col space-y-1.5 ${isSelected ? "bg-purple-950/20 border-l-2 border-purple-500" : ""}`}
                  >
                    <div className="flex items-start justify-between space-x-2">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase font-mono tracking-wider">
                        {primaryTicker}
                      </span>
                      {getStatusBadge(evt.status)}
                    </div>
                    <h3 className="font-semibold text-sm text-slate-200 line-clamp-2 leading-snug">
                      {evt.event_name}
                    </h3>
                    {evt.sub_title && (
                      <p className="text-xs text-slate-400 line-clamp-1">
                        {evt.sub_title}
                      </p>
                    )}
                    
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {evt.tickers.map((t) => {
                        const prefix = t.event_ticker.split("-")[0];
                        const label = prefix.startsWith("KXWC") ? prefix.substring(4) : prefix;
                        return (
                          <span key={t.event_ticker} className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[9px] font-mono text-slate-400">
                            {label}
                          </span>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span className="truncate max-w-[180px]">
                        {evt.competition || evt.competition_scope || "General"}
                      </span>
                      <span>
                        {evt.market_count} market
                        {evt.market_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Panel - Event Detail */}
        <section className="flex-1 flex flex-col bg-slate-950 overflow-y-auto">
          {loadingDetail ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-3 p-12">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              <span className="text-slate-400 text-sm">
                Fetching detailed contract and market data...
              </span>
            </div>
          ) : detailError ? (
            <div className="p-8 max-w-lg mx-auto mt-12 bg-rose-950/15 border border-rose-900/30 rounded-xl text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-rose-500 mb-3" />
              <h3 className="font-semibold text-rose-400 mb-1">
                Failed to load event details
              </h3>
              <p className="text-xs text-slate-400 mb-4">{detailError}</p>
              <button
                onClick={() => setSelectedTicker(selectedTicker)}
                className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 rounded-lg text-xs font-semibold border border-rose-500/20 transition"
              >
                Retry Request
              </button>
            </div>
          ) : !detail ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-500">
              <TrendingUp className="h-12 w-12 text-slate-700 mb-3" />
              <h3 className="text-lg font-medium text-slate-400">
                No Event Selected
              </h3>
              <p className="text-sm text-slate-500 max-w-sm mt-1">
                Select an event from the list on the left, or paste a Kalshi URL
                above to ingest a new one.
              </p>
            </div>
          ) : (
            <div className="p-6 md:p-8 space-y-8 max-w-5xl">
              {/* Event Header Card */}
              <div className="p-6 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-900 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold font-mono">
                        Consolidated Match IDs:
                      </span>
                      {detail.tickers.map((t) => (
                        <span key={t.event_ticker} className="text-[11px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono" title={t.title}>
                          {t.event_ticker}
                        </span>
                      ))}
                    </div>
                    <h2 className="text-2xl font-bold text-slate-100 tracking-tight mt-2">
                      {detail.event.event_name}
                    </h2>
                    {detail.event.sub_title && (
                      <p className="text-sm text-slate-400">
                        {detail.event.sub_title}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center space-x-3">
                    {getStatusBadge(detail.event.status)}
                    <button
                      onClick={handleSettle}
                      disabled={settling || detail.event.status === "settled"}
                      className="px-4 py-2 bg-indigo-600/90 hover:bg-indigo-500 disabled:bg-slate-800 text-white disabled:text-slate-500 rounded-lg text-xs font-semibold shadow-lg shadow-indigo-600/10 transition flex items-center space-x-1.5"
                    >
                      {settling ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Settling...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Settle Predictions</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/35 disabled:bg-slate-800 text-rose-400 disabled:text-slate-500 rounded-lg text-xs font-semibold border border-rose-500/20 disabled:border-transparent transition flex items-center space-x-1.5"
                      title="Permanently delete this event and all associated predictions/history from the database"
                    >
                      {deleting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Deleting...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete Event</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Settle feedback */}
                {settleResult && (
                  <div className="p-3.5 rounded bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 space-y-1">
                    <p className="font-semibold">
                      Settlement processed successfully!
                    </p>
                    <p className="text-slate-400">
                      Predictions settled:{" "}
                      <code className="text-blue-300 font-mono font-bold">
                        {settleResult.predictions_settled ?? 0}
                      </code>
                    </p>
                  </div>
                )}

                <hr className="border-slate-900" />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono text-slate-400">
                  <div>
                    <span className="text-slate-600 block mb-0.5">
                      Competition
                    </span>
                    <span className="text-slate-300 truncate block font-sans font-medium">
                      {detail.event.competition || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600 block mb-0.5">Scope</span>
                    <span className="text-slate-300 truncate block font-sans font-medium">
                      {detail.event.competition_scope || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600 block mb-0.5">
                      Trading Opens
                    </span>
                    <span className="text-slate-300 block font-medium">
                      {detail.event.open_time
                        ? new Date(detail.event.open_time).toLocaleString()
                        : "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600 block mb-0.5">
                      Trading Closes
                    </span>
                    <span className="text-slate-300 block font-medium">
                      {detail.event.close_time
                        ? new Date(detail.event.close_time).toLocaleString()
                        : "N/A"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Markets Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                  <div className="flex items-center space-x-2">
                    <Activity className="h-5 w-5 text-purple-400" />
                    <h3 className="text-base font-bold text-slate-200">
                      Nested Markets ({detail.markets.length})
                    </h3>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    POINT-IN-TIME SNAPSHOT AS OF INGESTION
                  </span>
                </div>

                <div className="grid gap-6">
                  {detail.markets.map((m) => {
                    const priceHistoryForMarket = detail.priceHistory.find(
                      (h) => h.market_ticker === m.ticker,
                    );
                    const hasHistory =
                      priceHistoryForMarket &&
                      priceHistoryForMarket.points.length > 0;

                    return (
                      <div
                        key={m.ticker}
                        className="bg-slate-950 border border-slate-900 rounded-xl overflow-hidden hover:border-slate-800 transition"
                      >
                        {/* Market Card Top */}
                        <div className="p-5 flex flex-col md:flex-row md:items-start justify-between gap-4">
                          <div className="space-y-1 max-w-xl">
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono font-semibold">
                                {m.ticker}
                              </span>
                              {m.status && (
                                <span
                                  className={`px-1.5 py-0.5 text-[10px] font-semibold rounded font-mono ${
                                    m.status === "active"
                                      ? "bg-emerald-500/10 text-emerald-400"
                                      : m.status === "settled"
                                        ? "bg-blue-500/10 text-blue-400"
                                        : "bg-slate-800 text-slate-400"
                                  }`}
                                >
                                  {m.status.toUpperCase()}
                                </span>
                              )}
                              {m.result && (
                                <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold rounded font-mono">
                                  RESULT: {m.result.toUpperCase()}
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm font-semibold text-slate-200 mt-2 font-sans">
                              {m.label || "Standard Market Option"}
                            </h4>
                          </div>

                          {/* YES Option Pricing Indicator */}
                          <div className="bg-slate-900/40 border border-slate-900 p-3 rounded-lg flex items-center space-x-4 min-w-[200px] justify-between">
                            <div>
                              <span className="text-[10px] text-slate-500 block">
                                YES PRICE
                              </span>
                              <span className="text-lg font-bold text-white font-mono">
                                {m.yes_price !== null
                                  ? `${(m.yes_price * 100).toFixed(0)}¢`
                                  : "--"}
                              </span>
                            </div>
                            <div className="h-8 border-r border-slate-800" />
                            <div className="text-right">
                              <span className="text-[10px] text-slate-500 block">
                                BID / ASK
                              </span>
                              <span className="text-xs font-mono font-medium text-slate-300">
                                {m.yes_bid !== null
                                  ? `${(m.yes_bid * 100).toFixed(0)}¢`
                                  : "--"}{" "}
                                /{" "}
                                {m.yes_ask !== null
                                  ? `${(m.yes_ask * 100).toFixed(0)}¢`
                                  : "--"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Sparkline & Details Block */}
                        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 border-t border-slate-900/30">
                          {/* Sparkline History */}
                          <div className="md:col-span-2">
                            <span className="text-[10px] text-slate-500 font-mono block mb-2">
                              PRICE TREND
                            </span>
                            {hasHistory ? (
                              <Sparkline
                                points={priceHistoryForMarket!.points}
                              />
                            ) : (
                              <div className="h-[60px] bg-slate-900/20 rounded border border-dashed border-slate-900 flex items-center justify-center text-xs text-slate-600 italic">
                                Price history not available
                              </div>
                            )}
                          </div>

                          {/* Stats Grid */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-[11px] font-mono border-t md:border-t-0 md:border-l border-slate-900/60 pt-4 md:pt-0 md:pl-6">
                            <div>
                              <span className="text-slate-600 block mb-0.5">
                                24h Vol
                              </span>
                              <span className="text-slate-300 font-medium">
                                {m.volume_24h !== null
                                  ? `$${m.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                                  : "--"}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-600 block mb-0.5">
                                Total Vol
                              </span>
                              <span className="text-slate-300 font-medium">
                                {m.volume !== null
                                  ? `$${m.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                                  : "--"}
                              </span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-slate-600 block mb-0.5">
                                Open Interest
                              </span>
                              <span className="text-slate-300 font-medium">
                                {m.open_interest !== null
                                  ? `$${m.open_interest.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                                  : "--"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Expandable Rules */}
                        {m.rules && (
                          <div className="border-t border-slate-900 bg-slate-950/40">
                            <button
                              onClick={() => toggleRules(m.ticker)}
                              className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 transition font-mono"
                            >
                              <span>CONTRACT DETAILS & RULES</span>
                              {expandedRules[m.ticker] ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                            {expandedRules[m.ticker] && (
                              <div className="px-5 pb-4 text-xs text-slate-400 leading-relaxed font-sans max-h-48 overflow-y-auto border-t border-slate-900/50 pt-3">
                                {m.rules}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Forecast History section */}
              {detail.forecastHistory && detail.forecastHistory.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 border-b border-slate-900 pb-2">
                    <TrendingUp className="h-5 w-5 text-indigo-400" />
                    <h3 className="text-base font-bold text-slate-200">
                      Kalshi Forecast Percentiles
                    </h3>
                  </div>

                  <div className="overflow-x-auto border border-slate-900 rounded-xl bg-slate-950">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="bg-slate-900/50 text-slate-400 border-b border-slate-900">
                          <th className="p-3">Timeline (UTC)</th>
                          {/* Extract unique percentiles to draw columns */}
                          {detail.forecastHistory[0].percentile_points.map(
                            (p) => (
                              <th key={p.percentile} className="p-3 text-right">
                                P{(p.percentile / 100).toFixed(0)}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/60 text-slate-300">
                        {detail.forecastHistory.map((snap) => (
                          <tr
                            key={snap.end_period_ts}
                            className="hover:bg-slate-900/20 transition"
                          >
                            <td className="p-3 font-sans">
                              {new Date(snap.end_period_ts).toLocaleString()}
                            </td>
                            {snap.percentile_points.map((pt) => (
                              <td
                                key={pt.percentile}
                                className="p-3 text-right font-medium text-indigo-300"
                              >
                                {pt.formatted_forecast ||
                                  pt.numerical_forecast ||
                                  pt.raw_numerical_forecast ||
                                  "--"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}



              {/* Developer / Debug JSON Section */}
              <div className="space-y-3 pt-6 border-t border-slate-900">
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="flex items-center space-x-2 text-xs font-semibold text-slate-500 hover:text-slate-300 transition uppercase tracking-wider"
                >
                  <FileJson className="h-4 w-4" />
                  <span>
                    {showRawJson ? "Hide" : "Show"} Raw Ingested JSON Payload
                  </span>
                </button>

                {showRawJson && (
                  <pre className="p-4 rounded-xl bg-slate-950 border border-slate-900 text-[11px] font-mono text-slate-400 overflow-x-auto max-h-96 leading-relaxed custom-scrollbar">
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// Sparkline SVG generator for rendering small price trends
function Sparkline({ points }: { points: PricePoint[] }) {
  // Sort points chronologically to draw the path correctly
  const sortedPoints = [...points].sort(
    (a, b) =>
      new Date(a.period_end_ts).getTime() - new Date(b.period_end_ts).getTime(),
  );

  const validPoints = sortedPoints.filter(
    (p) => p.price !== null && p.price !== undefined,
  ) as (PricePoint & { price: number })[];

  if (validPoints.length < 2) {
    return (
      <div className="text-[10px] font-mono text-slate-600 italic py-3">
        Not enough price points for trend
      </div>
    );
  }

  const times = validPoints.map((p) => new Date(p.period_end_ts).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1;

  const width = 320;
  const height = 45;
  const paddingX = 4;
  const paddingY = 6;

  const svgPoints = validPoints.map((p) => {
    const t = new Date(p.period_end_ts).getTime();
    const x = paddingX + ((t - minTime) / timeRange) * (width - 2 * paddingX);
    // Price range is 0 to 1 (dollars). Invert Y.
    const y = height - paddingY - p.price * (height - 2 * paddingY);
    return { x, y, price: p.price, time: p.period_end_ts };
  });

  const pathD =
    `M ${svgPoints[0].x} ${svgPoints[0].y} ` +
    svgPoints
      .slice(1)
      .map((p) => `L ${p.x} ${p.y}`)
      .join(" ");
  const areaD = `${pathD} L ${svgPoints[svgPoints.length - 1].x} ${height} L ${svgPoints[0].x} ${height} Z`;

  // Draw gradient id uniquely to avoid collisions if multiple charts render
  const gradId = `sparkline-grad-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="flex items-center space-x-4">
      <div className="flex-1">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c084fc" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Area fill under curve */}
          <path d={areaD} fill={`url(#${gradId})`} />
          {/* Main trend line */}
          <path
            d={pathD}
            fill="none"
            stroke="#a78bfa"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Start and end points */}
          <circle
            cx={svgPoints[0].x}
            cy={svgPoints[0].y}
            r="2.5"
            fill="#818cf8"
          />
          <circle
            cx={svgPoints[svgPoints.length - 1].x}
            cy={svgPoints[svgPoints.length - 1].y}
            r="3"
            fill="#c084fc"
            stroke="#1e1b4b"
            strokeWidth="1"
          />
        </svg>
      </div>
      <div className="flex flex-col text-[10px] text-slate-500 font-mono text-right shrink-0 border-l border-slate-900/60 pl-3">
        <span>Start: {(validPoints[0].price * 100).toFixed(0)}¢</span>
        <span>
          End: {(validPoints[validPoints.length - 1].price * 100).toFixed(0)}¢
        </span>
        <span className="text-[9px] text-slate-600 mt-0.5">
          {validPoints.length} pts
        </span>
      </div>
    </div>
  );
}
