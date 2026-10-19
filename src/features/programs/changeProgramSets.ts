import {
  STAGE_KIND_LABELS,
  columnsToRepTarget,
  formatRepTarget,
  repTargetToColumns,
  resolveStageKind,
  type RepTarget,
} from '../../lib/plannerVocabulary.js'
import { formatRestClock, type SetType } from '../../components/pickers/pickerLogic'
import { addSetDefaults } from '../plan/weekPlanning'
import type { DraftSet, DraftStage } from './programChange'

// Chunk 51b (TASKS-1.2, CHANGE THE PROGRAM on a stable run; SPEC Programs and runs → "Stable: it also shows the default's sets, as rows:
// set number (opens the set type picker), rep target (opens the rep target picker; ALL sets every set of the exercise), rest after the
// set, and '+ SET'. A set is removed from the set type picker's REMOVE THIS SET (PL1b)"). Pure: the default's sets of one exercise
// as `planProgramChange` takes them (`DraftSet`, chunk 45) and what the screen needs to draw and to edit them. Nothing here writes;
// the draft (`changeProgramDraft.ts`) keeps the result and SAVE hands it to `planProgramChange`, which lands it on the sessions that
// still match the old default.
//
// The set type picker (chunk 39) speaks `SetType`; a default's set is `isWarmup`, `stageKind` and its stages. One mapping, here, each
// way (RULES.md: the first writer of a picked type defines the mapping once and every later writer uses it; Checks that lied #15).

type RepFields = Pick<DraftSet, 'repMin' | 'repMax' | 'isAmrap'>

/** A set (or a stage) as the rep target picker reads it. */
export function repTargetOf(s: RepFields): RepTarget {
  return columnsToRepTarget({ repMin: s.repMin, repMax: s.repMax, isAmrap: s.isAmrap })
}

/** The set (or stage) with this rep target, the other fields as they were. */
export function withRepTarget<T extends RepFields>(s: T, target: RepTarget): T {
  return { ...s, ...repTargetToColumns(target) }
}

/** What a rep box reads: `8–10`, `12`, `AMRAP`; a set with no target shows a dash (`none` is never printed, RULES.md). */
export function repText(target: RepTarget): string {
  return target.type === 'none' ? '—' : formatRepTarget(target)
}

/**
 * The set's type as the picker holds it. A head with stages is staged, whatever kind it was stored with (a null kind reads as a
 * dropset, DECISIONS 105); a stage kind on a head with no stages shows nowhere, so that set is a Normal one.
 */
export function setTypeOf(set: DraftSet): SetType {
  if (set.isWarmup) return { kind: 'warmup' }
  if (set.stages.length > 0) {
    return { kind: 'staged', stageKind: resolveStageKind(set.stageKind), stageCount: set.stages.length, stageRestSeconds: set.stageRestSeconds }
  }
  return { kind: 'normal' }
}

const newStage = (): DraftStage => ({ id: null, repMin: null, repMax: null, isAmrap: false })

/**
 * The set with the type the picker asks for (SPEC: "Picking a staged kind adds its first stage ... Switching back to Normal or Warmup
 * removes the stages. A warmup can never be staged"). A staged type keeps the stages the set has, up to the count, and a new stage
 * starts with no rep target of its own (the planner's `addProgramSetStage` does the same); fewer stages drops the last ones.
 * Normal and Warmup leave no stage kind and no rest between stages behind. The rep target and the rest after the set stay.
 */
export function withSetType(set: DraftSet, type: SetType): DraftSet {
  switch (type.kind) {
    case 'normal':
      return { ...set, isWarmup: false, stageKind: null, stageRestSeconds: null, stages: [] }
    case 'warmup':
      return { ...set, isWarmup: true, stageKind: null, stageRestSeconds: null, stages: [] }
    case 'staged': {
      const stages = Array.from({ length: type.stageCount }, (_, i) => set.stages[i] ?? newStage())
      return { ...set, isWarmup: false, stageKind: type.stageKind, stageRestSeconds: type.stageRestSeconds, stages }
    }
  }
}

