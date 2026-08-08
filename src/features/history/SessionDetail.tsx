import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useHistoryDetail, useDeleteSession } from './useHistory'
import type { HistorySetRow } from './historyService'
import { formatRestTime } from '../../lib/formatRestTime'
import type { MuscleGroup } from '../../types'

const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: 'CHEST', back: 'BACK', shoulders: 'SHOULDERS',
  biceps: 'BICEPS', triceps: 'TRICEPS', forearms: 'FOREARMS',
  quads: 'QUADS', hamstrings: 'HAMS', glutes: 'GLUTES',
  calves: 'CALVES', core: 'CORE', other: 'OTHER',
}

const STATUS_STYLE = {
  completed:   { bg: 'rgba(74, 222, 128, 0.12)',  color: 'var(--success)', label: 'COMPLETED' },
  skipped:     { bg: 'rgba(248, 113, 113, 0.12)', color: 'var(--error)',   label: 'SKIPPED' },
  in_progress: { bg: 'var(--accent-muted)',        color: 'var(--accent)',  label: 'IN PROGRESS' },
  planned:     { bg: 'var(--surface-raised)',      color: 'var(--text-muted)', label: 'PLANNED' },
} as const

interface Props {
  sessionId: string
  onBack: () => void
}

export default function SessionDetail({ sessionId, onBack }: Props) {
  const navigate = useNavigate()
  const { data: session, isLoading, error } = useHistoryDetail(sessionId)
  const { mutate: deleteSession, isPending: isDeleting } = useDeleteSession()
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleDelete() {
    deleteSession(sessionId, { onSuccess: () => onBack() })
  }

  const backBtn = (
    <button
      onClick={onBack}
      className="flex items-center gap-1.5 mb-6"
      style={{ color: 'var(--text-muted)' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em' }}>
        ← BACK
      </span>
    </button>
  )

  if (isLoading) {
    return (
      <div className="px-4 pt-8 pb-12">
        {backBtn}
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full animate-spin"
            style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
          />
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="px-4 pt-8 pb-12">
        {backBtn}
        <p style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          FAILED TO LOAD SESSION
        </p>
      </div>
    )
  }

  const ss = STATUS_STYLE[session.status as keyof typeof STATUS_STYLE] ?? STATUS_STYLE.planned

  return (
    <div className="px-4 pt-8 pb-24">
      {backBtn}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <p
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
          }}
        >
          {format(parseISO(session.date), 'EEEE, MMM d yyyy').toUpperCase()}
        </p>
        <span
          className="px-2 py-0.5 rounded-md text-xs font-bold shrink-0"
          style={{
            backgroundColor: ss.bg,
            color: ss.color,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
          }}
        >
          {ss.label}
        </span>
      </div>

      {/* VIEW ALL is gated on workoutDayId, not on whether the name resolved
          (found by adversarial review) — the name comes from a separate,
          non-transactional lookup (fetchHistoryDetail), so a session whose
          workout day was deleted in between would otherwise lose the link
          along with the name even though the route still works fine. */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <h1
          className="text-2xl font-black tracking-tight"
          style={{
            color: session.workoutDayName ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {session.workoutDayName ?? 'SESSION'}
        </h1>
        {session.workoutDayId && (
          <button
            onClick={() => navigate(`/session-type/${session.workoutDayId}`)}
            className="shrink-0 text-xs font-bold tracking-widest"
            style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
          >
            VIEW ALL →
          </button>
        )}
      </div>

      {session.mesocycleName && (
        <p
          className="mt-1 text-xs"
          style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
        >
          {session.mesocycleName}
        </p>
      )}

      {/* Note */}
      {session.note && (
        <div
          className="mt-4 px-4 py-3 rounded-xl"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {session.note}
          </p>
        </div>
      )}

      {/* Exercise groups */}
      {session.exerciseGroups.length === 0 ? (
        <div
          className="mt-6 rounded-xl p-8 text-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p
            className="text-sm font-bold"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            NO SETS LOGGED
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {session.exerciseGroups.map(group => (
            <div
              key={group.exerciseId}
              className="rounded-xl overflow-hidden"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              {/* Exercise header */}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <p
                  className="text-sm font-bold"
                  style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                >
                  {group.exerciseName}
                </p>
                <span
                  className="px-2 py-0.5 rounded text-xs font-bold shrink-0 ml-2"
                  style={{
                    backgroundColor: 'var(--surface-raised)',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.06em',
                  }}
                >
                  {MUSCLE_LABEL[group.muscleGroup] ?? group.muscleGroup?.toUpperCase() ?? 'OTHER'}
                </span>
              </div>

              {/* Set groups — each head, then its stages nested beneath it
                  (§2.7 item 6): a drop stage is never its own top-level row. */}
              {group.sets.map((setGroup, i) => (
                <div key={setGroup.head.id} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                  <HistorySetRowView set={setGroup.head} />
                  {setGroup.stages.map((stage) => (
                    <HistorySetRowView key={stage.id} set={stage} isStage />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Delete session */}
      <div className="mt-8">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full py-3 rounded-xl text-sm font-bold"
            style={{
              backgroundColor: 'rgba(248, 113, 113, 0.08)',
              border: '1px solid rgba(248, 113, 113, 0.25)',
              color: 'var(--error)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em',
            }}
          >
            DELETE SESSION
          </button>
        ) : (
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'rgba(248, 113, 113, 0.06)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
            }}
          >
            <p
              className="text-sm font-bold mb-1"
              style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)' }}
            >
              DELETE SESSION?
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
              This will permanently delete this session and all its set logs. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                style={{
                  backgroundColor: 'var(--surface-raised)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                CANCEL
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                style={{
                  backgroundColor: 'rgba(248, 113, 113, 0.15)',
                  color: 'var(--error)',
                  fontFamily: 'var(--font-mono)',
                  opacity: isDeleting ? 0.5 : 1,
                }}
              >
                {isDeleting ? 'DELETING...' : 'CONFIRM DELETE'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Set row ──────────────────────────────────────────────────────────────────
// A single historical row — a head (numbered) or a nested stage (indented,
// STAGE label, no number of its own — it shares its head's set_number).

function HistorySetRowView({ set, isStage = false }: { set: HistorySetRow; isStage?: boolean }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{ paddingLeft: isStage ? 40 : undefined }}
    >
      {/* Set label */}
      <span
        className="w-7 text-xs font-bold shrink-0"
        style={{
          color: set.isSkipped ? 'var(--text-dim)' : 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {isStage ? 'STAGE' : set.setNumber}
      </span>

      {set.isSkipped ? (
        <span
          className="flex-1 text-xs"
          style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          SKIPPED
        </span>
      ) : (
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Weight × reps — no underline */}
          <span
            className="text-sm font-bold"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
          >
            {set.weight !== null ? set.weight : '—'}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{' × '}</span>
            {set.reps !== null ? set.reps : '—'}
          </span>

          {/* RIR */}
          {set.rir !== null && (
            <span
              className="text-xs shrink-0"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              RIR {set.rir}
            </span>
          )}

          {/* Rest (right-aligned) */}
          {set.restSeconds !== null && (
            <span
              className="text-xs ml-auto shrink-0"
              style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
            >
              {formatRestTime(set.restSeconds)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
