export type LiveEventStatus = "open" | "in_progress" | "completed"

export interface EventTicker {
  event_ticker: string
  series_ticker: string
  title: string
}

export interface MarketRow {
  ticker: string
  label: string | null
}

export interface PredictionRow {
  id: number
  model_name: string
  market_ticker: string
  side: "yes" | "no"
  stake: number
  entry_price: number
  justification: string
  outcome: "pending" | "win" | "loss" | "void"
  payout: number | null
}

export interface LeaderboardRow {
  model_name: string
  starting_balance: number
  ending_balance: number | null
  percent_change: number | null
  event_rank: number
  strategy_notes: string | null
  strategy_headline: string | null
}

export interface StrategyRow {
  model_name: string
  strategy_notes: string
  strategy_headline: string | null
}

export interface EventDetail {
  event: {
    id: string
    event_name: string
    sub_title: string | null
    competition: string | null
    competition_scope: string | null
    live_status: LiveEventStatus
    open_time: string | null
    match_start_time: string | null
  }
  tickers: EventTicker[]
  markets: MarketRow[]
  predictions: PredictionRow[]
  strategies: StrategyRow[]
  leaderboard: LeaderboardRow[]
  starting_balances: Record<string, number>
}

export interface MarketHistoryPoint {
  price: number
  as_of: string
}

export interface MarketSnapshotRow {
  ticker: string
  event_ticker: string
  label: string | null
  price: number | null
  volume: number | null
  as_of: string | null
  history: MarketHistoryPoint[]
  change: number | null
}

export interface LifetimeRosterRow {
  model_name: string
  events_participated: number
  avg_percent_change: number
  total_pnl: number
  total_rewards_earned: number
  lifetime_rank: number
}

export interface EventListRow {
  id: string
  event_name: string
  sub_title: string | null
  competition: string | null
  competition_scope: string | null
  live_status: LiveEventStatus
  market_count: number
  open_time: string | null
  match_start_time: string | null
  created_at: string
}

export interface BalanceHistoryRow {
  event_id: string
  model_name: string
  ending_balance: number | null
}

export interface ValueHistoryPoint {
  snapshot_ts: string
  unrealized_balance: number
}

export interface ValueHistorySeries {
  model_name: string
  points: ValueHistoryPoint[]
}
