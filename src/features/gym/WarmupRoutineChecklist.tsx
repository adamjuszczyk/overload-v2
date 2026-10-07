import { useEffect } from 'react'
import { Square, CheckSquare } from 'lucide-react'
import { useWarmupRoutineItems } from '../programs/usePrograms'
import { useWarmupRoutineStore } from './warmupRoutineStore'

// A stable, shared reference for "no ticks loaded yet" — zustand's selector
// below must return the SAME object on every call for the same state, or
// React's useSyncExternalStore (what zustand's hook is built on) logs
// "getSnapshot should be cached" and can re-render in a loop. A fresh `{}`
// literal inline in the selector would be a different reference every call.
const EMPTY_TICKED: Record<string, boolean> = {}

// Chunk 18 (SPEC.md "Warmup routine": "Per workout, in the program: a
// checklist shown at the top of the session. Items are ticked off; nothing
// else is logged."). Sits above the first exercise card or superset block
// (GymSession.tsx) — the run copy's own v2_workout_warmup_items for this
// session's workout, in saved order, each with a tick.
//
// Online-only read, same posture as every other program/run read on this
// screen (useProgramExercises/useSupersetBlockRests/useProgramSets all
// share this — CONTEXT.md's offline list is useLogSet/useCreateSession/
// useCompleteSession/useSkipSession only). Offline, this query simply has
// no data: TanStack Query serves whatever it already cached for this
// workout day from earlier in the session if anything, or nothing at all.
// Either way `items` below defaults to `[]`, which renders exactly like "no
// warmup routine saved" — never an error, never a loading spinner that gets
// stuck (no retry UI here at all, deliberately: this is a nice-to-have
// checklist, not a blocking read the rest of the session depends on).
//
// D30: with no items, NOTHING renders — no heading, no empty element, no
// container `<div>` — so a plain session (every fixture/test predating this
// chunk, which has no v2_workout_warmup_items row at all) is byte-identical
// to before this chunk existed.
export default function WarmupRoutineChecklist({
  sessionId,
  workoutDayId,
}: {
  sessionId: string
  workoutDayId: string
}) {
  const { data: items = [] } = useWarmupRoutineItems(workoutDayId)
  const load = useWarmupRoutineStore((s) => s.load)
  const ticked = useWarmupRoutineStore((s) => s.bySession[sessionId] ?? EMPTY_TICKED)
  const toggle = useWarmupRoutineStore((s) => s.toggle)

  // Hydrates this session's own ticks from localStorage once per mount —
  // in an effect, never during render (warmupRoutineStore.ts's own header
  // comment on why). Re-runs if sessionId itself ever changes (it doesn't,
  // in practice, for a mounted GymSession, but this keeps the hook honest).
  useEffect(() => {
    load(sessionId)
  }, [sessionId, load])

  if (items.length === 0) return null

  return (
    <div className="px-4 mb-4">
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <span
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            WARMUP ROUTINE
          </span>
        </div>
        <div className="px-4 py-1">
          {items.map((item, index) => {
            const isTicked = !!ticked[item.id]
            return (
              <button
                key={item.id}
                onClick={() => toggle(sessionId, item.id)}
                className="w-full flex items-center gap-3"
                style={{
                  minHeight: 44,
                  background: 'transparent',
                  border: 'none',
                  borderTop: index === 0 ? 'none' : '1px solid var(--border-subtle)',
                  textAlign: 'left',
                  padding: '10px 0',
                }}
              >
                {isTicked ? (
                  <CheckSquare size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                ) : (
                  <Square size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                )}
                <span
                  className="flex-1 text-sm"
                  style={{
                    color: isTicked ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: isTicked ? 'line-through' : 'none',
                  }}
                >
                  {item.body}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
