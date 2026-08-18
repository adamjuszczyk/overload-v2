import { useState, useEffect } from 'react'
import { format } from 'date-fns'

// A PWA left open on the home screen keeps its JS context across midnight —
// module-level "today" would go stale silently. Refresh on tab focus and at
// the next local midnight so the date never drifts behind the real clock.
// Extracted from TodayPage.tsx (its original, only caller) so other features
// needing "today" as a default (e.g. Coach's date-backfill forms) share the
// same refresh behaviour instead of computing it naively.
export function useToday(): string {
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    const refresh = () => setToday(format(new Date(), 'yyyy-MM-dd'))

    let timeoutId: ReturnType<typeof setTimeout>
    function scheduleMidnightRefresh() {
      const now = new Date()
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
      timeoutId = setTimeout(() => {
        refresh()
        scheduleMidnightRefresh()
      }, nextMidnight.getTime() - now.getTime())
    }
    scheduleMidnightRefresh()

    function handleVisibility() {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return today
}
