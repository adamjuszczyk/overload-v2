import type { ReactNode } from 'react'
import type { ProgramExercise, ProgramSet, ProgramSupersetBlock, WeekPlanSet, WeightUnit } from '../../types'
import { groupIntoUnits, isLinkedGap, planLinkToggle } from '../../lib/supersetGroups.js'
import { useSettingsStore } from '../settings/settingsStore'
import {
  useUpdateProgramExerciseRest,
  useUpdateProgramExerciseTempo,
  useUpdateProgramExerciseWeightUnit,
  useToggleSupersetLink,
  useSupersetBlockRests,
  useUpdateSupersetBlockRest,
  useWarmupRoutineItems,
} from '../programs/usePrograms'
import { useProgramSets, useUpdateProgramSetRest, useUpdateProgramSetStageRest } from '../planner/usePlanner'
import {
  RestStepper,
  TempoEditor,
  UnitChips,
  EveryWeekLabel,
  WarmupRoutineEditor,
} from '../planner/designFieldEditors'
import { ownProgramSet, exerciseMarkers } from './structureFields'

// Chunk 30 (TASKS-1.1 "Rest, tempo, grouping, the routine and units in the
// Structure view (run-wide)"; SPEC Programs and runs / Rest / Tempo / Supersets /
// Warmup routine [P1.1]) — what Plan's STRUCTURE view shows and edits of the
// fields that stay run-wide: an exercise's rest, rest after, tempo and unit, a
// set's own rest and a staged head's stage rest, superset grouping and a block's
// round rests, and the workout's warmup routine. Rest, tempo, grouping and the
// routine are labelled "EVERY WEEK" (every week that exercise slot appears in); the
// unit is not.
//
// Every write goes to the exercise's OWN program-exercise row — the row the
// week's list is a join over: a row of the run's copy, or, for an exercise added
// or swapped in during a week, its own `week_only` row (G35: that is a slot of its
// own). It never goes to the week plan (a v2_week_plan_exercises row, which
// stores identity and order only), and never to the run copy's row at the same
// position. They are the very mutations the program tab calls on the same rows
// (StepExercises / StepVolume), so the two edit the same data and never disagree.
//
// No apply-ahead offer follows any of it: a run-wide change already reaches every
// week its slot appears in, because every week reads the slot's own row. That is
// why nothing here touches useApplyAheadOffer.
//
// Standing UI rule (Adam, 2026-10-10): nothing here is on a row by default except
// a marker where the field is set. The controls are in the ⋯ of the exercise or
// the set they belong to — except those TASKS places elsewhere: the link toggle
// between two neighbours, a block's round rests after its last member, and the
// routine at the top of the view. A past week gets markers and the routine's text
// and no control.
//
// All of it is built from the program tab's own editors (planner/
// designFieldEditors.tsx) and the existing ⋯ menu; the only things drawn here are
// the groups that hold them. Display-only choices (D31), provisional: the text
// and place of each marker, the "EVERY WEEK" label as one line over a group of
// controls (and beside the link toggle, the block's rests and the routine's
// title), and the unit's own group without it.

// ─── What the view hands each exercise and each set ───────────────────────────

export interface StructureSetFields {
  // The set's own program set — null unless it names one of its OWN exercise row
  // (ownProgramSet; G45). No program set, no REST and no STAGE REST.
  programSet: ProgramSet | null
  onRest: (restSeconds: number | null) => void
  onStageRest: (stageRestSeconds: number | null) => void
}

export interface StructureExerciseFields {
  // The exercise's rest, rest after, tempo and unit where set (exerciseMarkers).
  markers: string[]
  globalUnit: WeightUnit
  onRest: (changes: { restSeconds?: number | null; restAfterSeconds?: number | null }) => void
  onTempo: (tempo: string | null) => void
  onUnit: (unit: WeightUnit | null) => void
  // The gap between this exercise and the next in THIS week's order; null after
  // the last one and on a past week.
  link: { linked: boolean; disabled: boolean; onToggle: () => void } | null
  // A linked unit's round rests, on its last member only; null elsewhere and on a
  // past week.
  blockRest: {
    blockId: string
    rest: ProgramSupersetBlock | null
    onChange: (changes: { restWithinRoundSeconds?: number | null; restAfterRoundSeconds?: number | null }) => void
  } | null
  setFields: (set: WeekPlanSet) => StructureSetFields
}

