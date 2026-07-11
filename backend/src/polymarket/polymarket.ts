const POLYMARKET_CLOB_BASE = "https://clob.polymarket.com";

export interface PolymarketServerTime {
  unixTimestamp: number;
}

export async function getServerTime(): Promise<PolymarketServerTime> {
  const response = await fetch(`${POLYMARKET_CLOB_BASE}/time`);

  if (!response.ok) {
    throw new Error(
      `Polymarket server time request failed: ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();
  return { unixTimestamp: Number(text.trim()) };
}
