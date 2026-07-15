import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Default was 0 -- every remount (e.g. navigating MainScreen ->
      // EventScreen -> back) triggered a fresh background refetch even
      // though cached data was already on screen. 30s is well under the
      // value poller's own ~5min cadence, so this never shows stale
      // live-match data, but makes ordinary back-and-forth navigation
      // instant instead of re-hitting the network every time.
      staleTime: 30_000,
    },
  },
})