export type StructureFieldsFor = (pe: ProgramExercise, index: number) => StructureExerciseFields

// ─── The provider: every hook the STRUCTURE view adds, in one component ──────
// A component of its own, mounted only while the view shows, so the SETS view calls
// none of these hooks (and a screen that never opens STRUCTURE needs none of them).
// `programExercises` is this week's list in this week's order: the link toggles and
// their plans (supersetGroups.ts's planLinkToggle) run over exactly that order (G35),
// never over the run copy's.
export function StructureFieldsProvider({
  workoutDayId,
  programExercises,
  isPast,
  children,
}: {
  workoutDayId: string
  programExercises: ProgramExercise[]
  isPast: boolean
  children: (fieldsFor: StructureFieldsFor) => ReactNode
}) {
  const globalUnit = useSettingsStore((s) => s.weightUnit)
  const updateRest = useUpdateProgramExerciseRest(workoutDayId)
  const updateTempo = useUpdateProgramExerciseTempo(workoutDayId)
  const updateUnit = useUpdateProgramExerciseWeightUnit(workoutDayId)
  const toggleLink = useToggleSupersetLink(workoutDayId)
  const updateBlockRest = useUpdateSupersetBlockRest(workoutDayId)
  const { data: blockRests } = useSupersetBlockRests(workoutDayId)
  const { data: programSets } = useProgramSets(programExercises.map((pe) => pe.id))
  const updateSetRest = useUpdateProgramSetRest()
  const updateStageRest = useUpdateProgramSetStageRest()

  const blockRestById = new Map((blockRests ?? []).map((b) => [b.id, b]))
  const programSetById = new Map((programSets ?? []).map((ps) => [ps.id, ps]))
  const units = groupIntoUnits(programExercises)

  const fieldsFor: StructureFieldsFor = (pe, index) => {
    const unit = units.find((u) => u.some((member) => member.id === pe.id)) ?? [pe]
    const isLastInUnit = unit[unit.length - 1].id === pe.id
    const blockId = pe.supersetBlockId ?? null
    return {
      markers: exerciseMarkers(pe, globalUnit),
      globalUnit,
      onRest: (changes) => updateRest.mutate({ id: pe.id, changes }),
      onTempo: (tempo) => updateTempo.mutate({ id: pe.id, tempo }),
      onUnit: (weightUnit) => updateUnit.mutate({ id: pe.id, weightUnit }),
      link:
        isPast || index >= programExercises.length - 1
          ? null
          : {
              linked: isLinkedGap(programExercises, index),
              disabled: toggleLink.isPending,
              onToggle: () => toggleLink.mutate(planLinkToggle(programExercises, index)),
            },
      // Until the blocks have been read the rests would show their defaults and a
      // tap would write over a value not yet seen, so the editor waits for them.
      blockRest:
        !isPast && isLastInUnit && unit.length >= 2 && blockId != null && blockRests !== undefined
          ? {
              blockId,
              rest: blockRestById.get(blockId) ?? null,
              onChange: (changes) => updateBlockRest.mutate({ id: blockId, changes }),
            }
          : null,
      setFields: (set) => {
        const programSet = ownProgramSet(set, programSetById)
        return {
          programSet,
          onRest: (restSeconds) => {
            if (programSet) updateSetRest.mutate({ id: programSet.id, restSeconds })
          },
          onStageRest: (stageRestSeconds) => {
            if (programSet) updateStageRest.mutate({ id: programSet.id, stageRestSeconds })
          },
        }
      },
    }
  }

  return <>{children(fieldsFor)}</>
}

// ─── Markers ─────────────────────────────────────────────────────────────────

// The compact label a set field shows when it is set: the tag chip of the SETS
// view, so no new visual language (Escalation 19).
export function MarkerChip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{ padding: '0 6px', height: 16, display: 'inline-flex', alignItems: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}
    >
      {children}
    </span>
  )
}

// Under the exercise's name; nothing at all when none of its fields is set.
export function ExerciseMarkers({ markers }: { markers: string[] }) {
  if (markers.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
      {markers.map((marker) => (
        <MarkerChip key={marker}>{marker}</MarkerChip>
      ))}
    </div>
  )
}

