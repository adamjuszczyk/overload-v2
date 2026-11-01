// 1.2.1 item 4: PREVIEW SESSION in the workout's own design. What the screen is for: before START, see what's coming —
// the exercises in order, each set's targets, supersets, and last time's numbers. It reuses the workout's parts:
// the exercise header with its LAST line (which opens the last-time sheet, as in the workout), and each set drawn as
// an upcoming row is, read-only: "01  55 kg × 9 @ RIR 2", warmups as W, drops as ↳ under their head, cues under the row.
// Replaces the old preview's targets panel (whose planned line showed weight/reps/RIR under a "planned RIR" label),
// its old last-time panel and its "TARGET RIR n" rows. START SESSION is pinned at the foot.
import type { CSSProperties } from 'react'
import { ArrowLeft, Link2 } from 'lucide-react'
import type { ProgramExercise, WeekPlan, WeekPlanSet, WorkoutDay } from '@app/types'
import { useProgramExercises, useSupersetBlockRests } from '@app/features/programs/usePrograms'
import { useExerciseReferenceSessions } from '@app/features/gym/useSession'
import WorkoutExerciseHeader from '@app/features/gym/WorkoutExerciseHeader'
import { groupWeekPlanSets } from '@app/features/gym/setGroupLogic'
import { stageChipText, targetsText } from '@app/features/gym/workoutRowView'
import { CueLine, RowLabel, rowFrame } from './setRowParts'
import { memberLetter } from '@app/features/gym/workoutRules'
import { formatClock } from '@app/features/gym/workoutRowView'
import { useWeightDisplay } from '@app/hooks/useWeightDisplay'
import { hairline } from '@app/components/pickers/pickerControls'
import type { WeightUnit } from '@app/types'

const MONO = 'var(--font-mono)'
// flexShrink 0: a card in the scrolling column must never be squeezed to the screen's height (the bug item 24 fixes on the finished program).
const CARD: CSSProperties = { background: 'var(--surface)', borderRadius: 12, ...hairline('var(--border)'), overflow: 'hidden', flexShrink: 0 }

interface SessionPreviewProps {
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | null
  weekNumber: number
  today: string
  isStarting: boolean
  onBack: () => void
  onStart: () => void
  /** The header's eyebrow as the workout writes it ("WEEK 2 · TUESDAY"). */
  eyebrow?: string
}

function SetGroupRows({ head, stages, unit, label }: { head: WeekPlanSet; stages: WeekPlanSet[]; unit: WeightUnit; label: string }) {
  const kind = (head as WeekPlanSet & { stageKind?: string | null }).stageKind
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={rowFrame({})}>
        <RowLabel text={label} />
        <span className="flex-1 font-bold" style={{ minWidth: 0, color: head.isWarmup ? 'var(--text-muted)' : 'var(--text-primary)', fontFamily: MONO, fontSize: 13 }}>
          {targetsText(head, unit) || '—'}
        </span>
        {stages.length > 0 && (
          <span className="flex-shrink-0 font-bold" style={{ color: 'var(--text-muted)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em' }}>
            {stageChipText((kind ?? 'dropset') as never, stages.length)}
          </span>
        )}
      </div>
      {stages.map((stage) => (
        <div key={stage.id} style={rowFrame({})}>
          <RowLabel text="↳" />
          <span className="flex-1 font-bold" style={{ minWidth: 0, color: 'var(--text-secondary)', fontFamily: MONO, fontSize: 13 }}>{targetsText(stage, unit) || '—'}</span>
        </div>
      ))}
      <CueLine tags={(head as WeekPlanSet & { tags?: string[] | null }).tags} />
    </div>
  )
}

