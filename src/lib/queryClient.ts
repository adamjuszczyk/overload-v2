import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60,
      retry: 1,
      // Don't refetch on window focus — user switches apps at the gym constantly
      refetchOnWindowFocus: false,
    },
  },
})
