import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useAnalyzableWeeks, useCoachWeekAnalyses, useAnalyzeWeek } from './useCoachWeekAnalysis'
import WeekAnalysisDetail from './WeekAnalysisDetail'

// Week sub-tab (COACH-WEEK-ANALYSIS-TASKS.md §4 step 8b / SPEC §6) — same
// shape as CoachSessionAnalysisTab.tsx, nothing new invented at this layer:
// "To analyze" (complete weeks since the ship-date cutoff with no analysis
// row, manual trigger per row) and "Analyses" (the saved write-ups,
// permanent, open any time). Same online-only empty state, same
// detail-view-via-local-state pattern.

const muted = { color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' } as const
const cardStyle = { backgroundColor: 'var(--surface)', border: '1px solid var(--border)' } as const

function fmtWeekRange(weekStart: string, weekEnd: string): string {
  return `${format(parseISO(weekStart), 'MMM d')} – ${format(parseISO(weekEnd), 'MMM d, yyyy').toUpperCase()}`
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div
        className="w-5 h-5 rounded-full animate-spin"
        style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
      />
    </div>
  )
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl p-6 text-center" style={cardStyle}>
      <p className="text-sm font-bold" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
        {title}
      </p>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        {body}
      </p>
    </div>
  )
}

export default function CoachWeekAnalysisTab() {
  const isOnline = useOnlineStatus()
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null)

  const { data: analyzable = [], isLoading: isAnalyzableLoading } = useAnalyzableWeeks()
  const { data: analyses = [], isLoading: isAnalysesLoading } = useCoachWeekAnalyses()
  const { mutate: analyze, isPending, variables: analyzingWeekStart, error } = useAnalyzeWeek()

  if (selectedAnalysisId) {
    return <WeekAnalysisDetail analysisId={selectedAnalysisId} onBack={() => setSelectedAnalysisId(null)} />
  }

  if (!isOnline) {
    return (
      <div className="mt-6">
        <EmptyCard
          title="REQUIRES A CONNECTION"
          body="Coach analysis isn't cached offline — reconnect to use it."
        />
      </div>
    )
  }

  return (
    <div className="mt-6">
      {/* To analyze */}
      <p className="text-xs font-bold tracking-widest mb-3" style={muted}>
        TO ANALYZE
      </p>
      {isAnalyzableLoading ? (
        <Spinner />
      ) : analyzable.length === 0 ? (
        <EmptyCard
          title="NOTHING TO ANALYZE"
          body="A week becomes available once every session in it is completed or skipped."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {analyzable.map((week) => {
            const isThisAnalyzing = isPending && analyzingWeekStart === week.weekStart
            const thisFailed = !isPending && analyzingWeekStart === week.weekStart && !!error
            return (
              <div key={week.weekStart} className="rounded-xl p-3" style={cardStyle}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold" style={muted}>
                      {fmtWeekRange(week.weekStart, week.weekEnd)}
                    </p>
                    <p
                      className="text-sm font-bold truncate"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                    >
                      {week.mesocycleName ?? 'NO MESO'}
                    </p>
                    <p className="mt-0.5 text-xs" style={muted}>
                      {week.expectedSessionCount} SESSION{week.expectedSessionCount === 1 ? '' : 'S'}
                    </p>
                  </div>
                  <button
                    onClick={() => analyze(week.weekStart)}
                    disabled={isPending}
                    className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold"
                    style={{
                      backgroundColor: 'var(--accent)',
                      color: 'var(--base)',
                      fontFamily: 'var(--font-mono)',
                      opacity: isPending && !isThisAnalyzing ? 0.4 : 1,
                    }}
                  >
                    {isThisAnalyzing ? 'ANALYZING…' : 'ANALYZE'}
                  </button>
                </div>
                {thisFailed && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--error)' }}>
                    {(error as Error).message}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Analyses */}
      <p className="mt-8 text-xs font-bold tracking-widest mb-3" style={muted}>
        ANALYSES
      </p>
      {isAnalysesLoading ? (
        <Spinner />
      ) : analyses.length === 0 ? (
        <EmptyCard
          title="NO ANALYSES YET"
          body="Analyze a complete week above to see its write-up here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {analyses.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedAnalysisId(a.id)}
              className="w-full text-left rounded-xl p-3"
              style={cardStyle}
            >
              <p className="text-xs font-bold" style={muted}>
                {fmtWeekRange(a.weekStart, a.weekEnd)}
              </p>
              <p className="mt-1 text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                {a.overall}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
