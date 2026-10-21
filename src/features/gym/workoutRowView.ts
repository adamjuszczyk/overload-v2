// Chunk 58a — what the workout's rows say, as pure functions (boards W1–W3b; SPEC [1.2] "What a row shows (C3)", DECISIONS 162).
// The rows themselves come from `workoutRules.ts` (`resolveRows`); the plan's targets and last time's numbers are read here.
import type { SetLog, WeekPlanSet, WeightUnit } from '../../types'
import { columnsToRepTarget, formatRepTarget, STAGE_KIND_LABELS, type StageKind } from '../../lib/plannerVocabulary.js'
import { toDisplayWeight } from '../../lib/weightUnit'
import type { ResolvedRow } from './workoutRules'

type Targets = Pick<WeekPlanSet, 'targetWeight' | 'repMin' | 'repMax' | 'isAmrap' | 'targetRir' | 'targetRirMax'>

/** The planned RIR as a row shows it: "1", or "1–2" for a range (SPEC C3: "a range shows as 1–2"); '' when the plan has none. */
export function rirTargetText(planned: Pick<WeekPlanSet, 'targetRir' | 'targetRirMax'> | null): string {
  if (planned == null || planned.targetRir == null) return ''
  const high = planned.targetRirMax
  return high != null && high !== planned.targetRir ? `${planned.targetRir}–${high}` : String(planned.targetRir)
}

/** The planned reps as a row shows them: "8", "8–10", "AMRAP"; '' with no target. */
export function repTargetText(planned: Pick<WeekPlanSet, 'repMin' | 'repMax' | 'isAmrap'> | null): string {
  if (planned == null) return ''
  const target = columnsToRepTarget({ repMin: planned.repMin ?? null, repMax: planned.repMax ?? null, isAmrap: planned.isAmrap ?? false })
  return target.type === 'none' ? '' : formatRepTarget(target)
}

/**
 * What a current row's boxes hold before anyone types (DECISIONS 162 (a), Adam 2026-10-16): "An untouched row's values are the
 * plan's targets; a range or AMRAP is a placeholder, so LOG needs reps typed; with no planned weight the weight box is empty and
 * LOG needs it." `weight` is the plan's weight in the exercise's unit, `reps` a plan's single number; a range or AMRAP is only
 * `repsHint`, and so is the planned RIR (`rirHint`, a dim placeholder). Last time's numbers are never a value (pre-fill is phase 2).
 */
export function rowDefaults(planned: Targets | null, unit: WeightUnit): { weight: string; reps: string; repsHint: string; rirHint: string } {
  const text = repTargetText(planned)
  const isNumber = planned != null && !planned.isAmrap && planned.repMin != null && planned.repMin === planned.repMax
  return {
    weight: planned?.targetWeight != null ? String(toDisplayWeight(planned.targetWeight, unit)) : '',
    reps: isNumber ? text : '',
    repsHint: isNumber ? '' : text,
    rirHint: rirTargetText(planned),
  }
}

/** An upcoming row, targets only: "52.5 kg × 8–10 @ RIR 1–2" (parts the plan doesn't give are left out). */
export function targetsText(planned: Targets | null, unit: WeightUnit): string {
  if (planned == null) return ''
  const parts: string[] = []
  const reps = repTargetText(planned)
  if (planned.targetWeight != null) parts.push(`${toDisplayWeight(planned.targetWeight, unit)} ${unit}`)
  if (reps !== '') parts.push(parts.length > 0 ? `× ${reps}` : reps)
  const rir = rirTargetText(planned)
  return rir === '' ? parts.join(' ') : `${parts.join(' ')} @ RIR ${rir}`.trim()
}

/** A logged row: "55 kg × 9 @ RIR 2" as parts, in the unit the set was logged in. */
export function loggedText(log: Pick<SetLog, 'weight' | 'reps' | 'rir' | 'enteredUnit'>, resolvedUnit: WeightUnit): { weight: string; unit: WeightUnit; reps: string; rir: string } {
  const unit = log.enteredUnit ?? resolvedUnit
  return {
    weight: log.weight != null ? String(toDisplayWeight(log.weight, unit)) : '—',
    unit,
    reps: log.reps != null ? String(log.reps) : '—',
    rir: log.rir != null ? `@ RIR ${log.rir}` : '',
  }
}

/** The row's LAST line (board W1): "52.5 × 10 @ 1", from last time's set at the same place, in the exercise's unit; '' with none. */
export function lastLineText(last: Pick<SetLog, 'weight' | 'reps' | 'rir' | 'enteredUnit'> | null | undefined, resolvedUnit: WeightUnit): string {
  if (last == null || last.weight == null || last.reps == null) return ''
  const unit = last.enteredUnit ?? resolvedUnit
  return `${toDisplayWeight(last.weight, unit)} × ${last.reps}${last.rir != null ? ` @ ${last.rir}` : ''}`
}

/** A staged head's chip (board W3): "DROPSET · 2 DROPS", "REST-PAUSE · 2 STAGES". */
export function stageChipText(stageKind: StageKind, count: number): string {
  const word = stageKind === 'dropset' ? 'DROP' : 'STAGE'
  return `${STAGE_KIND_LABELS[stageKind]} · ${count} ${word}${count === 1 ? '' : 'S'}`
}

/** The kind word on a logged drop (board W3): DROP, REST-PAUSE, MYO-REPS, CLUSTER. */
export function stageKindWord(stageKind: StageKind | null): string {
  return stageKind === null || stageKind === 'dropset' ? 'DROP' : STAGE_KIND_LABELS[stageKind]
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** A time as the workout's boards write it: "1:12", "0:48", "2:00" (the rest bar, a superset's rest, TIMING). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`
}

/** What a row's number cell says: "03", "A2" (a superset member: letter and round), "W" (a warmup), "↳" (a drop). */
export function rowLabelText(row: Pick<ResolvedRow, 'kind' | 'number' | 'block'>): string {
  if (row.kind === 'stage') return '↳'
  if (row.kind === 'warmup') return 'W'
  return row.block ? `${row.block.letter}${row.block.round}` : pad2(row.number)
}

/** The jump button's words: "SET 03", "A2", "SET 03 DROP 1". */
export function jumpLabelText(row: Pick<ResolvedRow, 'kind' | 'number' | 'block' | 'stageKind' | 'stageNumber'>): string {
  const head = row.block ? `${row.block.letter}${row.block.round}` : `SET ${pad2(row.number)}`
  return row.kind === 'stage' ? `${head} ${row.stageKind === null || row.stageKind === 'dropset' ? 'DROP' : 'STAGE'} ${row.stageNumber}` : head
}

/**
 * A drop row is locked until the row before it is logged (SPEC "Planned staged sets render (fix)": "each locked until the stage
 * before it is logged"; board W3): its head, or the drop before it. `rows` are the card's rows in order.
 */
export function stageLock(row: ResolvedRow, rows: readonly ResolvedRow[]): string | null {
  if (row.kind !== 'stage' || row.state !== 'unlogged') return null
  const head = rows.find((r) => r.key === row.headKey)
  if (head === undefined) return null
  if (row.stageNumber === 1) return head.state === 'unlogged' ? `AFTER SET ${pad2(head.number)}` : null
  const before = rows.find((r) => r.headKey === row.headKey && r.stageNumber === row.stageNumber! - 1)
  if (before === undefined || before.state !== 'unlogged') return null
  return `AFTER ${row.stageKind === null || row.stageKind === 'dropset' ? 'DROP' : 'STAGE'} ${row.stageNumber! - 1}`
}
