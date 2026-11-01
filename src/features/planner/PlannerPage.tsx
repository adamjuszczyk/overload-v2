import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CircleAlert, Pencil } from 'lucide-react'
import BottomSheet from '../../components/BottomSheet'
import ConfirmDialog from '../../components/ConfirmDialog'
import { errorReason } from '../../components/exercisePickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import type { DayOfWeek } from '../../types'
import { usePrograms, useWorkoutDays, useUpdateProgramName } from '../programs/usePrograms'
import { useMesos } from '../programs/useMesos'
import { useProgramHasSchedule } from '../programs/useProgramHasSchedule'
import { NO_SCHEDULE_START_REASON } from '../programs/hasSchedule'
import { isListedSavedProgram } from '../programs/programService'
import StartProgramSheet from '../programs/StartProgramSheet'
import { detectSharedWeekdayWorkouts, useSplitSharedWeekdayWorkouts, type SharedWeekdayGroup } from './usePlanner'
import { CAPTION, HEADING, MONO, Spinner, ruleAbove, ruleBelow } from './plannerChrome'
import StepPriorities from './StepPriorities'
import StepExercises from './StepExercises'
import StepVolume from './StepVolume'

// The stepped program planner (SPEC.md "Program planner"; TASKS.md chunk 11 — "Three steps... priorities (skippable), exercises & order with the
// weekday schedule, volume"). Routed at /program/:programId, replacing ProgramBuilderPage/WorkoutDayEditorPage/WeeklyScheduleGrid (all removed
// that chunk). Chunk 68 draws it the way boards PP1–PP6 do (the step bar, the rename-in-place title, the states, the confirms) over every
// write it had.
//
// Every edit here (rename, add/remove workout or exercise, schedule, sets) commits immediately through its own mutation, the same write-through
// pattern the old builder already used (and chunk 10's PrioritiesEditor still does) — there is no separate client-only draft. SAVE and START
// below are therefore not a bulk write: by the time either is tapped, the program already looks exactly as shown. SAVE simply leaves the planner
// (so "open, then save unchanged" writes nothing at all — reviewer note 1's own proof) and goes to the PROGRAMS tab; START opens the start sheet
// (PR8, chunk 65's `StartProgramSheet`, with this program picked; SPEC Programs and runs [1.2], Starting: "The stepped planner's START opens the
// start sheet (PR8) with that program picked; it never ends a running program silently", DECISIONS 214 (a), Adam 2026-10-22). The sheet starts the
// run (`v2_start_run`, chunk 6), goes to Plan, week 1, says so when a program is running (PR9) and shows a failed start's real reason (PR10), so
// this page draws neither PP5b's STARTING… nor its "Couldn't start this program.".
//
// Reached only against a `kind = 'saved'` program (the PROGRAMS tab's YOUR PROGRAMS list and its New program sheet since chunk 65). A run's copy is
// refused (chunk 33, SPEC Programs and runs [P1.1]; PP5's words since chunk 68): a running program's schedule and workouts are fixed for the run
// (its deload rules are Settings', since chunk 48), and the rest of what Plan's program tab used to edit happens in the week.
// A deleted saved program (chunk 74; 1.2.1 item 8a, DECISIONS 260) is refused the same way when its address is opened: "This program was
// deleted." The route reads `usePrograms()`, which is unfiltered (a run's copy has to be found by id), so the refusal reads the program's own
// `deletedAt`; the START sheet's list below goes through `isListedSavedProgram`, the same test YOUR PROGRAMS' list does.
//
// Starting needs a schedule (chunk 33, G39): START is disabled while the program has no scheduled workout, with the reason under it
// (programs/hasSchedule.ts is the one check, shared with the PROGRAMS tab's START sheet and Plan's no-schedule line). Display choice, provisional
// under D31 and DECISIONS 85's posture (the reason shows only once it is known): START is also off while the runs have not been read, because
// the sheet's PR9 line has to know whether a program is running before START PROGRAM can be tapped (214: never ends one silently); it says nothing.
type Step = 'priorities' | 'exercises' | 'volume'

