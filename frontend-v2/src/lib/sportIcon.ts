import { Goal, Trophy, type LucideIcon } from "lucide-react"

export type SportType = "soccer" | "unknown"

// Same KXWC prefix convention agentMarketConfig.ts uses to recognize the
// soccer World Cup series -- there's no dedicated sport column anywhere in
// the schema, so the series_ticker prefix is the only signal available.
// Needs a one-time check the first time a non-soccer series is ingested.
const SOCCER_SERIES_PREFIXES = ["KXWC"]

export function detectSport(seriesTickers: string[]): SportType {
  const isSoccer = seriesTickers.some((ticker) =>
    SOCCER_SERIES_PREFIXES.some((prefix) => ticker.startsWith(prefix)),
  )
  return isSoccer ? "soccer" : "unknown"
}

export function getSportIcon(sport: SportType): LucideIcon {
  return sport === "soccer" ? Goal : Trophy
}
