import { useState, useEffect, useRef } from 'react'
import { CheckCircle } from 'lucide-react'
import { useCompleteSession, useActiveSession } from './useSession'
import { ENERGY_SCALE, PUMP_SCALE } from './ratingScales'
import RatingChips from './RatingChips'
import type { EnergyRating, PumpRating } from '../../types'

interface SessionCompleteProps {
  sessionId: string
  onBack: () => void
}

export default function SessionComplete({ sessionId, onBack }: SessionCompleteProps) {
  const [note, setNote] = useState('')
  const [energyRating, setEnergyRating] = useState<EnergyRating | null>(null)
  const [pumpRating, setPumpRating] = useState<PumpRating | null>(null)
  const { data: session } = useActiveSession(sessionId)
  const completeSession = useCompleteSession()

  // Prefills from a note saved on a previous completion (e.g. after
  // continuing a session that was already completed once) — but only
  // once, so it never clobbers what the user is actively typing.
  const noteInitialisedRef = useRef(false)
  useEffect(() => {
    if (noteInitialisedRef.current || session?.note == null) return
    noteInitialisedRef.current = true
    setNote(session.note)
  }, [session?.note])

  // Same pattern, same reason (v3 Personalization TASKS §4 item 5) — a
  // reopened, previously-completed session's ratings must prefill rather
  // than silently reset to "not rated" on re-completion.
  const energyInitialisedRef = useRef(false)
  useEffect(() => {
    if (energyInitialisedRef.current || session?.energyRating == null) return
    energyInitialisedRef.current = true
    setEnergyRating(session.energyRating)
  }, [session?.energyRating])

  const pumpInitialisedRef = useRef(false)
  useEffect(() => {
    if (pumpInitialisedRef.current || session?.pumpRating == null) return
    pumpInitialisedRef.current = true
    setPumpRating(session.pumpRating)
  }, [session?.pumpRating])

  const totalSets = session?.setLogs?.filter((l) => !l.isSkipped).length ?? 0
  const skipped = session?.setLogs?.filter((l) => l.isSkipped).length ?? 0

  async function handleComplete() {
    await completeSession.mutateAsync({ id: sessionId, note: note.trim() || null, energyRating, pumpRating })
  }

  return (
    <div className="px-4 pt-8 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <CheckCircle size={28} style={{ color: 'var(--accent)' }} />
        <h1
          className="text-3xl font-black tracking-tight"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          NICE WORK
        </h1>
      </div>

      {/* Stats */}
      <div
        className="rounded-xl p-4 mb-6 grid grid-cols-2 gap-4"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div>
          <p
            className="text-xs font-bold tracking-widest mb-1"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            SETS LOGGED
          </p>
          <p
            className="text-2xl font-black"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
          >
            {totalSets}
          </p>
        </div>
        {skipped > 0 && (
          <div>
            <p
              className="text-xs font-bold tracking-widest mb-1"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              SKIPPED
            </p>
            <p
              className="text-2xl font-black"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {skipped}
            </p>
          </div>
        )}
      </div>

      {/* Energy / pump — optional, logged once at completion (SPEC §4),
          deliberately not per-set like form. */}
      <div className="mb-6 space-y-4">
        <RatingChips scale={ENERGY_SCALE} value={energyRating} onChange={setEnergyRating} label="ENERGY (OPTIONAL)" />
        <RatingChips scale={PUMP_SCALE} value={pumpRating} onChange={setPumpRating} label="PUMP (OPTIONAL)" />
      </div>

      {/* Note */}
      <div className="mb-6">
        <label
          className="block text-xs font-bold tracking-widest mb-2"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          SESSION NOTE (OPTIONAL)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="How did it feel?"
          className="w-full px-3 py-2 rounded-xl text-sm resize-none"
          style={{
            backgroundColor: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            fontFamily: 'var(--font-sans)',
          }}
        />
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          onClick={handleComplete}
          disabled={completeSession.isPending}
          className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--base)',
            fontFamily: 'var(--font-mono)',
            opacity: completeSession.isPending ? 0.6 : 1,
          }}
        >
          {completeSession.isPending ? 'SAVING…' : 'COMPLETE SESSION'}
        </button>

        <button
          onClick={onBack}
          className="w-full py-3 rounded-xl font-bold tracking-widest text-sm"
          style={{
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          BACK TO SESSION
        </button>
      </div>
    </div>
  )
}