// ─── Controls ────────────────────────────────────────────────────────────────

const FIELD_GROUP_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }
const FIELD_ROW_STYLE: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }
const SECTION_RULE_STYLE: React.CSSProperties = { borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }

// The exercise ⋯ menu's run-wide part: REST, REST AFTER and TEMPO under one
// "EVERY WEEK", then the unit on its own, which does not carry it. Taps here don't
// close the menu (a stepper is tapped several times); only its actions do.
export function ExerciseDesignMenu({ pe, fields }: { pe: ProgramExercise; fields: StructureExerciseFields }) {
  const name = pe.exercise?.name ?? 'this exercise'
  return (
    <>
      <div role="group" aria-label="Every week" style={{ ...FIELD_GROUP_STYLE, ...SECTION_RULE_STYLE }}>
        <EveryWeekLabel />
        <div style={FIELD_ROW_STYLE}>
          <RestStepper
            label="REST"
            value={pe.restSeconds ?? null}
            disabled={false}
            onChange={(v) => fields.onRest({ restSeconds: v })}
            defaultText="GLOBAL"
            ariaLabel={`rest for ${name}`}
          />
          <RestStepper
            label="REST AFTER"
            value={pe.restAfterSeconds ?? null}
            disabled={false}
            onChange={(v) => fields.onRest({ restAfterSeconds: v })}
            defaultText="NONE"
            ariaLabel={`rest after for ${name}`}
          />
          <TempoEditor value={pe.tempo ?? null} disabled={false} onChange={fields.onTempo} />
        </div>
      </div>
      <div role="group" aria-label="Weight unit" style={{ ...FIELD_ROW_STYLE, ...SECTION_RULE_STYLE }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flexShrink: 0 }}>
          UNIT
        </span>
        {/* Editable on both planning types, a week-dependent run included (the
            program tab disables it there). */}
        <UnitChips value={pe.weightUnit} globalUnit={fields.globalUnit} disabled={false} onChange={fields.onUnit} />
      </div>
    </>
  )
}

// A set's ⋯ menu's run-wide part: its own REST and, on a staged head, STAGE REST,
// under "EVERY WEEK". Nothing when the set names no program set of its own
// exercise row (G45): such a set follows its exercise's rest, then the global rest.
// `of` names the set for the steppers' buttons ("set 2 for Bench Press").
export function SetRestMenu({
  fields,
  of,
  stageRestDefaultText,
}: {
  fields: StructureSetFields
  of: string
  // Given on a staged head only: the text its STAGE REST reads when none is set.
  stageRestDefaultText?: string
}) {
  const { programSet } = fields
  if (!programSet) return null
  return (
    <div role="group" aria-label="Every week" style={FIELD_GROUP_STYLE}>
      <EveryWeekLabel />
      <div style={FIELD_ROW_STYLE}>
        <RestStepper
          label="REST"
          value={programSet.restSeconds}
          disabled={false}
          onChange={fields.onRest}
          defaultText="CHAIN"
          ariaLabel={`rest of ${of}`}
        />
        {stageRestDefaultText !== undefined && (
          <RestStepper
            label="STAGE REST"
            value={programSet.stageRestSeconds}
            disabled={false}
            onChange={fields.onStageRest}
            defaultText={stageRestDefaultText}
            ariaLabel={`stage rest of ${of}`}
          />
        )}
      </div>
    </div>
  )
}

// ─── The warmup routine, at the top of the view ──────────────────────────────
// The workout's routine (SPEC Warmup routine [P1.1]): a card with its title and
// "EVERY WEEK", and the program tab's own editor inside it (variant 'menu': the
// standing UI rule's ⋯ on each item). A past week gets the list and nothing to
// change, and nothing at all when the routine is empty.
export function StructureRoutine({ workoutDayId, isPast }: { workoutDayId: string; isPast: boolean }) {
  const { data: items = [] } = useWarmupRoutineItems(workoutDayId)
  if (isPast && items.length === 0) return null
  return (
    <div role="group" aria-label="Warmup routine" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
          WARMUP ROUTINE
        </span>
        <EveryWeekLabel />
      </div>
      <WarmupRoutineEditor workoutDayId={workoutDayId} variant="menu" readOnly={isPast} />
    </div>
  )
}
