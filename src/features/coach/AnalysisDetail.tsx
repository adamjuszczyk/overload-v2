import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useCoachAnalysisDetail } from './useCoachAnalysis'

// Read-only write-up (COACH-ANALYSIS-TASKS.md §4 step F). Deliberately no
// regenerate and no delete control anywhere on this screen — SPEC §9 rules
// out both; an analysis is a permanent record of what the model said at the
// time, not an editable/regenerable document.

const muted = { color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' } as const

function fmtDate(iso: string): string {
  return format(parseISO(iso), 'MMM d, yyyy').toUpperCase()
}

interface Props {
  analysisId: string
  onBack: () => void
}

export default function AnalysisDetail({ analysisId, onBack }: Props) {
  const navigate = useNavigate()
  const { data: analysis, isLoading, error } = useCoachAnalysisDetail(analysisId)

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

  const { session } = analysis.inputSnapshot

  return (
    <div className="px-4 pt-8 pb-24">
      {backBtn}

      {/* Header */}
      <p className="text-xs font-bold tracking-widest mb-1" style={muted}>
        {fmtDate(session.date)}
      </p>
      <h1
        className="text-2xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        {session.workoutDayName ?? 'SESSION'}
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

      {/* Per-exercise comments */}
      <div className="mt-5 flex flex-col gap-3">
        {analysis.content.exercises.map((ex) => (
          <div
            key={ex.exerciseId}
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
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
