// Chunk 77 (1.2.1 item 4, SPEC "PREVIEW SESSION") — what START SESSION would open, drawn in the workout's own design: the exercises in order, each
// under the workout's header (its LAST line opens the last-time sheet), each set as an upcoming row ("01  55 kg × 9 @ RIR 2"; W for a warmup, ↳
// for a drop under its head with the stage chip over the head, the cues under the row), a superset as the workout draws it (the link line with
// the round rest, the lettered members, then ROUND 1 with A1 and B1, ROUND 2 …). It adds no content the workout doesn't show, writes nothing and
// has no timer; START SESSION is pinned at the foot and is Today's own start. The old targets panel ("PLANNED RIR"), the old last-time panel, the
// "TARGET RIR n" rows and their components went with this rebuild.
import type { CSSProperties } from 'react'
import { ArrowLeft, Link2 } from 'lucide-react'
import type { ProgramExercise, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { hairline } from '../../components/pickers/pickerControls'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { resolveStageKind } from '../../lib/plannerVocabulary'
import { useProgramExercises, useSupersetBlockRests } from '../programs/usePrograms'
import { useExerciseReferenceSessions } from './useSession'
import WorkoutExerciseHeader from './WorkoutExerciseHeader'
import { groupWeekPlanSets, type SetGroup } from './setGroupLogic'
import { buildSupersetRounds } from './supersetRounds'
import { CueLine, RowLabel, rowFrame } from './setRowParts'
import { formatClock, stageChipText, targetsText } from './workoutRowView'
import { memberLetter } from './workoutRules'

const MONO = 'var(--font-mono)'

type Group = SetGroup<WeekPlanSet>
type Reference = ReturnType<typeof useExerciseReferenceSessions>

interface SessionPreviewProps {
  workoutDay: WorkoutDay
  /** The week's plan for this session; null when the week isn't planned yet (the exercises then come from the program, with no sets). */
  weekPlan: WeekPlan | null
  today: string
  isStarting: boolean
  /** The header's first line as the workout writes it ("WEEK 2 · TUESDAY", "DELOAD · WEEK 2 · TUESDAY"; Today passes it); this screen adds " · PREVIEW". */
  eyebrow: string
  onBack: () => void
  onStart: () => void
}

// A card as a card is: a surface in the scrolling column that is never squeezed to the screen's height.
const CARD: CSSProperties = { background: 'var(--surface)', borderRadius: 12, ...hairline('var(--border)'), overflow: 'hidden', flexShrink: 0 }

const pad2 = (n: number): string => String(n).padStart(2, '0')

// The plan's sets of one exercise in the workout's order (it sorts the heads by their planned number, and a tie keeps the order the plan was read in),
// each head with the drops under it.
function planGroups(sets: readonly WeekPlanSet[]): Group[] {
  return groupWeekPlanSets([...sets]).sort((a, b) => a.head.setNumber - b.head.setNumber)
}

// A working set's number is its rank among the working sets (the workout's rule, DECISIONS 170), a warmup is W (warmups are numbered apart).
function labelled(groups: readonly Group[]): Array<{ group: Group; label: string }> {
  let working = 0
  return groups.map((group) => ({ group, label: group.head.isWarmup ? 'W' : pad2((working += 1)) }))
}

function NoSets({ padding }: { padding?: string }) {
  return <p style={{ margin: 0, padding, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>NO SETS PLANNED</p>
}

// One planned set as an upcoming row, read-only: its label, its targets and, over a staged head, the stage chip; a row for each drop; the cues.
// The unit is the exercise's own (its override, else Settings'), as the workout's rows read it.
function SetGroupRows({ group, label, weightUnit }: { group: Group; label: string; weightUnit: ProgramExercise['weightUnit'] }) {
  const { unit } = useWeightDisplay(weightUnit)
  const { head, stages } = group
  // A warmup is weight and reps only (SPEC "Warmup sets"; the workout's warmup row has no RIR): a target a plan still holds from the set's earlier
  // type is not shown.
  const headTargets = head.isWarmup ? { ...head, targetRir: null, targetRirMax: null } : head
  return (
    <div data-preview-set={head.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={rowFrame()}>
        <RowLabel text={label} />
        <span className="flex-1 font-bold" style={{ minWidth: 0, color: head.isWarmup ? 'var(--text-muted)' : 'var(--text-primary)', fontFamily: MONO, fontSize: 13 }}>
          {targetsText(headTargets, unit) || '—'}
        </span>
        {stages.length > 0 && (
          <span className="flex-shrink-0 font-bold" style={{ color: 'var(--text-muted)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em' }}>
            {stageChipText(resolveStageKind(head.stageKind ?? null), stages.length)}
          </span>
        )}
      </div>
      {stages.map((stage) => (
        <div key={stage.id} style={rowFrame()}>
          <RowLabel text="↳" />
          <span className="flex-1 font-bold" style={{ minWidth: 0, color: 'var(--text-secondary)', fontFamily: MONO, fontSize: 13 }}>
            {targetsText(stage, unit) || '—'}
          </span>
        </div>
      ))}
      <CueLine tags={head.tags} />
    </div>
  )
}

// The exercise's header, the workout's own: name, muscle, tempo and the LAST line that opens the last-time sheet. No ⋯ (nothing here changes the session).
function ExerciseHead({ pe, today, reference }: { pe: ProgramExercise; today: string; reference: Reference }) {
  const { unit } = useWeightDisplay(pe.weightUnit)
  return (
    <WorkoutExerciseHeader
      programExercise={pe}
      today={today}
      scheduleType="weekday"
      sessions={reference.data.get(pe.exerciseId) ?? []}
      isLoading={reference.isLoading}
      isError={reference.isError}
      isFromCache={reference.isFromCache}
      onRetry={reference.retry}
      unit={unit}
    />
  )
}

function ExerciseCardPreview({ pe, sets, today, reference }: { pe: ProgramExercise; sets: readonly WeekPlanSet[]; today: string; reference: Reference }) {
  const rows = labelled(planGroups(sets))
  return (
    <div data-preview-exercise={pe.id} style={CARD}>
      <div style={{ padding: '10px 4px 0 6px' }}>
        <ExerciseHead pe={pe} today={today} reference={reference} />
      </div>
      {rows.length === 0 ? (
        <NoSets padding="10px 14px 14px" />
      ) : (
        <div style={{ padding: '4px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map(({ group, label }) => (
            <SetGroupRows key={group.head.id} group={group} label={label} weightUnit={pe.weightUnit} />
          ))}
        </div>
      )}
    </div>
  )
}

// A superset as the workout draws it (SupersetBlock): the link line with the round rest, each member's letter and header (its warmups under it), then
// the rounds — round 1 is A1, B1, round 2 A2, B2, … and a member with no set in a round has no row there.
function SupersetPreview({
  members,
  letter,
  rest,
  setsOf,
  today,
  reference,
}: {
  members: ProgramExercise[]
  letter: string
  rest: number | null
  setsOf: (pe: ProgramExercise) => WeekPlanSet[]
  today: string
  reference: Reference
}) {
  const groups = members.map((pe) => planGroups(setsOf(pe)))
  const rounds = buildSupersetRounds(groups.map((memberGroups) => memberGroups.filter((group) => !group.head.isWarmup)))
  const noSets = groups.every((memberGroups) => memberGroups.length === 0)
  return (
    <div data-preview-superset={letter} style={CARD}>
      <div className="px-4 pt-3 pb-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <Link2 size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-bold tracking-widest" style={{ color: 'var(--accent)', fontFamily: MONO }}>
          SUPERSET {letter}
          {rest != null ? ` · REST ${formatClock(rest)} AFTER EACH ROUND` : ''}
        </span>
      </div>
      {members.map((pe, i) => {
        const warmups = groups[i].filter((group) => group.head.isWarmup)
        return (
          <div key={pe.id} data-preview-exercise={pe.id}>
            <div className="px-4 pt-2 flex items-center gap-2">
              <span
                className="flex-shrink-0 flex items-center justify-center font-black"
                style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--accent-muted)', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontSize: 11 }}
              >
                {memberLetter(i)}
              </span>
            </div>
            <div style={{ padding: '0 4px 0 6px' }}>
              <ExerciseHead pe={pe} today={today} reference={reference} />
            </div>
            {warmups.length > 0 && (
              <div className="px-3 pt-2 space-y-1.5">
                {warmups.map((group) => (
                  <SetGroupRows key={group.head.id} group={group} label="W" weightUnit={pe.weightUnit} />
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div className="px-3 py-3 space-y-4">
        {noSets && <NoSets />}
        {rounds.map((round) => (
          <div key={round.roundNumber} data-preview-round={round.roundNumber} className="space-y-1.5">
            <p className="text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>
              ROUND {round.roundNumber}
            </p>
            {round.cells.map((cell) => (
              <SetGroupRows
                key={cell.head.head.id}
                group={cell.head}
                label={`${memberLetter(cell.memberIndex)}${round.roundNumber}`}
                weightUnit={members[cell.memberIndex].weightUnit}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

type Unit = { kind: 'single'; pe: ProgramExercise } | { kind: 'block'; blockId: string; members: ProgramExercise[] }

// Consecutive exercises that share one superset block (two or more) are one superset card, as GymSession groups them; everything else is a card.
function previewUnits(sorted: readonly ProgramExercise[]): Unit[] {
  const units: Unit[] = []
  for (let i = 0; i < sorted.length; ) {
    const pe = sorted[i]
    const blockId = pe.supersetBlockId ?? null
    let j = i + 1
    if (blockId !== null) while (j < sorted.length && sorted[j].supersetBlockId === blockId) j += 1
    if (blockId !== null && j - i >= 2) {
      units.push({ kind: 'block', blockId, members: sorted.slice(i, j) })
      i = j
    } else {
      units.push({ kind: 'single', pe })
      i += 1
    }
  }
  return units
}

export default function SessionPreview({ workoutDay, weekPlan, today, isStarting, eyebrow, onBack, onStart }: SessionPreviewProps) {
  // The week-preferring source GymSession and PlanPage's workout panel use: the week's own exercise list when the week is planned, the program's own
  // exercises otherwise (no sets then: each says so).
  const { data: fallbackExercises = [], isPending: fallbackPending } = useProgramExercises(workoutDay.id)
  const { data: blockRests = [] } = useSupersetBlockRests(workoutDay.id)
  const programExercises = weekPlan?.exercises ?? fallbackExercises
  const sorted = [...programExercises].sort((a, b) => a.position - b.position)
  // No session exists yet, so no current session to leave out of "last time".
  const reference = useExerciseReferenceSessions(
    workoutDay.id,
    programExercises.map((pe) => pe.exerciseId),
    null,
  )
  const setsOf = (pe: ProgramExercise) => (weekPlan?.sets ?? []).filter((set) => set.programExerciseId === pe.id)
  // Until the program's exercises have been read there is nothing to say about them: "no exercises" is for a workout that has none.
  const waiting = weekPlan === null && fallbackPending
  let blockLetterIndex = 0

  return (
    <div data-session-preview style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      <div style={{ padding: '16px 16px 14px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Today"
          style={{ flex: '0 0 auto', width: 44, height: 44, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-raised)', ...hairline('var(--border-strong)'), borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{eyebrow} · PREVIEW</span>
          <h1 style={{ margin: 0, overflowWrap: 'anywhere', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, lineHeight: 1.05, color: 'var(--text-primary)' }}>{workoutDay.name}</h1>
        </div>
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!waiting && sorted.length === 0 && <div style={{ textAlign: 'center', paddingTop: 48, fontSize: 15, color: 'var(--text-secondary)' }}>No exercises in this workout yet.</div>}
        {previewUnits(sorted).map((unit) => {
          if (unit.kind === 'single') {
            return <ExerciseCardPreview key={unit.pe.id} pe={unit.pe} sets={setsOf(unit.pe)} today={today} reference={reference} />
          }
          return (
            <SupersetPreview
              key={`block-${unit.blockId}-${unit.members.map((pe) => pe.id).join('.')}`}
              members={unit.members}
              letter={memberLetter(blockLetterIndex++)}
              rest={blockRests.find((block) => block.id === unit.blockId)?.restAfterRoundSeconds ?? null}
              setsOf={setsOf}
              today={today}
              reference={reference}
            />
          )
        })}
      </div>

      <div style={{ flexShrink: 0, padding: '10px 16px 12px', borderTop: '1px solid var(--border)', background: 'var(--base)' }}>
        <button
          type="button"
          onClick={onStart}
          disabled={isStarting}
          className="w-full rounded-xl font-black tracking-widest text-sm"
          style={{ height: 52, backgroundColor: 'var(--accent)', color: 'var(--on-accent)', fontFamily: MONO, opacity: isStarting ? 0.6 : 1 }}
        >
          {isStarting ? 'STARTING…' : 'START SESSION'}
        </button>
      </div>
    </div>
  )
}
