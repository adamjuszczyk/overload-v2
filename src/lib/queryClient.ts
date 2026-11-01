import { MutationCache, QueryClient } from '@tanstack/react-query'
import { APP_STATUS_KEY, isMaintenanceRefusal } from './maintenanceRefusal'

// Annotated: the mutation cache's callback names this client, and an inferred type would depend on itself.
export const queryClient: QueryClient = new QueryClient({
  // Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]; DECISIONS 271). The flag is read at start, in the foreground, every hour and every
  // minute while a gate shows, so a write the database refuses during maintenance (`OL001`) would otherwise fail for up to an hour before the
  // screen came up. Any mutation in the app that is refused that way reads the status again at once, from this one place; the sync queue does the
  // same in its own catch (its writes are not mutations). The refusal is read from `error.code`, never the message.
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isMaintenanceRefusal(error)) void queryClient.invalidateQueries({ queryKey: APP_STATUS_KEY })
    },
  }),
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
