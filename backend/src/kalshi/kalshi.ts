const KALSHI_API_BASE = "https://external-api.kalshi.com/trade-api/v2";

export interface KalshiExchangeStatus {
  exchange_active: boolean;
  trading_active: boolean;
  intra_exchange_transfers_active?: boolean;
  exchange_estimated_resume_time?: string;
  exchange_index_statuses?: unknown[];
}

export async function getExchangeStatus(): Promise<KalshiExchangeStatus> {
  const response = await fetch(`${KALSHI_API_BASE}/exchange/status`);

  if (!response.ok) {
    throw new Error(
      `Kalshi exchange status request failed: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as KalshiExchangeStatus;
}
