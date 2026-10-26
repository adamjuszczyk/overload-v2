// Chunk 61 — what the set ⋯ sheet (W7, W8), the edit panel (W2b) and the delete confirm (W9) say, as pure functions. The rows themselves
// come from `workoutRules.ts` (`resolveRows`); the plan's targets and a log's numbers are read here the way the rows read them
// (`workoutRowView.ts`). The words are the boards': "LAT PULLDOWN · SET 03", "Dropset · 1 drop", "Delete set 03?", "52.5 kg × 8–10. Only
// today's session changes; the plan stays the same."
import type { SessionSetChangeType, SetLog, WeekPlanSet, WeightUnit } from '../../types'
import { STAGE_KIND_LABELS } from '../../lib/plannerVocabulary.js'
import { toDisplayWeight } from '../../lib/weightUnit'
import { rowLabel, type ResolvedRow } from './workoutRules'
import { repTargetText } from './workoutRowView'

type NamedRow = Pick<ResolvedRow, 'kind' | 'number' | 'block' | 'stageKind' | 'stageNumber' | 'exerciseName'>

const pad2 = (n: number): string => String(n).padStart(2, '0')
const stageWord = (row: Pick<ResolvedRow, 'stageKind'>): string => (row.stageKind === null || row.stageKind === 'dropset' ? 'DROP' : 'STAGE')

/**
 * The sheet's eyebrow: "LAT PULLDOWN · SET 03" (board W7), "LAT PULLDOWN · SET 03 · DROP 1" for a drop (W8), the member's name in a superset as
 * the log lock's question names it ("SEATED CABLE ROW · A2", board W7b), and "… · WARMUP". Provisional under D31 where no board draws it
 * (a drop in a superset, a warmup).
 */
export function optionsEyebrow(row: NamedRow): string {
  const name = row.exerciseName.toUpperCase()
  if (row.kind === 'warmup') return `${name} · WARMUP`
  const head = row.block ? `${row.block.letter}${row.block.round}` : `SET ${pad2(row.number)}`
  return row.kind === 'stage' ? `${name} · ${head} · ${stageWord(row)} ${row.stageNumber}` : `${name} · ${head}`
}

/** The SET TYPE row's value (board W7): "Normal", "Warmup", "Dropset · 1 drop", "Rest-pause · 2 stages". */
export function typeRowText(type: SessionSetChangeType | null): string {
  if (type === null || type.kind === 'normal') return 'Normal'
  if (type.kind === 'warmup') return 'Warmup'
  const label = STAGE_KIND_LABELS[type.stageKind]
  const word = type.stageKind === 'dropset' ? 'drop' : 'stage'
  return `${label.charAt(0)}${label.slice(1).toLowerCase()} · ${type.stageCount} ${word}${type.stageCount === 1 ? '' : 's'}`
}

type Targets = Pick<WeekPlanSet, 'targetWeight' | 'repMin' | 'repMax' | 'isAmrap'>

/** The plan's numbers as the confirm says them, no RIR: "52.5 kg × 8–10"; "" when the plan gives none. */
export function plannedNumbersText(planned: Targets | null, unit: WeightUnit): string {
  if (planned == null) return ''
  const parts: string[] = []
  const reps = repTargetText(planned)
  if (planned.targetWeight != null) parts.push(`${toDisplayWeight(planned.targetWeight, unit)} ${unit}`)
  if (reps !== '') parts.push(parts.length > 0 ? `× ${reps}` : reps)
  return parts.join(' ')
}

/** A log's numbers as the confirm says them: "52.5 kg × 10", in the unit it was logged in; "" for a skipped set. */
export function loggedNumbersText(log: Pick<SetLog, 'weight' | 'reps' | 'enteredUnit' | 'isSkipped'>, resolvedUnit: WeightUnit): string {
  if (log.isSkipped || log.weight == null || log.reps == null) return ''
  const unit = log.enteredUnit ?? resolvedUnit
  return `${toDisplayWeight(log.weight, unit)} ${unit} × ${log.reps}`
}

export const DELETE_NOTE = "Only today's session changes; the plan stays the same."

/**
 * Board W9: "Delete set 03?" over "52.5 kg × 8–10. Only today's session changes; the plan stays the same." A staged head says its drops go with
 * it (SPEC 18b: "Deleting a staged set's head deletes its stages, and the confirm says so"; TASKS 61: "… and its drop"). The drops counted are
 * the ones the row has, logged or still to log, since all of them go. Provisional under D31 where the board draws no such case: the wording of
 * the head variant, a drop's title, a warmup's and a skipped set's, which has no numbers to say.
 */
export function deleteConfirm(row: NamedRow & Pick<ResolvedRow, 'type'>, numbers: string): { eyebrow: string; title: string; body: string } {
  const drops = row.kind !== 'stage' && row.type?.kind === 'staged' ? row.type.stageCount : 0
  const word = row.type?.kind === 'staged' && row.type.stageKind !== 'dropset' ? 'stage' : 'drop'
  const withDrops = drops === 0 ? '' : drops === 1 ? ` and its ${word}` : ` and its ${drops} ${word}s`
  const said = drops === 0 ? numbers : `${numbers === '' ? 'This set' : numbers}${withDrops}`
  return {
    eyebrow: optionsEyebrow(row),
    title: `Delete ${rowLabel(row)}?`,
    body: said === '' ? DELETE_NOTE : `${said}. ${DELETE_NOTE}`,
  }
}

/** Chunk 63 (TASKS 63: 'disabled with "Log its drops first"'; SPEC 18c: "UNLOG is disabled and says so"): the words under the edit panel's UNLOG while a later drop of the set is logged. D31: TASKS' words, as written. */
export const UNLOG_BLOCKED_NOTE = 'Log its drops first'
