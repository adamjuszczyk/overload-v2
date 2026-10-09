import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, X, AlertTriangle } from 'lucide-react'
import type { DayOfWeek } from '../../types'
import { usePrograms, useWorkoutDays, useUpdateProgramName } from '../programs/usePrograms'
import { useStartRun } from '../programs/useMesos'
import { useToastStore } from '../notifications/toastStore'
import { detectSharedWeekdayWorkouts, useSplitSharedWeekdayWorkouts, type SharedWeekdayGroup } from './usePlanner'
import StepPriorities from './StepPriorities'
import StepExercises from './StepExercises'
import StepVolume from './StepVolume'

// The stepped program planner (SPEC.md "Program planner"; TASKS.md chunk
// 11 — "Three steps... priorities (skippable), exercises & order with the
// weekday schedule, volume"). Routed at /program/:programId, replacing
// ProgramBuilderPage/WorkoutDayEditorPage/WeeklyScheduleGrid (all removed
// this chunk).
//
// Every edit here (rename, add/remove workout or exercise, schedule, sets)
// commits immediately through its own mutation, the same write-through
// pattern the old builder already used (and chunk 10's PrioritiesEditor
// still does) — there is no separate client-only draft. SAVE and START
// below are therefore not a bulk write: by the time either is tapped, the
// program already looks exactly as shown. SAVE simply leaves the planner
// (so "open, then save unchanged" writes nothing at all — reviewer note 1's
// own proof); START activates it (v2_start_run, chunk 6).
//
// Reached only against a `kind = 'saved'` program (ProgramsPage.tsx's
// "saved programs" list and its "+" create flow, since chunk 26 — formerly
// ProgramPage.tsx's "my programs") — step 1 and Save/Start are
// hidden for any other kind as a defensive fallback, never the intended
// path (a stable run's own copy is edited inline in Plan's Program tab,
// ProgramTab.tsx, with the same step 2/3 components below, not through this
// route).
type Step = 'priorities' | 'exercises' | 'volume'

const STEPS: { id: Step; label: string }[] = [
  { id: 'priorities', label: '1 · PRIORITIES' },
  { id: 'exercises', label: '2 · EXERCISES' },
  { id: 'volume', label: '3 · VOLUME' },
]

