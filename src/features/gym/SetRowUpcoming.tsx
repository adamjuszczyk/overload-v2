// Chunk 58a — the rows that can't be typed into (boards W3, W3b): a drop waits locked until the row before it is logged (board W3: "AFTER SET
// 03"), and a skipped set is a dashed "SKIPPED" line. The upcoming row that used to be here, targets only, went in chunk 60: "every row can
// be typed into" (SPEC [1.2] "Log lock (18a)"; board W1), so every other open row is `SetRowCurrent`'s too.
// Chunk 61: a skipped row has a ⋯ with DELETE SET (SPEC 18b: "Logged and unlogged sets"; closing F4's "can't delete a skipped set"): the set was
// settled, so there is nothing else in it to choose.
import { useState } from 'react'
import { Lock, MoreVertical } from 'lucide-react'
import type { WeekPlanSet, WeightUnit } from '../../types'
import type { ResolvedRow } from './workoutRules'
import SetOptionsSheet from './SetOptionsSheet'
import { RowLabel, rowFrame } from './setRowParts'
import { optionsEyebrow } from './setOptionsView'
import { rowLabelText, targetsText } from './workoutRowView'

const MONO = 'var(--font-mono)'
const dashed = { borderWidth: 1, borderStyle: 'dashed' as const, borderColor: 'var(--border)' }

/** A drop that waits for the row before it (`lock`: "AFTER SET 03", "AFTER DROP 1"): the same row, nothing in it can fire. */
export function SetRowLocked({ row, planned, unit, lock }: { row: ResolvedRow; planned: WeekPlanSet | null; unit: WeightUnit; lock: string }) {
  const targets = targetsText(planned, unit)
  return (
    <div style={rowFrame({ ...dashed })} data-row-key={row.key} data-row-state="locked">
      <RowLabel text={rowLabelText(row)} />
      <span className="flex-1 font-bold" style={{ minWidth: 0, color: 'var(--text-muted)', fontFamily: MONO, fontSize: 13 }}>
        {targets === '' ? '—' : targets}
      </span>
      <span className="flex items-center gap-1 flex-shrink-0 font-bold whitespace-nowrap" style={{ color: 'var(--text-muted)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em' }}>
        <Lock size={11} />
        {lock}
      </span>
    </div>
  )
}

export function SetRowSkipped({ row, onDelete }: { row: ResolvedRow; onDelete: () => void }) {
  const [showMore, setShowMore] = useState(false)
  return (
    <div style={rowFrame({ ...dashed })} data-row-key={row.key} data-row-state="skipped">
      <RowLabel text={rowLabelText(row)} />
      <span className="flex-1 text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>
        SKIPPED
      </span>
      <button
        type="button"
        onClick={() => setShowMore(true)}
        className="flex-shrink-0 flex items-center justify-center"
        style={{ width: 28, height: 44, color: 'var(--text-muted)' }}
        aria-label="Set options"
        aria-expanded={showMore}
      >
        <MoreVertical size={16} />
      </button>
      {showMore && (
        <SetOptionsSheet
          eyebrow={optionsEyebrow(row)}
          typeText={null}
          cuesText={null}
          onCues={() => {}}
          form={null}
          unit={null}
          onSkip={null}
          onDelete={() => {
            setShowMore(false)
            onDelete()
          }}
          onClose={() => setShowMore(false)}
        />
      )}
    </div>
  )
}
