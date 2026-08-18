// Neutral placeholder for every account except the gated one
// (COACH-ANALYSIS-SPEC.md §3) — no explanation of who Coach is for or why,
// deliberately. Same empty-state card treatment as the offline states
// elsewhere in the app (e.g. ExerciseHistoryView's "REQUIRES A CONNECTION").
export default function CoachLocked() {
  return (
    <div className="px-4 pt-8 pb-12">
      <div
        className="mt-6 rounded-xl p-8 text-center"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p
          className="text-sm font-bold"
          style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
        >
          COACH IS STILL COOKING
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Check back soon.
        </p>
      </div>
    </div>
  )
}
