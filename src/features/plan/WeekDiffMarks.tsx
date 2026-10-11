import type { CSSProperties } from 'react'
import type { WeightUnit } from '../../types'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { toDisplayWeight } from '../../lib/weightUnit'
import { columnsToRepTarget, formatRepTarget } from '../../lib/plannerVocabulary.js'
import type { RemovedSet } from './weekDiff'

// Chunk 31 (SPEC Plan screen [P1.1]: "Anything different from the week's source is
// highlighted"; "Something removed shows as a dim struck-through line in its
// place") — the marks PlanPage draws from weekDiff.ts's result. Existing tokens
// only (Escalation 19): what is added or changed is the accent (its text and edge,
// its muted fill behind — how the page's active controls already look, e.g. the
// SETS / STRUCTURE switch and ADD SET); what is removed is the dimmest text token,
// struck through. A mark adds style or an element only where something differs, so
// a week with nothing to flag renders exactly what it did before this chunk.
//
// `data-diff` names what each mark is ("changed" | "added" | "moved" | "removed" |
// "kind"). It carries no styling: the tests and the browser check read the marks
// through it.

// A cell (weight, reps, RIR) whose value differs from its source: the cell's own
// look with the accent over its edge and fill, and (CHANGED_CELL) its text.
export const CHANGED_EDGE: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-muted)',
}
export const CHANGED_CELL: CSSProperties = { color: 'var(--accent)', ...CHANGED_EDGE }

// An added or moved exercise's header band.
export const CHANGED_BAND: CSSProperties = { background: 'var(--accent-muted)' }

// Dim, struck through: what the week no longer has.
export const REMOVED_TEXT: CSSProperties = { color: 'var(--text-dim)', textDecoration: 'line-through' }

const pad = (n: number) => String(n).padStart(2, '0')

// STRUCTURE: an exercise the source has and the week doesn't — its name, dim and
// struck through, in its place in the list (a swap: directly above the exercise
// that replaced it). A line of the list, so it carries the divider an exercise
// section does.
export function RemovedExerciseLine({ name, isLast }: { name: string; isLast: boolean }) {
  return (
    <div data-diff="removed" style={{ padding: '10px 16px', borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)' }}>
      <del style={{ fontWeight: 700, fontSize: 14, ...REMOVED_TEXT }}>{name}</del>
    </div>
  )
}

// SETS: a working set the source has and the week doesn't — its number, and the
// numbers it held (weight, reps, RIR; only those it had), dim and struck through,
// in the place the set would be. A row of the list: the number column of a real
// row, no controls.
export function RemovedSetRow({ removed, weightUnit }: { removed: RemovedSet; weightUnit: WeightUnit | null | undefined }) {
  const { unit } = useWeightDisplay(weightUnit)
  const { numbers } = removed
  const reps = columnsToRepTarget(numbers)
  const parts: string[] = []
  if (numbers.targetWeight != null) parts.push(`${toDisplayWeight(numbers.targetWeight, unit)}${unit}`)
  if (reps.type !== 'none') parts.push(formatRepTarget(reps))
  let text = parts.join(' × ')
  if (!removed.isWarmup && numbers.targetRir != null) text = `${text}${text ? '  ' : ''}RIR ${numbers.targetRir}`
  return (
    <div data-diff="removed" style={{ display: 'flex', alignItems: 'center', padding: '3px 16px', gap: 6 }}>
      <span style={{ width: 22, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, flexShrink: 0, ...REMOVED_TEXT }}>
        {pad(removed.ordinal)}
      </span>
      <del style={{ minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, ...REMOVED_TEXT }}>{text}</del>
    </div>
  )
}

// STRUCTURE: a warmup set, or a stage, the source has and the week doesn't — its
// number (↳ on a stage) and what it was, dim and struck through.
export function RemovedStructureRow({ removed }: { removed: RemovedSet }) {
  const isStage = removed.stageIndex !== null
  return (
    <div data-diff="removed" style={{ display: 'flex', alignItems: 'center', padding: '3px 16px', gap: 6 }}>
      <span style={{ width: 22, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, flexShrink: 0, ...REMOVED_TEXT }}>
        {isStage ? '↳' : pad(removed.ordinal)}
      </span>
      <del style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', ...REMOVED_TEXT }}>
        {isStage ? 'STAGE' : 'WARMUP'}
      </del>
    </div>
  )
}