const STEPS: { id: Step; label: string }[] = [
  { id: 'priorities', label: '1 · PRIORITIES' },
  { id: 'exercises', label: '2 · EXERCISES' },
  { id: 'volume', label: '3 · VOLUME' },
]

// PP5's words.
const NOT_FOUND_TITLE = 'Program not found'
const RUN_COPY_TITLE = "This is the current program's copy"
const RUN_COPY_LINE = 'It opens from Plan instead: plan its weeks there, or use EDIT PROGRAM in Programs.'
// SPEC Screens → Programs · YOUR PROGRAMS [8a]: "A deleted program opened by its address ... is refused like a run's copy: 'This program was deleted.'"
const DELETED_TITLE = 'This program was deleted.'

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function BackToPrograms({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...MONO, height: 48, boxSizing: 'border-box', padding: '0 20px', borderRadius: 10, ...hairline('var(--border-strong)'), background: 'var(--surface)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, letterSpacing: '0.2em', cursor: 'pointer' }}
    >
      <ArrowLeft size={14} aria-hidden="true" />
      BACK TO PROGRAMS
    </button>
  )
}

// PP5: a title, an optional line, and the way back, centred on the page.
function StateScreen({ title, line, onBack }: { title: string; line?: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, padding: '0 24px', textAlign: 'center', background: 'var(--base)' }}>
      <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 20, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{title}</p>
      {line && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{line}</p>}
      <BackToPrograms onClick={onBack} />
    </div>
  )
}

