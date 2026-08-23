import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useCoachWeekAnalysisDetail } from './useCoachWeekAnalysis'
import type { CoachWeekHighlight } from '../../types'

// Read-only write-up (COACH-WEEK-ANALYSIS-TASKS.md §4 step 8b). Mirrors
// AnalysisDetail.tsx's padding and provenance footer rather than diverging
// — including its pre-existing nested-padding quirk, out of scope to
// change here (TASKS §8b explicit instruction). Deliberately no regenerate
// and no delete control anywhere, same SPEC §9 reasoning as daily: a
// permanent record of what the model said at the time.

const muted = { color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' } as const

function fmtWeekRange(weekStart: string, weekEnd: string): string {
  return `${format(parseISO(weekStart), 'MMM d')} – ${format(parseISO(weekEnd), 'MMM d, yyyy').toUpperCase()}`
}

interface Props {
  analysisId: string
  onBack: () => void
}

function bucketTagStyle(bucketKind: CoachWeekHighlight['bucketKind']) {
  // 'cross' is visually distinct from the two real bucket axes (SPEC §1's
  // cross-bucket pattern, e.g. "compounds down, accessories up") — it
  // didn't come from one mechanical bucket the way muscle_subgroup/
  // movement_pattern highlights did, so it reads differently on purpose.
  if (bucketKind === 'cross') {
    return { backgroundColor: 'var(--accent-muted)', color: 'var(--accent)' }
  }
  return { backgroundColor: 'var(--surface-raised)', color: 'var(--text-muted)' }
}

export default function WeekAnalysisDetail({ analysisId, onBack }: Props) {
  const navigate = useNavigate()
  const { data: analysis, isLoading, error } = useCoachWeekAnalysisDetail(analysisId)

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

  const { week, occurrences } = analysis.inputSnapshot

  // Real exercise ids/names this analysis actually saw — the ground truth
  // every highlight's exerciseIds gets filtered against below. Unlike
  // daily's per-exercise comments (one entry per real exercise, structurally
  // guaranteed by the schema), a weekly highlight's exerciseIds is a
  // free-form array the model populates itself — a hallucinated id here is
  // a real possibility daily's shape doesn't have (TASKS §3.2's own note).
  const exerciseNameById = new Map(occurrences.map((o) => [o.exerciseId, o.exerciseName]))

  return (
    <div className="px-4 pt-8 pb-24">
      {backBtn}

      {/* Header */}
      <p className="text-xs font-bold tracking-widest mb-1" style={muted}>
        {fmtWeekRange(week.weekStart, week.weekEnd)}
      </p>
      <h1
        className="text-2xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        WEEK
      </h1>

      {/* Overall read */}
      <div className="mt-5 rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-bold tracking-widest mb-2" style={muted}>
          OVERALL
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {analysis.content.overall}
        </p>
      </div>

      {/* Highlights */}
      <div className="mt-5 flex flex-col gap-3">
        {analysis.content.highlights.map((h, i) => {
          // Filtered at render time, never allowed to fail the whole view
          // (TASKS §3.2's own note, mirroring AnalysisDetail.tsx's
          // exerciseId deep-link precedent) — a hallucinated id is simply
          // dropped from the link row rather than crashing or showing a
          // broken link.
          const realExercises = h.exerciseIds
            .map((id) => ({ id, name: exerciseNameById.get(id) }))
            .filter((e): e is { id: string; name: string } => !!e.name)

          return (
            <div
              key={`${h.bucketKind}:${h.bucketLabel}:${i}`}
              className="rounded-xl p-4"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <span
                className="inline-block px-1.5 py-0.5 rounded text-xs font-bold tracking-widest mb-1.5"
                style={{ ...bucketTagStyle(h.bucketKind), fontFamily: 'var(--font-mono)', fontSize: 9 }}
              >
                {h.bucketKind === 'cross' ? 'CROSS' : h.bucketLabel.toUpperCase()}
              </span>
              <p
                className="text-sm font-bold mb-1.5"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                {h.headline}
              </p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {h.comment}
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

      {/* Provenance — what generated this row, kept small and observed
          closely per SPEC §1, not hidden away */}
      <p className="mt-6 text-xs" style={muted}>
        {analysis.model} · prompt v{analysis.promptVersion} ·{' '}
        {format(parseISO(analysis.createdAt), 'MMM d, yyyy · h:mm a')}
      </p>
    </div>
  )
}
