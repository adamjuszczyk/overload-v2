import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useCoachMesoAnalysisDetail } from './useCoachMesoAnalysis'
import type { MesoGroupAxis } from '../../types'

// Read-only write-up (MESOCYCLE-ANALYSIS-TASKS.md §7 Phase 6). Mirrors
// WeekAnalysisDetail.tsx/AnalysisDetail.tsx's padding and provenance
// footer. Deliberately no regenerate and no delete control anywhere — same
// SPEC §9 reasoning as daily/weekly: a permanent record of what the model
// said at the time, and this table has no update path at all (§4.2).
//
// Reading order, top-down: SUMMARY (the block-wide headline) →
// SUGGESTIONS (what to carry into next block) → GROUPS (mid-level,
// mechanically bucketed) → PER EXERCISE (every exercise, most granular,
// last). SPEC §4 numbers the layers bottom-up (per-exercise, per-group,
// summary) because that's the order they're *built*; this view orders them
// headline-first, since a whole-meso analysis is rare and dense enough
// (commonly 20+ exercises) that leading with 26 individual comments before
// the synthesis would bury it.

const muted = { color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' } as const
const cardStyle = { backgroundColor: 'var(--surface)', border: '1px solid var(--border)' } as const

function fmtMesoRange(startDate: string, endDate: string | null): string {
  const start = format(parseISO(startDate), 'MMM d, yyyy')
  if (!endDate) return `${start} – ONGOING`
  return `${start} – ${format(parseISO(endDate), 'MMM d, yyyy').toUpperCase()}`
}

function axisTagStyle(axis: MesoGroupAxis) {
  // movement_pattern is visually distinct from the two muscle-based axes
  // (§4.2's "narrower catch layer" — it earns a mention only when it shows
  // something the muscle axis structurally can't), same treatment
  // WeekAnalysisDetail.tsx gives its own analogous 'cross' bucket.
  if (axis === 'movement_pattern') {
    return { backgroundColor: 'var(--accent-muted)', color: 'var(--accent)' }
  }
  return { backgroundColor: 'var(--surface-raised)', color: 'var(--text-muted)' }
}

interface Props {
  analysisId: string
  onBack: () => void
}

export default function MesoAnalysisDetail({ analysisId, onBack }: Props) {
  const navigate = useNavigate()
  const { data: analysis, isLoading, error } = useCoachMesoAnalysisDetail(analysisId)

  const backBtn = (
    <button onClick={onBack} className="flex items-center gap-1.5 mb-6" style={{ color: 'var(--text-muted)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em' }}>← BACK</span>
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

  if (error || !analysis) {
    return (
      <div className="px-4 pt-8 pb-12">
        {backBtn}
        <p style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          FAILED TO LOAD ANALYSIS
        </p>
      </div>
    )
  }

  // Ground truth for exercise names — the input snapshot's own `exercises`
  // array, not the model's `perExercise` output. Every real exercise this
  // analysis saw is in here (mesoAnalysisInput.ts assembles it directly
  // from the database), so a `groups` bucket's exerciseIds can always
  // resolve a real name, the same "ground truth, not model output" choice
  // WeekAnalysisDetail.tsx makes for its own highlight exerciseIds.
  const exerciseNameById = new Map(analysis.inputSnapshot.exercises.map((ex) => [ex.exerciseId, ex.exerciseName]))

  return (
    <div className="px-4 pt-8 pb-24">
      {backBtn}

      {/* Header */}
      <p className="text-xs font-bold tracking-widest mb-1" style={muted}>
        {fmtMesoRange(analysis.mesoStartDate, analysis.mesoEndDate)}
      </p>
      <h1
        className="text-2xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        {analysis.mesoName}
      </h1>

      {/* Summary */}
      <div className="mt-5 rounded-xl p-4" style={cardStyle}>
        <p className="text-xs font-bold tracking-widest mb-2" style={muted}>
          SUMMARY
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {analysis.content.summary}
        </p>
      </div>

      {/* Suggestions */}
      {analysis.content.suggestions.length > 0 && (
        <div className="mt-5 flex flex-col gap-3">
          <p className="text-xs font-bold tracking-widest" style={muted}>
            SUGGESTIONS
          </p>
          {analysis.content.suggestions.map((s, i) => (
            <div key={`${s.area}:${i}`} className="rounded-xl p-4" style={cardStyle}>
              <p
                className="text-xs font-bold tracking-widest mb-1.5"
                style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
              >
                {s.area.toUpperCase()}
              </p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {s.suggestion}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Groups */}
      <div className="mt-5 flex flex-col gap-3">
        <p className="text-xs font-bold tracking-widest" style={muted}>
          GROUPS
        </p>
        {analysis.content.groups.map((g, i) => {
          const realExercises = g.exerciseIds
            .map((id) => ({ id, name: exerciseNameById.get(id) }))
            .filter((e): e is { id: string; name: string } => !!e.name)

          return (
            <div key={`${g.axis}:${g.label}:${i}`} className="rounded-xl p-4" style={cardStyle}>
              <span
                className="inline-block px-1.5 py-0.5 rounded text-xs font-bold tracking-widest mb-1.5"
                style={{ ...axisTagStyle(g.axis), fontFamily: 'var(--font-mono)', fontSize: 9 }}
              >
                {g.label.toUpperCase()}
              </span>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {g.comment}
              </p>
              {realExercises.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {realExercises.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => navigate(`/exercise/${e.id}`)}
                      className="px-2 py-1 rounded-lg text-xs font-bold"
                      style={{
                        backgroundColor: 'var(--surface-raised)',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Per-exercise */}
      <div className="mt-5 flex flex-col gap-3">
        <p className="text-xs font-bold tracking-widest" style={muted}>
          PER EXERCISE
        </p>
        {analysis.content.perExercise.map((ex) => (
          <div key={ex.exerciseId} className="rounded-xl p-4" style={cardStyle}>
            <button
              onClick={() => navigate(`/exercise/${ex.exerciseId}`)}
              className="text-sm font-bold mb-1.5 text-left"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
            >
              {ex.exerciseName}
            </button>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {ex.comment}
            </p>
          </div>
        ))}
      </div>

      {/* Provenance — what generated this row, kept small and observed
          closely per SPEC §1, not hidden away */}
      <p className="mt-6 text-xs" style={muted}>
        {analysis.model} · prompt v{analysis.promptVersion} ·{' '}
        {format(parseISO(analysis.createdAt), 'MMM d, yyyy · h:mm a')}
      </p>
    </div>
  )
}
