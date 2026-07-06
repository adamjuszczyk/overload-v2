import { format, parseISO } from 'date-fns'
import type { MissedSession, Mesocycle } from '../../types'
import { useCreateSession, useSkipMissedSession } from './useSession'

interface MissedSessionPromptProps {
  queue: MissedSession[]
  activeMeso: Mesocycle
}

export default function MissedSessionPrompt({ queue, activeMeso }: MissedSessionPromptProps) {
  const createSession = useCreateSession()
  const skipMissed = useSkipMissedSession()

  // Show the most recent missed session first
  const sorted = [...queue].sort((a, b) => b.date.localeCompare(a.date))

  async function handleDoItNow(missed: MissedSession) {
    await createSession.mutateAsync({
      mesoId: activeMeso.id,
      weekPlanId: missed.weekPlan?.id ?? null,
      workoutDayId: missed.workoutDay.id,
      date: missed.date,
    })
  }

  async function handleSkip(missed: MissedSession) {
    await skipMissed.mutateAsync({
      mesoId: activeMeso.id,
      weekPlanId: missed.weekPlan?.id ?? null,
      workoutDayId: missed.workoutDay.id,
      date: missed.date,
      existingSessionId: missed.existingSessionId,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="w-full rounded-t-2xl px-4 pt-4 pb-10"
        style={{ backgroundColor: 'var(--base)', maxHeight: '70dvh', overflowY: 'auto' }}
      >
        <div
          className="mx-auto mb-4 rounded-full"
          style={{ width: 36, height: 4, backgroundColor: 'var(--border-strong)' }}
        />

        <p
          className="text-xs font-bold tracking-widest mb-1"
          style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          MISSED SESSIONS
        </p>
        <h2
          className="text-xl font-black tracking-tight mb-4"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {sorted.length} session{sorted.length > 1 ? 's' : ''} to catch up
        </h2>

        <div className="space-y-3">
          {sorted.map((missed) => (
            <div
              key={missed.date}
              className="rounded-xl p-4"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <p
                className="text-xs font-bold tracking-widest mb-0.5"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {format(parseISO(missed.date), 'EEEE, MMM d').toUpperCase()}
              </p>
              <p
                className="font-black text-base mb-3"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                {missed.workoutDay.name}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => handleDoItNow(missed)}
                  disabled={createSession.isPending || skipMissed.isPending}
                  className="flex-1 py-3 rounded-xl font-black text-sm tracking-wider"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: 'var(--base)',
                    fontFamily: 'var(--font-mono)',
                    opacity: createSession.isPending ? 0.6 : 1,
                  }}
                >
                  DO IT NOW
                </button>
                <button
                  onClick={() => handleSkip(missed)}
                  disabled={createSession.isPending || skipMissed.isPending}
                  className="flex-1 py-3 rounded-xl font-bold text-sm tracking-wider"
                  style={{
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                    opacity: skipMissed.isPending ? 0.6 : 1,
                  }}
                >
                  MARK SKIPPED
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
