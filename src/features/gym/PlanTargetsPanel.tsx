import type { WeekPlanSet } from '../../types'

export default function PlanTargetsPanel({ plannedSets }: { plannedSets: WeekPlanSet[] }) {
  return (
    <div className="px-3 py-2" style={{ borderRight: '1px solid var(--border)' }}>
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        THIS WEEK
      </p>
      {plannedSets.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          NO PLAN
        </p>
      ) : (
        <div className="space-y-0.5">
          {plannedSets.map((ps) => (
            <div key={ps.id} className="flex items-center gap-1">
              <span
                className="text-xs tabular-nums"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 16 }}
              >
                {ps.setNumber}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {ps.targetRir != null ? `RIR ${ps.targetRir}` : '—'}
              </span>
              {ps.isDropset && (
                <span
                  className="text-xs px-1 rounded"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
                >
                  D
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
