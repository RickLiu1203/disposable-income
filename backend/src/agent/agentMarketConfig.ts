// Allowlist of "core" market concepts per sport/series-family, used by
// agentKalshi.ts to separate a match's headline markets (moneyline, spread,
// total, advance) from its long tail of thin prop-bet siblings. Verified
// against real data: for a World Cup match (KXWCADVANCE/KXWCGAME/
// KXWCSPREAD/KXWCTOTAL) this yields exactly 16 core markets, cleanly
// separated from every prop-grid sibling (anytime goalscorer, correct
// score, etc). Needs a one-time check the first time a non-soccer series is
// ingested -- there is no fallback for an unlisted prefix, every sibling
// from an unrecognized series is treated as a prop.
export const CORE_SERIES_SUFFIXES_BY_PREFIX: Record<string, string[]> = {
  KXWC: ["ADVANCE", "GAME", "SPREAD", "TOTAL"],
};

export function isCoreSeriesTicker(seriesTicker: string): boolean {
  return Object.entries(CORE_SERIES_SUFFIXES_BY_PREFIX).some(
    ([prefix, suffixes]) =>
      seriesTicker.startsWith(prefix) &&
      suffixes.includes(seriesTicker.slice(prefix.length))
  );
}
