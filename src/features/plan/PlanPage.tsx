import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Trash2, Copy } from 'lucide-react'
import { differenceInWeeks, parseISO } from 'date-fns'
import type { WeekPlan, WeekPlanSet, ProgramExercise, DayOfWeek, WorkoutDay } from '../../types'
import { useMesos } from '../programs/useMesos'
import { usePrograms, useWorkoutDays, useProgramExercises } from '../programs/usePrograms'
import {
  useWeekPlans,
  useSetDeload,
  useAddSet,
  useUpdateSet,
  useRemoveSet,
  useCopyFromPreviousWeek,
} from './useWeekPlan'

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_ORDER: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

const DOW_LABEL: Record<DayOfWeek, string> = {
  monday: 'MONDAY', tuesday: 'TUESDAY', wednesday: 'WEDNESDAY',
  thursday: 'THURSDAY', friday: 'FRIDAY', saturday: 'SATURDAY', sunday: 'SUNDAY',
}

function computeWeekNumber(startDate: string): number {
  return differenceInWeeks(new Date(), parseISO(startDate)) + 1
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const navigate = useNavigate()
  const { data: mesos = [], isLoading: mesosLoading } = useMesos()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null

  const currentWeek = activeMeso ? computeWeekNumber(activeMeso.startDate) : 1
  const [viewWeek, setViewWeek] = useState(1)

  useEffect(() => {
    if (activeMeso) setViewWeek(computeWeekNumber(activeMeso.startDate))
  }, [activeMeso?.id])

  const isPast = viewWeek < currentWeek

  const { data: programs = [] } = usePrograms()
  const program = programs.find((p) => p.id === activeMeso?.programId)

  const { data: workoutDays = [], isLoading: daysLoading } = useWorkoutDays(
    activeMeso?.programId ?? '',
  )
  const { data: weekPlans = [], isLoading: plansLoading } = useWeekPlans(
    activeMeso?.id ?? '',
    viewWeek,
  )

  const copyPrev = useCopyFromPreviousWeek(activeMeso?.id ?? '', viewWeek)

  const schedule = program?.schedule
  const scheduledDays = schedule
    ? DAYS_ORDER.filter((dow) => !!schedule[dow])
        .map((dow) => ({
          dow,
          workoutDay: workoutDays.find((d) => d.id === schedule[dow]),
        }))
        .filter((x): x is { dow: DayOfWeek; workoutDay: WorkoutDay } => !!x.workoutDay)
    : []

  const showCopyButton =
    !isPast && viewWeek > 1 && weekPlans.length === 0 && !plansLoading && !daysLoading

  // ── No active meso ────────────────────────────────────────────────────────

  if (mesosLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--base)' }}>
        <div className="animate-spin" style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

  if (!activeMeso) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)', padding: '20px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2.5px', color: 'var(--text-muted)', marginBottom: 6 }}>
          OVERLOAD v2
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 28, color: 'var(--text-primary)', lineHeight: 1 }}>
          PLAN
        </h1>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)', textAlign: 'center' }}>
            NO ACTIVE MESOCYCLE
          </p>
          <button
            onClick={() => navigate('/program')}
            style={{ background: 'var(--accent)', border: 'none', borderRadius: 9, padding: '10px 22px', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: 'var(--base)', cursor: 'pointer' }}
          >
            START A MESO →
          </button>
        </div>
      </div>
    )
  }

  // ── Active meso ───────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>

      {/* Header */}
      <div style={{ padding: '20px 20px 12px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2.5px', color: 'var(--text-muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeMeso.name.toUpperCase()}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 26, color: 'var(--text-primary)', lineHeight: 1, flexShrink: 0 }}>
            PLAN
          </h1>

          {/* Week navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => setViewWeek((w) => Math.max(1, w - 1))}
              disabled={viewWeek <= 1}
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, color: viewWeek <= 1 ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: viewWeek <= 1 ? 'default' : 'pointer' }}
            >
              <ChevronLeft size={14} />
            </button>
            <div style={{ minWidth: 76, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: viewWeek === currentWeek ? 'var(--accent)' : 'var(--surface-overlay)', border: `1px solid ${viewWeek === currentWeek ? 'transparent' : 'var(--border-strong)'}`, borderRadius: 8, padding: '0 10px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, letterSpacing: '1.5px', color: viewWeek === currentWeek ? 'var(--base)' : (isPast ? 'var(--text-dim)' : 'var(--text-muted)') }}>
                WEEK {viewWeek}
              </span>
            </div>
            <button
              onClick={() => setViewWeek((w) => w + 1)}
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px', minHeight: 0 }}>

        {/* Past week notice */}
        {isPast && (
          <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-dim)' }}>
              PAST WEEK — READ ONLY
            </span>
          </div>
        )}

        {/* Copy from last week */}
        {showCopyButton && (
          <button
            onClick={() => copyPrev.mutate()}
            disabled={copyPrev.isPending}
            style={{ width: '100%', height: 48, marginBottom: 16, background: 'var(--surface)', border: '1px dashed var(--border-strong)', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: copyPrev.isPending ? 'not-allowed' : 'pointer', opacity: copyPrev.isPending ? 0.6 : 1 }}
          >
            <Copy size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-secondary)' }}>
              {copyPrev.isPending ? 'COPYING…' : 'COPY LAST WEEK'}
            </span>
          </button>
        )}

        {/* Loading */}
        {(plansLoading || daysLoading) && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
            <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
          </div>
        )}

        {/* No scheduled days */}
        {!plansLoading && !daysLoading && scheduledDays.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)', marginBottom: 12 }}>
              NO DAYS SCHEDULED
            </p>
            <button
              onClick={() => navigate(`/program/${activeMeso.programId}`)}
              style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)' }}
            >
              Set up weekly schedule →
            </button>
          </div>
        )}

        {/* Workout day panels */}
        {!plansLoading && !daysLoading &&
          scheduledDays.map(({ dow, workoutDay }) => {
            const weekPlan = weekPlans.find((wp) => wp.workoutDayId === workoutDay.id)
            return (
              <WorkoutDayPanel
                key={workoutDay.id}
                dow={dow}
                workoutDay={workoutDay}
                weekPlan={weekPlan}
                isPast={isPast}
                mesoId={activeMeso.id}
                weekNumber={viewWeek}
              />
            )
          })}
      </div>
    </div>
  )
}