export default function PlannerPage() {
  const { programId } = useParams<{ programId: string }>()
  const navigate = useNavigate()

  const { data: programs = [], isLoading: programsLoading } = usePrograms()
  const program = programs.find((p) => p.id === programId)
  const { data: workoutDays = [] } = useWorkoutDays(programId ?? '')

  // A run's copy (kind 'run') is refused below; an unset kind reads as saved.
  const isRunCopy = program !== undefined && (program.kind ?? 'saved') !== 'saved'
  const [step, setStep] = useState<Step>('priorities')

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const updateName = useUpdateProgramName()

  useEffect(() => {
    if (editingName) nameRef.current?.focus()
  }, [editingName])

  // G14 (TASKS.md, Adam 2026-10-05) — an existing program whose schedule puts one workout on several weekdays. Detected once per program load;
  // dismissing ("keep as is") or splitting both resolve it for this visit — re-opening a program that was left "as is" shows the prompt again
  // next time, since nothing was stored to remember the dismissal (TASKS.md: "nothing is converted automatically", and SPEC names no persisted
  // acknowledgement either).
  const sharedGroups = program ? detectSharedWeekdayWorkouts(program.schedule) : []
  const [g14Dismissed, setG14Dismissed] = useState(false)
  const splitWorkouts = useSplitSharedWeekdayWorkouts(programId ?? '')

  // null until the program's workouts (and, for a sequence program, its sequence) have answered.
  const hasSchedule = useProgramHasSchedule(program)
  const mesosRead = useMesos()
  const [startOpen, setStartOpen] = useState(false)

  if (programsLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spinner label="Loading the program" size={24} />
      </div>
    )
  }

  if (!program) return <StateScreen title={NOT_FOUND_TITLE} onBack={() => navigate('/program')} />

  // A run's copy: no step, no editor — the refusal and the way back (chunk 33, SPEC Programs and runs [P1.1]; PP5).
  if (isRunCopy) return <StateScreen title={RUN_COPY_TITLE} line={RUN_COPY_LINE} onBack={() => navigate('/program')} />

  // A deleted program (chunk 74): the row stays, so the id still finds it — the planner never opens it (DECISIONS 260).
  if (program.deletedAt) return <StateScreen title={DELETED_TITLE} onBack={() => navigate('/program')} />

  async function saveName() {
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== program!.name) {
      await updateName.mutateAsync({ id: program!.id, name: trimmed })
    }
    setEditingName(false)
  }

  const activeMeso = mesosRead.data?.find((m) => m.status === 'active') ?? null
  // START's list: the saved programs a person can still pick — YOUR PROGRAMS' own test (chunk 74), so a deleted program isn't offered.
  const savedPrograms = programs.filter(isListedSavedProgram)
  // START waits for the answers it needs, and stays off while a program has no scheduled workout (the reason shows under it only once that is
  // known).
  const startDisabled = hasSchedule !== true || mesosRead.data === undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header: back, the name (rename in place: Enter or a tap away saves), and the step bar. */}
      <div style={{ padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 14, flexShrink: 0, ...ruleBelow() }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={() => navigate('/program')}
            aria-label="Back to programs"
            style={{ flex: '0 0 auto', width: 44, height: 44, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border)'), background: 'var(--surface)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}
          >
            <ArrowLeft size={18} />
          </button>

          {editingName ? (
            <input
              ref={nameRef}
              aria-label="Program name"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') nameRef.current?.blur() }}
              style={{ flex: 1, minWidth: 0, height: 44, boxSizing: 'border-box', borderRadius: 10, borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--accent)', background: 'var(--surface)', padding: '0 12px', ...HEADING, fontSize: 20, color: 'var(--text-primary)', outline: 'none' }}
            />
          ) : (
            <button
              type="button"
              aria-label="Rename program"
              onClick={() => { setNameValue(program.name); setEditingName(true) }}
              style={{ flex: 1, minWidth: 0, height: 44, borderWidth: 0, background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', color: 'var(--text-primary)', cursor: 'pointer' }}
            >
              <span style={{ ...HEADING, minWidth: 0, fontSize: 22, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{program.name}</span>
              <Pencil size={14} aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        {/* Step switcher — "back and forward between steps" (TASKS.md); any step is reachable at any time, nothing here blocks moving on. */}
        <div role="tablist" aria-label="Steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', height: 44, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border)'), background: 'var(--surface)', overflow: 'hidden' }}>
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={step === s.id}
              onClick={() => setStep(s.id)}
              style={{ ...MONO, borderWidth: 0, padding: 0, background: step === s.id ? 'var(--accent)' : 'transparent', color: step === s.id ? 'var(--on-accent)' : 'var(--text-secondary)', fontSize: 10, letterSpacing: '0.15em', cursor: 'pointer' }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: step === 'priorities' ? '20px 16px 24px' : '16px 16px 24px', minHeight: 0 }}>
        {step === 'priorities' && <StepPriorities programId={program.id} />}
        {step === 'exercises' && <StepExercises program={program} volumeReadOnly={false} />}
        {step === 'volume' && <StepVolume program={program} volumeReadOnly={false} canChangePlanningType />}
      </div>

      {/* Save / Start — visible from any step (TASKS.md: "save stores the program as is; Start creates a run"). SAVE leaves for the PROGRAMS tab
          and writes nothing; START opens the start sheet. Chunk 33 (G39): START is off while the program has no scheduled workout, with one line
          under it saying why (DECISIONS 85, provisional). */}
      <div style={{ padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', background: 'var(--base)', flexShrink: 0, ...ruleAbove() }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate('/program')}
            style={{ ...MONO, height: 52, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border-strong)'), background: 'var(--surface)', color: 'var(--text-primary)', fontSize: 11, letterSpacing: '0.2em', cursor: 'pointer' }}
          >
            SAVE
          </button>
          <button
            type="button"
            onClick={() => setStartOpen(true)}
            disabled={startDisabled}
            style={{ height: 52, borderRadius: 10, borderWidth: 0, background: startDisabled ? 'var(--surface-raised)' : 'var(--accent)', color: startDisabled ? 'var(--text-dim)' : 'var(--on-accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, letterSpacing: '0.03em', cursor: startDisabled ? 'default' : 'pointer' }}
          >
            START
          </button>
        </div>
        {hasSchedule === false && (
          <p style={{ margin: '10px 0 0', textAlign: 'center', fontSize: 14, lineHeight: 1.4, color: 'var(--text-secondary)' }}>{NO_SCHEDULE_START_REASON}</p>
        )}
      </div>

      {startOpen && (
        <StartProgramSheet
          programs={savedPrograms}
          presetProgramId={program.id}
          runningName={activeMeso?.name ?? null}
          onClose={() => setStartOpen(false)}
          onCreateProgram={() => setStartOpen(false)}
        />
      )}

      {sharedGroups.length > 0 && !g14Dismissed && (
        <G14Prompt
          programName={program.name}
          groups={sharedGroups}
          workoutDays={workoutDays}
          isPending={splitWorkouts.isPending}
          onKeepAsIs={() => setG14Dismissed(true)}
          onConfirmSplit={() => splitWorkouts.mutateAsync({ schedule: program.schedule, workoutDays, groups: sharedGroups }).then(() => setG14Dismissed(true))}
        />
      )}
    </div>
  )
}

// ─── G14 prompt ─────────────────────────────────────────────────────────────
// TASKS.md, verbatim: choices are per-weekday workouts or "keep as is" (the sequence choice is chunk 25's, DECISIONS 44 (a)). PP1b draws it as a
// sheet and PP4b its second, explicit confirm. Dismissing (KEEP AS IS, the × or the scrim) changes no row; the per-weekday split only runs after
// the confirm. A failed split says so in the confirm, with the server's own message (PP4b: "Couldn't split the schedule: …"; SPEC Errors (15)),
// and CONFIRM stays there to try again.

const DOW_LABEL: Record<DayOfWeek, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
}

function G14Prompt({
  programName,
  groups,
  workoutDays,
  isPending,
  onKeepAsIs,
  onConfirmSplit,
}: {
  programName: string
  groups: SharedWeekdayGroup[]
  workoutDays: { id: string; name: string }[]
  isPending: boolean
  onKeepAsIs: () => void
  onConfirmSplit: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<{ reason: unknown } | null>(null)
  const newWorkoutCount = groups.reduce((sum, g) => sum + (g.weekdays.length - 1), 0)

  async function confirmSplit() {
    setFailure(null)
    try {
      await onConfirmSplit()
    } catch (reason) {
      setFailure({ reason })
    }
  }

  return (
    <>
      <BottomSheet
        eyebrow={programName.toUpperCase()}
        title="One workout, several weekdays"
        onClose={onKeepAsIs}
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              style={{ ...MONO, height: 52, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--accent)'), background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: 11, letterSpacing: '0.2em', cursor: 'pointer' }}
            >
              GIVE EACH DAY ITS OWN WORKOUT
            </button>
            <button
              type="button"
              onClick={onKeepAsIs}
              style={{ ...MONO, height: 52, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border-strong)'), background: 'var(--surface)', color: 'var(--text-primary)', fontSize: 11, letterSpacing: '0.2em', cursor: 'pointer' }}
            >
              KEEP AS IS
            </button>
          </div>
        }
      >
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
          This program plans the same workout on more than one weekday, so a change to it affects every one of those days.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {groups.map((g) => {
            const name = workoutDays.find((d) => d.id === g.workoutDayId)?.name ?? 'This workout'
            return (
              <div key={g.workoutDayId} style={{ background: 'var(--surface-raised)', ...hairline('var(--border-subtle)'), borderRadius: 10, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{name}</span>
                <span style={{ ...CAPTION, letterSpacing: '0.12em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{g.weekdays.map((d) => DOW_LABEL[d]).join(' · ')}</span>
              </div>
            )
          })}
        </div>
      </BottomSheet>

      {confirming && (
        <ConfirmDialog
          title="Give each weekday its own workout?"
          body={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span>
                {`Creates ${newWorkoutCount} new workout${newWorkoutCount === 1 ? '' : 's'}: a copy of each shared one for every extra weekday, which then points at the copy. The original keeps its first weekday. This can't be undone.`}
              </span>
              {failure && (
                <span role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, lineHeight: 1.45, color: 'var(--error)', overflowWrap: 'anywhere' }}>
                  <CircleAlert size={16} aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 2 }} />
                  <span>{`Couldn't split the schedule: ${errorReason(failure.reason, offline())}`}</span>
                </span>
              )}
            </div>
          }
          isPending={isPending}
          onConfirm={confirmSplit}
          onCancel={() => { setFailure(null); setConfirming(false) }}
        />
      )}
    </>
  )
}
