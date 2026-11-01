import { useDemo } from '../demo/demoStore'
import { deleteCounts } from '../demo/seed'

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

// Item 8 (b)'s confirmation body (wording agreed 2026-10-29). Coach rows are named only when there are any.
export default function FullDeleteBody({ runId }: { runId: string }) {
  const { online, counting } = useDemo()
  if (!online) return <span>You're offline. Deleting needs a connection.</span>
  if (counting) return <span>Counting what goes…</span>
  const c = deleteCounts(runId)
  const coach = c.coach > 0 ? `, plus ${n(c.coach, 'Coach analysis', 'Coach analyses')}` : ''
  return (
    <span style={{ overflowWrap: 'anywhere' }}>
      Deletes its {n(c.weeks, 'week', 'weeks')}: {n(c.sessions, 'session', 'sessions')} and {n(c.sets, 'logged set', 'logged sets')}{coach}. Its results leave History, Progress and every stat. This can't be undone.
    </span>
  )
}