// A superset as the workout draws it (SupersetBlock): the link line, each member's letter and header (with its LAST line),
// then the rounds — round 1 = A1, B1; round 2 = A2, B2; …
function SupersetPreview({ members, letter, rest, setsOf, header }: { members: ProgramExercise[]; letter: string; rest: number | null; setsOf: (pe: ProgramExercise) => WeekPlanSet[]; header: (pe: ProgramExercise) => JSX.Element }) {
  const working = members.map((pe) => groupWeekPlanSets(setsOf(pe)).filter((g) => !g.head.isWarmup).sort((a, b) => a.head.setNumber - b.head.setNumber))
  const rounds = Math.max(0, ...working.map((w) => w.length))
  return (
    <div style={CARD}>
      <div className="px-4 pt-3 pb-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <Link2 size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-bold tracking-widest" style={{ color: 'var(--accent)', fontFamily: MONO }}>
          SUPERSET {letter}{rest != null ? ` · REST ${formatClock(rest)} AFTER EACH ROUND` : ''}
        </span>
      </div>
      {members.map((pe, i) => {
        const warmups = groupWeekPlanSets(setsOf(pe)).filter((g) => g.head.isWarmup)
        return (
          <div key={pe.id}>
            <div className="px-4 pt-2 flex items-center gap-2">
              <span className="flex-shrink-0 flex items-center justify-center font-black" style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--accent-muted)', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontSize: 11 }}>
                {memberLetter(i)}
              </span>
            </div>
            <div style={{ padding: '0 4px 0 6px' }}>{header(pe)}</div>
            {warmups.length > 0 && (
              <div className="px-3 pt-2 space-y-1.5">
                {warmups.map((g) => <SetGroupRows key={g.head.id} head={g.head} stages={g.stages} unit={pe.weightUnit ?? 'kg'} label="W" />)}
              </div>
            )}
          </div>
        )
      })}
      <div className="px-3 py-3 space-y-4">
        {rounds === 0 && <p style={{ margin: 0, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>NO SETS PLANNED</p>}
        {Array.from({ length: rounds }, (_, r) => (
          <div key={r} className="space-y-1.5">
            <p className="text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>ROUND {r + 1}</p>
            {members.map((pe, i) => {
              const g = working[i][r]
              return g ? <SetGroupRows key={pe.id} head={g.head} stages={g.stages} unit={pe.weightUnit ?? 'kg'} label={`${memberLetter(i)}${r + 1}`} /> : null
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function SetRows({ sets, unit, letter }: { sets: WeekPlanSet[]; unit: WeightUnit; letter?: string }) {
  const groups = groupWeekPlanSets(sets).sort((a, b) => Number(b.head.isWarmup) - Number(a.head.isWarmup) || a.head.setNumber - b.head.setNumber)
  if (groups.length === 0) {
    return <p style={{ margin: 0, padding: '10px 14px 14px', fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>NO SETS PLANNED</p>
  }
  return (
    <div style={{ padding: '4px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {groups.map(({ head, stages }) => {
        const label = head.isWarmup ? 'W' : `${letter ?? ''}${String(head.setNumber).padStart(letter ? 1 : 2, '0')}`
        const kind = (head as WeekPlanSet & { stageKind?: string | null }).stageKind
        return (
          <div key={head.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={rowFrame({})}>
              <RowLabel text={label} />
              <span className="flex-1 font-bold" style={{ minWidth: 0, color: head.isWarmup ? 'var(--text-muted)' : 'var(--text-primary)', fontFamily: MONO, fontSize: 13 }}>
                {targetsText(head, unit) || '—'}
              </span>
              {stages.length > 0 && (
                <span className="flex-shrink-0 font-bold" style={{ color: 'var(--text-muted)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em' }}>
                  {stageChipText((kind ?? 'dropset') as never, stages.length)}
                </span>
              )}
            </div>
            {stages.map((stage) => (
              <div key={stage.id} style={rowFrame({})}>
                <RowLabel text="↳" />
                <span className="flex-1 font-bold" style={{ minWidth: 0, color: 'var(--text-secondary)', fontFamily: MONO, fontSize: 13 }}>{targetsText(stage, unit) || '—'}</span>
              </div>
            ))}
            <CueLine tags={(head as WeekPlanSet & { tags?: string[] | null }).tags} />
          </div>
        )
      })}
    </div>
  )
}

function ExerciseBlock({ pe, sets, header, letter }: { pe: ProgramExercise; sets: WeekPlanSet[]; header: (pe: ProgramExercise) => JSX.Element; letter?: string }) {
  const { unit } = useWeightDisplay(pe.weightUnit)
  return (
    <div>
      <div style={{ padding: '10px 4px 0 6px', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {letter && <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 12, color: 'var(--accent)', paddingTop: 4 }}>{letter}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>{header(pe)}</div>
      </div>
      <SetRows sets={sets} unit={unit} letter={letter} />
    </div>
  )
}

export default function SessionPreview({ workoutDay, weekPlan, weekNumber, today, isStarting, onBack, onStart, eyebrow }: SessionPreviewProps) {
  const { data: fallbackProgramExercises = [] } = useProgramExercises(workoutDay.id)
  const { data: blockRests = [] } = useSupersetBlockRests(workoutDay.id)
  const programExercises = weekPlan?.exercises ?? fallbackProgramExercises
  const sorted = [...programExercises].sort((a, b) => a.position - b.position)
  const reference = useExerciseReferenceSessions(workoutDay.id, programExercises.map((pe) => pe.exerciseId), null)
  const setsOf = (pe: ProgramExercise) => (weekPlan?.sets ?? []).filter((s) => s.programExerciseId === pe.id)

  const header = (pe: ProgramExercise) => (
    <WorkoutExerciseHeader
      programExercise={pe}
      today={today}
      scheduleType="weekday"
      sessions={reference.data.get(pe.exerciseId) ?? []}
      isLoading={reference.isLoading}
      isError={reference.isError}
      isFromCache={reference.isFromCache}
      onRetry={reference.retry}
      unit={pe.weightUnit ?? 'kg'}
    />
  )

  // Consecutive exercises sharing a block are one superset card, as in the workout.
  const units: ProgramExercise[][] = []
  for (const pe of sorted) {
    const prev = units[units.length - 1]
    if (prev && pe.supersetBlockId && prev[0].supersetBlockId === pe.supersetBlockId) prev.push(pe)
    else units.push([pe])
  }
  let blockIndex = 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
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
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>
            {eyebrow ?? `${weekPlan?.isDeload ? 'DELOAD · ' : ''}WEEK ${weekNumber}`} · PREVIEW
          </span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, lineHeight: 1.05, color: 'var(--text-primary)' }}>{workoutDay.name}</h1>
        </div>
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 48, fontSize: 15, color: 'var(--text-secondary)' }}>No exercises in this workout yet.</div>
        )}
        {units.map((unit) => {
          if (unit.length === 1) {
            return (
              <div key={unit[0].id} style={CARD}>
                <ExerciseBlock pe={unit[0]} sets={setsOf(unit[0])} header={header} />
              </div>
            )
          }
          const rest = blockRests.find((b) => b.id === unit[0].supersetBlockId) as { restAfterRoundSeconds?: number | null } | undefined
          const letter = String.fromCharCode(65 + blockIndex++)
          return <SupersetPreview key={unit[0].id} members={unit} letter={letter} rest={rest?.restAfterRoundSeconds ?? null} setsOf={setsOf} header={header} />
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