export default function PlannerPage() {
  const { programId } = useParams<{ programId: string }>()
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)

  const { data: programs = [], isLoading: programsLoading } = usePrograms()
  const program = programs.find((p) => p.id === programId)
  const { data: workoutDays = [] } = useWorkoutDays(programId ?? '')

  const isSaved = (program?.kind ?? 'saved') === 'saved'
  const [step, setStep] = useState<Step>('priorities')

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const updateName = useUpdateProgramName()

  useEffect(() => {
    if (editingName) nameRef.current?.focus()
  }, [editingName])

  // G14 (TASKS.md, Adam 2026-10-05) — an existing program whose schedule
  // puts one workout on several weekdays. Detected once per program load;
  // dismissing ("keep as is") or splitting both resolve it for this visit
  // — re-opening a program that was left "as is" shows the prompt again
  // next time, since nothing was stored to remember the dismissal (TASKS.md:
  // "nothing is converted automatically", and SPEC names no persisted
  // acknowledgement either).
  const sharedGroups = program ? detectSharedWeekdayWorkouts(program.schedule) : []
  const [g14Dismissed, setG14Dismissed] = useState(false)
  const splitWorkouts = useSplitSharedWeekdayWorkouts(programId ?? '')

  const startRun = useStartRun()

  if (programsLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="animate-spin" style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

  if (!program) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
          PROGRAM NOT FOUND
        </p>
        <button
          onClick={() => navigate('/program')}
          style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
        >
          ← Back to programs
        </button>
      </div>
    )
  }

  async function saveName() {
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== program!.name) {
      await updateName.mutateAsync({ id: program!.id, name: trimmed })
    }
    setEditingName(false)
  }

  async function handleStart() {
    try {
      await startRun.mutateAsync({ name: program!.name, programId: program!.id })
      navigate('/plan')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start this program')
    }
  }

  const visibleSteps = isSaved ? STEPS : STEPS.filter((s) => s.id !== 'priorities')
  const activeStep = isSaved ? step : (step === 'priorities' ? 'exercises' : step)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => navigate('/program')}
          aria-label="Back to programs"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 9, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
        >
          <ArrowLeft size={16} />
        </button>

        {editingName ? (
          <input
            ref={nameRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') nameRef.current?.blur() }}
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', padding: '4px 0', outline: 'none' }}
          />
        ) : (
          <button
            onClick={() => { setNameValue(program.name); setEditingName(true) }}
            style={{ flex: 1, background: 'transparent', border: 'none', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {program.name}
          </button>
        )}
      </div>

      {/* Step switcher — "back and forward between steps" (TASKS.md); any
          step is reachable at any time, nothing here blocks moving on. */}
      <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', borderRadius: 11, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {visibleSteps.map((s) => (
            <button
              key={s.id}
              onClick={() => setStep(s.id)}
              style={{ flex: 1, padding: '10px 2px', background: activeStep === s.id ? 'var(--accent)' : 'var(--surface)', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: activeStep === s.id ? 'var(--base)' : 'var(--text-muted)' }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', minHeight: 0 }}>
        {activeStep === 'priorities' && <StepPriorities programId={program.id} />}
        {activeStep === 'exercises' && <StepExercises program={program} volumeReadOnly={false} />}
        {activeStep === 'volume' && <StepVolume program={program} volumeReadOnly={false} canChangePlanningType={isSaved} />}
      </div>

      {/* Save / Start — visible from any step (TASKS.md: "save stores the
          program as is; Start creates a run"). Hidden for the defensive
          run-kind fallback (see header comment) — a run is already active,
          "saving"/"starting" it again has no meaning. */}
      {isSaved && (
        <div style={{ display: 'flex', gap: 10, padding: '12px 20px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <button
            onClick={() => navigate('/program')}
            style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1.5px', color: 'var(--text-secondary)' }}
          >
            SAVE
          </button>
          <button
            onClick={handleStart}
            disabled={startRun.isPending}
            style={{ flex: 1, height: 50, background: startRun.isPending ? 'var(--border-strong)' : 'var(--accent)', border: 'none', borderRadius: 10, cursor: startRun.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: startRun.isPending ? 'var(--text-muted)' : 'var(--base)' }}
          >
            {startRun.isPending ? '…' : 'START'}
          </button>
        </div>
      )}

      {isSaved && sharedGroups.length > 0 && !g14Dismissed && (
        <G14Prompt
          groups={sharedGroups}
          workoutDays={workoutDays}
          isPending={splitWorkouts.isPending}
          onKeepAsIs={() => setG14Dismissed(true)}
          onConfirmSplit={async () => {
            try {
              await splitWorkouts.mutateAsync({ schedule: program.schedule, workoutDays, groups: sharedGroups })
              setG14Dismissed(true)
            } catch (err) {
              showToast(err instanceof Error ? err.message : 'Could not split the schedule')
            }
          }}
        />
      )}
    </div>
  )
}

// ─── G14 prompt ─────────────────────────────────────────────────────────────
// TASKS.md, verbatim: choices are per-weekday workouts or "keep as is" (the
// sequence choice is chunk 25's, DECISIONS 44 (a)). Dismissing (either
// button on the first view, or the backdrop/X) changes no row; the
// per-weekday split only runs after this sheet's own second, explicit
// confirm step.

const DOW_LABEL: Record<DayOfWeek, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
}

function G14Prompt({
  groups,
  workoutDays,
  isPending,
  onKeepAsIs,
  onConfirmSplit,
}: {
  groups: SharedWeekdayGroup[]
  workoutDays: { id: string; name: string }[]
  isPending: boolean
  onKeepAsIs: () => void
  onConfirmSplit: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const newWorkoutCount = groups.reduce((sum, g) => sum + (g.weekdays.length - 1), 0)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}
      onClick={(e) => { if (e.target === e.currentTarget) onKeepAsIs() }}
    >
      <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', border: '1px solid var(--border)', borderBottom: 'none', maxHeight: '80dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <AlertTriangle size={20} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', marginBottom: 6 }}>
              {confirming ? 'Give each weekday its own workout?' : 'One workout, several weekdays'}
            </p>
            {!confirming && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                This program plans the same session for more than one weekday — a change there affects every one of those days.
              </p>
            )}
          </div>
          <button
            onClick={onKeepAsIs}
            aria-label="Dismiss"
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
          >
            <X size={13} />
          </button>
        </div>

        {!confirming && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {groups.map((g) => {
              const name = workoutDays.find((d) => d.id === g.workoutDayId)?.name ?? 'This workout'
              return (
                <div key={g.workoutDayId} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{name}</span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', marginTop: 2 }}>
                    {g.weekdays.map((d) => DOW_LABEL[d]).join(' · ')}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {confirming && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            This creates {newWorkoutCount} new workout{newWorkoutCount === 1 ? '' : 's'} — a copy of each shared one for every extra weekday — and points those weekdays at the copy instead. The original keeps its first weekday. This cannot be undone.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          {!confirming ? (
            <>
              <button
                onClick={onKeepAsIs}
                style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11, letterSpacing: '1px', color: 'var(--text-secondary)' }}
              >
                KEEP AS IS
              </button>
              <button
                onClick={() => setConfirming(true)}
                style={{ flex: 1, height: 50, background: 'var(--accent-muted)', border: '1px solid var(--accent)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 11, letterSpacing: '1px', color: 'var(--accent)' }}
              >
                GIVE EACH DAY ITS OWN WORKOUT
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirming(false)}
                style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', color: 'var(--text-secondary)' }}
              >
                CANCEL
              </button>
              <button
                onClick={onConfirmSplit}
                disabled={isPending}
                style={{ flex: 1, height: 50, background: isPending ? 'var(--border-strong)' : 'var(--accent)', border: 'none', borderRadius: 10, cursor: isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: isPending ? 'var(--text-muted)' : 'var(--base)' }}
              >
                {isPending ? '…' : 'CONFIRM'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
