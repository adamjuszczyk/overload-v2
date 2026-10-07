import type { WeekPlanSet, WeightUnit } from '../../types'
import { groupWeekPlanSets } from './setGroupLogic'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'

// Heads only, one row per set — a dropset's stage rows are never their own
// top-level entry (§2.7 item 7); a "+N" badge summarises how many stages the
// set has instead of listing each one, since this panel is a compact
// side-by-side column, not a full walkthrough (see PreviewExerciseCard.tsx
// for the fuller nested rendering).
export default function PlanTargetsPanel({
  plannedSets,
  weightUnit,
}: {
  plannedSets: WeekPlanSet[]
  // Chunk 19 (SPEC "Targets" — "PlanTargetsPanel shows weight targets
  // alongside RIR"). Optional/omittable — every caller before this chunk
  // predates it (same "may not exist yet" fallback convention as the rest
  // of this build); resolves the same way SetRow.tsx's own resolvedUnit
  // does (per-exercise override, else the global Settings default).
  weightUnit?: WeightUnit | null
}) {
  const { toDisplay, unit } = useWeightDisplay(weightUnit)
  // Chunk 15 (SPEC "Warmup sets" — "never counted in ... set counts"): a
  // warmup never has an RIR target by design (SPEC: "weight and reps ...
  // plus a rest timer. Nothing else"), so showing one here would read as a
  // working set missing a target rather than what it is — filtered out,
  // same as a stage already is structurally (groupWeekPlanSets never
  // surfaces a stage as its own row either).
  const groups = groupWeekPlanSets(plannedSets)
    .filter((g) => !g.head.isWarmup)
    .sort((a, b) => a.head.setNumber - b.head.setNumber)

  return (
    <div className="px-3 py-2" style={{ borderRight: '1px solid var(--border)' }}>
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        PLANNED RIR
      </p>
      {groups.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          NO PLAN
        </p>
      ) : (
        <div className="space-y-0.5">
          {groups.map(({ head, stages }) => (
            <div key={head.id} className="flex items-center gap-1">
              <span
                className="text-xs tabular-nums"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 16 }}
              >
                {head.setNumber}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {head.targetRir != null ? `RIR ${head.targetRir}` : '—'}
              </span>
              {/* Weight target (chunk 19) — alongside RIR, same row. No
                  placeholder when absent (unlike RIR's own "—" above, an
                  established, unchanged convention this chunk doesn't
                  touch): every set before this chunk has no target_weight
                  at all, so this must add nothing here for that case —
                  "no label, no placeholder, no empty element" (D30). */}
              {head.targetWeight != null && (
                <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {toDisplay(head.targetWeight)}{unit}
                </span>
              )}
              {stages.length > 0 && (
                <span
                  className="text-xs px-1 rounded"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
                >
                  +{stages.length}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
