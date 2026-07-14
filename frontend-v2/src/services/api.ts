/** Shared success envelope every backend route returns: `{ ok: true, ... }` on
 * success, `{ ok: false, error }` on failure. Throws so callers (TanStack
 * Query hooks) get normal promise-rejection error handling for free. */
export async function apiRequest<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json()
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP error ${res.status}`)
  return data as T
}
