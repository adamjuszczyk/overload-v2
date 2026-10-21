// Chunk 58a — the rows that are neither logged nor current (boards W1, W2, W3, W3b): an upcoming row shows its targets only, with no
// inputs (SPEC [1.2] "Row states": "upcoming → targets only"; chunk 60 makes every row typable), a drop waits locked until the row
// before it is logged (board W3: "AFTER SET 03"), and a skipped set is a dashed "SKIPPED" line (board W3b).
import { Lock } from 'lucide-react'
import type { WeekPlanSet, WeightUnit } from '../../types'
import type { ResolvedRow } from './workoutRules'
import { CueLine, LastLine, RowLabel, rowFrame } from './setRowParts'
import { rowLabelText, targetsText } from './workoutRowView'

const MONO = 'var(--font-mono)'
const dashed = { borderWidth: 1, borderStyle: 'dashed' as const, borderColor: 'var(--border)' }

export function SetRowUpcoming({ row, planned, unit, lastLine }: { row: ResolvedRow; planned: WeekPlanSet | null; unit: WeightUnit; lastLine: string }) {
  const targets = targetsText(planned, unit)
  const hasCue = (planned?.tags?.length ?? 0) > 0
  return (
    <div className="space-y-1" data-row-key={row.key} data-row-state="upcoming">
      <div style={rowFrame({ backgroundColor: 'var(--surface)', opacity: 0.8 })}>
        <RowLabel text={rowLabelText(row)} />
        <span className="flex-1 text-sm" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>
          {targets === '' ? '—' : targets}
        </span>
      </div>
      <CueLine tags={planned?.tags} compact={hasCue} />
      <LastLine text={lastLine} />
    </div>
  )
}

/** A drop that waits for the row before it (`lock`: "AFTER SET 03", "AFTER DROP 1"): the same row, nothing in it can fire. */
export function SetRowLocked({ row, planned, unit, lock }: { row: ResolvedRow; planned: WeekPlanSet | null; unit: WeightUnit; lock: string }) {
  const targets = targetsText(planned, unit)
  return (
    <div style={rowFrame({ ...dashed })} data-row-key={row.key} data-row-state="locked">
      <RowLabel text={rowLabelText(row)} />
      <span className="flex-1 text-sm font-bold" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>
        {targets === '' ? '—' : targets}
      </span>
      <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--text-muted)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em' }}>
        <Lock size={11} />
        {lock}
      </span>
    </div>
  )
}

export function SetRowSkipped({ row }: { row: ResolvedRow }) {
  return (
    <div style={rowFrame({ ...dashed })} data-row-key={row.key} data-row-state="skipped">
      <RowLabel text={rowLabelText(row)} />
      <span className="text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>
        SKIPPED
      </span>
    </div>
  )
}