// ─── Workout Day Panel ────────────────────────────────────────────────────────

interface PanelProps {
  dow: DayOfWeek
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | undefined
  isPast: boolean
  mesoId: string
  weekNumber: number
}

function WorkoutDayPanel({ dow, workoutDay, weekPlan, isPast, mesoId, weekNumber }: PanelProps) {
  const { data: programExercises = [] } = useProgramExercises(workoutDay.id)

  const addSet = useAddSet(mesoId, weekNumber)
  const removeSet = useRemoveSet(mesoId, weekNumber)
  const updateSet = useUpdateSet(mesoId, weekNumber)
  const toggleDeload = useSetDeload(mesoId, weekNumber)

  const sets = weekPlan?.sets ?? []

  function handleAddSet(pe: ProgramExercise) {
    const existingForEx = sets.filter((s) => s.programExerciseId === pe.id)
    addSet.mutate({
      workoutDayId: workoutDay.id,
      weekPlanId: weekPlan?.id,
      programExerciseId: pe.id,
      setNumber: existingForEx.length + 1,
    })
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}>
            {DOW_LABEL[dow]}
          </span>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', lineHeight: 1.1 }}>
            {workoutDay.name}
          </div>
        </div>

        {/* Deload toggle — only renders if a weekPlan row exists */}
        {weekPlan && (
          <button
            onClick={() => !isPast && toggleDeload.mutate({ weekPlanId: weekPlan.id, isDeload: !weekPlan.isDeload })}
            disabled={isPast}
            style={{ height: 26, padding: '0 10px', background: weekPlan.isDeload ? 'var(--accent-muted)' : 'var(--surface-overlay)', border: `1px solid ${weekPlan.isDeload ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: isPast ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: weekPlan.isDeload ? 'var(--accent)' : 'var(--text-dim)', flexShrink: 0 }}
          >
            DELOAD
          </button>
        )}
      </div>

      {/* Exercise card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {programExercises.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              NO EXERCISES IN THIS DAY
            </p>
          </div>
        ) : (
          programExercises.map((pe, idx) => {
            const exerciseSets = sets
              .filter((s) => s.programExerciseId === pe.id)
              .sort((a, b) => a.setNumber - b.setNumber)

            return (
              <ExerciseSection
                key={pe.id}
                pe={pe}
                sets={exerciseSets}
                isPast={isPast}
                isLast={idx === programExercises.length - 1}
                onAddSet={() => handleAddSet(pe)}
                onRemoveSet={(id) => removeSet.mutate(id)}
                onUpdateSet={(id, changes) => updateSet.mutate({ id, changes })}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Exercise Section ─────────────────────────────────────────────────────────

interface ExerciseSectionProps {
  pe: ProgramExercise
  sets: WeekPlanSet[]
  isPast: boolean
  isLast: boolean
  onAddSet: () => void
  onRemoveSet: (id: string) => void
  onUpdateSet: (id: string, changes: { targetRir?: number | null; isDropset?: boolean }) => void
}

function ExerciseSection({ pe, sets, isPast, isLast, onAddSet, onRemoveSet, onUpdateSet }: ExerciseSectionProps) {
  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)' }}>
      {/* Exercise header row */}
      <div style={{ padding: '12px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pe.exercise?.name ?? '—'}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 2 }}>
            {pe.exercise?.muscleGroup?.toUpperCase()}
            {pe.targetReps !== null && (
              <span style={{ color: 'var(--text-dim)' }}> · {pe.targetReps} REPS</span>
            )}
          </div>
        </div>
        {!isPast && (
          <button
            onClick={onAddSet}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-muted)', border: '1px solid var(--accent)', borderRadius: 7, cursor: 'pointer', color: 'var(--accent)', flexShrink: 0 }}
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {/* Set rows */}
      {sets.length > 0 && (
        <div style={{ paddingBottom: 10 }}>
          {sets.map((set, idx) => (
            <SetRow
              key={set.id}
              set={set}
              displayNumber={idx + 1}
              isPast={isPast}
              onRemove={() => onRemoveSet(set.id)}
              onUpdate={(changes) => onUpdateSet(set.id, changes)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Set Row ──────────────────────────────────────────────────────────────────

function SetRow({
  set,
  displayNumber,
  isPast,
  onRemove,
  onUpdate,
}: {
  set: WeekPlanSet
  displayNumber: number
  isPast: boolean
  onRemove: () => void
  onUpdate: (changes: { targetRir?: number | null; isDropset?: boolean }) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '3px 16px', gap: 8 }}>
      {/* Set number */}
      <span style={{ width: 22, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, color: 'var(--text-dim)', flexShrink: 0 }}>
        {String(displayNumber).padStart(2, '0')}
      </span>

      {/* RIR stepper */}
      <RirStepper
        value={set.targetRir}
        disabled={isPast}
        onChange={(v) => onUpdate({ targetRir: v })}
      />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Dropset toggle */}
      <button
        disabled={isPast}
        onClick={() => !isPast && onUpdate({ isDropset: !set.isDropset })}
        style={{ height: 28, padding: '0 9px', background: set.isDropset ? 'var(--accent-muted)' : 'transparent', border: `1px solid ${set.isDropset ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: isPast ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', color: set.isDropset ? 'var(--accent)' : 'var(--text-dim)', flexShrink: 0 }}
      >
        DROP
      </button>

      {/* Remove */}
      {isPast ? (
        <div style={{ width: 28 }} />
      ) : (
        <button
          onClick={onRemove}
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}

// ─── RIR Stepper ──────────────────────────────────────────────────────────────

function RirStepper({
  value,
  disabled,
  onChange,
}: {
  value: number | null
  disabled: boolean
  onChange: (v: number | null) => void
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', height: 28, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 6, flexShrink: 0 }}>
      <button
        disabled={disabled || value === null}
        onClick={() => {
          if (value === null) return
          onChange(value === 0 ? null : value - 1)
        }}
        style={{ width: 24, height: 28, background: 'transparent', border: 'none', color: (disabled || value === null) ? 'var(--text-dim)' : 'var(--text-muted)', cursor: (disabled || value === null) ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        −
      </button>
      <div style={{ minWidth: 56, textAlign: 'center' }}>
        {value === null ? (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: 'var(--text-dim)' }}>
            NO RIR
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>
            RIR {value}
          </span>
        )}
      </div>
      <button
        disabled={disabled}
        onClick={() => onChange(value === null ? 3 : Math.min(value + 1, 9))}
        style={{ width: 24, height: 28, background: 'transparent', border: 'none', color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        +
      </button>
    </div>
  )
}
