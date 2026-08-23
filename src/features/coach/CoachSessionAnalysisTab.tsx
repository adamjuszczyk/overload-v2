import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useAnalyzableSessions, useCoachAnalyses, useAnalyzeSession } from './useCoachAnalysis'
import AnalysisDetail from './AnalysisDetail'

// Analysis tab (COACH-ANALYSIS-TASKS.md §4 step F / SPEC §6) — two lists:
// "To analyze" (completed sessions since the ship-date cutoff with no
// analysis row, manual trigger per row) and "Analyses" (the saved
// write-ups, permanent, open any time). Detail view swaps in via local
// state, same pattern HistorySessions.tsx uses for SessionDetail — no new
// route needed. Online-only, same "REQUIRES A CONNECTION" empty state as
// ExerciseHistoryView.tsx/SessionTypeHistoryView.tsx (neither the "To
// analyze" source view nor the analyses table is mirrored in Dexie, and a
// generation is a real network round trip either way).
//
// Body moved verbatim from CoachAnalysisTab.tsx (COACH-WEEK-ANALYSIS-TASKS.md
// §8a) — CoachAnalysisTab.tsx is now the Session/Week sub-tab container;
// this is Session's own content, byte-for-byte, only the export name
// changed. See CONTEXT.md for the regression check confirming this.

const muted = { color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' } as const
const cardStyle = { backgroundColor: 'var(--surface)', border: '1px solid var(--border)' } as const

function fmtDate(iso: string): string {
  return format(parseISO(iso), 'MMM d, yyyy').toUpperCase()
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

export default function CoachSessionAnalysisTab() {
  const isOnline = useOnlineStatus()
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null)

  const { data: analyzable = [], isLoading: isAnalyzableLoading } = useAnalyzableSessions()
  const { data: analyses = [], isLoading: isAnalysesLoading } = useCoachAnalyses()
  const { mutate: analyze, isPending, variables: analyzingSessionId, error } = useAnalyzeSession()

  if (selectedAnalysisId) {
    return <AnalysisDetail analysisId={selectedAnalysisId} onBack={() => setSelectedAnalysisId(null)} />
  }

  // Neither the "To analyze" source view nor the analyses table is mirrored
  // offline (TASKS §1.7 — this feature has no offline requirement), and a
  // generation needs a live round trip regardless — same explicit empty
  // state as the other online-only History views, not a spinner that never
  // resolves.
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
          body="Finish a session and it'll show up here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {analyzable.map((session) => {
            const isThisAnalyzing = isPending && analyzingSessionId === session.id
            const thisFailed = !isPending && analyzingSessionId === session.id && !!error
            return (
              <div key={session.id} className="rounded-xl p-3" style={cardStyle}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold" style={muted}>
                      {fmtDate(session.date)}
                    </p>
                    <p
                      className="text-sm font-bold truncate"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                    >
                      {session.workoutDayName ?? 'SESSION'}
                    </p>
                    <p className="mt-0.5 text-xs" style={muted}>
                      {session.mesocycleName ?? 'NO MESO'}
                      {session.setCount > 0 ? ` · ${session.setCount} SETS` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => analyze(session.id)}
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
          body="Analyze a finished session above to see its write-up here."
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
                {a.sessionDate ? fmtDate(a.sessionDate) : ''}
              </p>
              <p
                className="text-sm font-bold"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                {a.workoutDayName ?? 'SESSION'}
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
