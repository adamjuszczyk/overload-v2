import type { CSSProperties } from 'react'
import type { WeightUnit } from '../../types'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { toDisplayWeight } from '../../lib/weightUnit'
import { columnsToRepTarget, formatRepTarget } from '../../lib/plannerVocabulary.js'
import { rirTargetFromColumns } from '../../components/pickers/pickerLogic'
import type { RemovedSet } from './weekPlanning'

// Chunk 54b (replaces chunk 31's WeekDiffMarks; SPEC Weeks and copying [1.2] → Changes since the source: "anything in a week that differs from
// its source is highlighted ... Something removed shows as a dim struck-through line in its place"; board 9). Existing tokens only
// (Escalation 19): what is added or changed is the accent (its text and edge, its muted fill behind); what is removed is the dimmest text
// token, struck through, in a dashed box (board 9).
//
// `data-diff` names what each mark is ("changed" | "added" | "moved" | "removed" | "kind"). It carries no styling: the tests and the browser
// check read the marks through it.

// A cell (weight, reps, RIR) whose value differs from its source: the cell's own look with the accent over its edge and fill, and
// (CHANGED_CELL) its text. Written as longhands: a captured render drops a `border` shorthand with `var()` (RULES).
export const CHANGED_EDGE: CSSProperties = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--accent)',
  background: 'var(--accent-muted)',
}
export const CHANGED_CELL: CSSProperties = { color: 'var(--accent)', ...CHANGED_EDGE }

// A read-only row has no cells to draw an edge on (board 1c, board 11: flat text), so a value that differs is the accent text alone.
export const CHANGED_TEXT: CSSProperties = { color: 'var(--accent)' }

// Dim, struck through: what the week no longer has.
export const REMOVED_TEXT: CSSProperties = { color: 'var(--text-dim)', textDecoration: 'line-through' }

const DASHED: CSSProperties = { borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--border-strong)' }

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * What a removed set held, as board 9 draws it: `03 · 60 kg × 10–12 · RIR 2` (a part it didn't have is left out; a warmup has no RIR, G49).
 * `label` is the number it would show (`03`, `W`, `↳`).
 */
export function removedSetText(removed: RemovedSet, label: string, displayWeight: (kg: number) => string): string {
  const { numbers } = removed
  const reps = columnsToRepTarget(numbers)
  const load: string[] = []
  if (numbers.targetWeight != null) load.push(displayWeight(numbers.targetWeight))
  if (reps.type !== 'none') load.push(formatRepTarget(reps))
  const parts = [label]
  if (load.length > 0) parts.push(load.join(' × '))
  if (!removed.isWarmup && numbers.targetRir != null) {
    const rir = rirTargetFromColumns(numbers.targetRir, numbers.targetRirMax)
    parts.push(`RIR ${rir.kind === 'range' ? `${rir.min}–${rir.max}` : rir.kind === 'number' ? rir.value : '–'}`)
  }
  return parts.join(' · ')
}

/**
 * A set the source has and the week doesn't, in the place the set would be: a dashed box with its number and what it held, struck
 * through. A line of the list, with no controls. `number` is the number the row would carry (`03`; `W` for a warmup; `↳` for a stage).
 */
export function RemovedSetLine({ removed, number, weightUnit }: { removed: RemovedSet; number: number | 'W' | '↳'; weightUnit: WeightUnit | null | undefined }) {
  const { unit } = useWeightDisplay(weightUnit)
  const label = typeof number === 'number' ? pad(number) : number
  const text = removedSetText(removed, label, (kg) => `${toDisplayWeight(kg, unit)} ${unit}`)
  return (
    <div data-diff="removed" style={{ marginLeft: 31, boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, ...DASHED, minWidth: 0 }}>
      <del style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, overflowWrap: 'anywhere', ...REMOVED_TEXT }}>{text}</del>
    </div>
  )
}

/**
 * An exercise the source has and the week doesn't (a swap: directly above the exercise that replaced it): a dashed card with its name
 * struck through and "REMOVED SINCE WEEK 1" (board 9). No controls.
 */
export function RemovedExerciseCard({ name, caption }: { name: string; caption: string }) {
  return (
    <div data-diff="removed" style={{ boxSizing: 'border-box', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, ...DASHED }}>
      <del style={{ fontWeight: 600, fontSize: 15, overflowWrap: 'anywhere', ...REMOVED_TEXT }}>{name}</del>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{caption}</span>
    </div>
  )
}