/** The label on a set's rep box: WARMUP, or the kind and how many stages (`DROPSET · 1`, board PL1b); none for a Normal set. */
export function kindText(set: DraftSet): string | null {
  const type = setTypeOf(set)
  if (type.kind === 'warmup') return 'WARMUP'
  if (type.kind === 'staged') return `${STAGE_KIND_LABELS[type.stageKind]} · ${type.stageCount}`
  return null
}

/** What ALL reads: the rep target every set has, `MIXED` when they differ (a warmup counts: ALL sets it too), a dash when none has one. */
export function allText(sets: readonly DraftSet[]): string {
  const texts = sets.map((s) => repText(repTargetOf(s)))
  return texts.every((t) => t === texts[0]) ? (texts[0] ?? '—') : 'MIXED'
}

/** The REST AFTER stepper's reading: the chain (the exercise's rest, then the global one) until the set has a rest of its own. */
export function restAfterText(seconds: number | null): string {
  return seconds === null ? 'CHAIN' : formatRestClock(seconds)
}

export interface SetNumbering {
  /** The row's label: `01`, `W`; in a superset the member's letter in front (`A1`, `AW`). */
  label: string
  /** The number the pickers' eyebrow says: the place among the working sets, or among the warmups for a warmup. */
  number: number
}

/** Warmups are numbered apart from the working sets (SPEC 18b: "warmups numbered apart"); a warmup's row says W. */
export function numberSets(sets: readonly DraftSet[], letter: string | null): SetNumbering[] {
  let working = 0
  let warmups = 0
  return sets.map((s) => {
    if (s.isWarmup) {
      warmups += 1
      return { label: `${letter ?? ''}W`, number: warmups }
    }
    working += 1
    return { label: letter === null ? String(working).padStart(2, '0') : `${letter}${working}`, number: working }
  })
}

/**
 * "+ SET" (Defaults 8, `addSetDefaults`): a Normal set with the rep target of the exercise's last set, a staged one's own and not its last
 * stage's, and none when there is no set to follow. It has no rest of its own and no stages.
 */
export function newSetAfter(last: DraftSet | undefined): DraftSet {
  const d = addSetDefaults(last ?? null)
  return {
    id: null,
    isWarmup: d.isWarmup,
    stageKind: d.stageKind,
    repMin: d.repMin,
    repMax: d.repMax,
    isAmrap: d.isAmrap,
    restSeconds: null,
    stageRestSeconds: null,
    stages: [],
  }
}

/**
 * Whether a set differs from the one it was when the screen opened, for the accent outline of "CHANGED IN THIS EDIT": its type (and
 * with it how many stages it has and the rest between them), its rep target and its rest after. A stage's own rep target is the stage
 * row's to mark (`stageChanged`). A set with no original (a new one) is changed.
 */
export function setChanged(set: DraftSet, original: DraftSet | undefined): boolean {
  if (original === undefined) return true
  const a = setTypeOf(set)
  const b = setTypeOf(original)
  const sameType =
    a.kind === b.kind &&
    (a.kind !== 'staged' || (b.kind === 'staged' && a.stageKind === b.stageKind && a.stageCount === b.stageCount && a.stageRestSeconds === b.stageRestSeconds))
  return !sameType || repText(repTargetOf(set)) !== repText(repTargetOf(original)) || set.restSeconds !== original.restSeconds
}

/**
 * Whether a stage row differs from the stage it was: a new stage, or one whose rep target changed. A new stage has no id and every
 * stage of the original has one (it was read from the default's rows), so a new stage finds no original and is changed.
 */
export function stageChanged(stage: DraftStage, original: DraftSet | undefined): boolean {
  if (original === undefined) return true
  const was = original.stages.find((st) => st.id === stage.id)
  return was === undefined || repText(repTargetOf(stage)) !== repText(repTargetOf(was))
}
