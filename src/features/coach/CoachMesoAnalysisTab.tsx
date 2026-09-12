import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useAnalyzableMesos, useCoachMesoAnalyses, useAnalyzeMeso } from './useCoachMesoAnalysis'
import MesoAnalysisDetail from './MesoAnalysisDetail'

// Meso sub-tab (MESOCYCLE-ANALYSIS-TASKS.md §7 Phase 6 / §9) — same shape as
// CoachWeekAnalysisTab.tsx: "To analyze" (completed mesos with no analysis
// row yet, manual trigger per row) and "Analyses" (the saved write-ups,
// permanent, open any time). Same online-only empty state, same
// detail-view-via-local-state pattern. Unlike Week's analyzable-week
// resolution (weekResolution.ts's own completeness computation), a meso's
// eligibility is just its own `status` column (§4.1) — no separate
// completeness logic needed on this side, so "to analyze" is simply every
// completed meso without an existing analysis row (useCoachMesoAnalysis.ts's
// fetchAnalyzableMesos).

const muted = { color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' } as const
const cardStyle = { backgroundColor: 'var(--surface)', border: '1px solid var(--border)' } as const

function fmtMesoRange(startDate: string, endDate: string | null): string {
  const start = format(parseISO(startDate), 'MMM d, yyyy')
  // Defensive only — §4.1 confirms both completion paths always write
  // `end_date` alongside `status`, so a completed meso reaching this list
  // without one would be a real anomaly, not the expected shape.
  if (!endDate) return `${start} – ONGOING`
  return `${start} – ${format(parseISO(endDate), 'MMM d, yyyy').toUpperCase()}`
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

export default function CoachMesoAnalysisTab() {
  const isOnline = useOnlineStatus()
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null)

  const { data: analyzable = [], isLoading: isAnalyzableLoading } = useAnalyzableMesos()
  const { data: analyses = [], isLoading: isAnalysesLoading } = useCoachMesoAnalyses()
  const { mutate: analyze, isPending, variables: analyzingMesoId, error } = useAnalyzeMeso()

  if (selectedAnalysisId) {
    return <MesoAnalysisDetail analysisId={selectedAnalysisId} onBack={() => setSelectedAnalysisId(null)} />
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
          body="A mesocycle becomes available here once you mark it complete."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {analyzable.map((meso) => {
            const isThisAnalyzing = isPending && analyzingMesoId === meso.id
            const thisFailed = !isPending && analyzingMesoId === meso.id && !!error
            return (
              <div key={meso.id} className="rounded-xl p-3" style={cardStyle}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold" style={muted}>
                      {fmtMesoRange(meso.startDate, meso.endDate)}
                    </p>
                    <p
                      className="text-sm font-bold truncate"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                    >
                      {meso.name}
                    </p>
                  </div>
                  <button
                    onClick={() => analyze(meso.id)}
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
          body="Analyze a complete mesocycle above to see its write-up here."
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
                {fmtMesoRange(a.mesoStartDate, a.mesoEndDate)}
              </p>
              <p
                className="text-sm font-bold truncate"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                {a.mesoName}
              </p>
              <p className="mt-1 text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                {a.summary}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
