import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import ExercisePickerSheet from '../../components/ExercisePickerSheet'
import { groupLabel } from '../../components/exercisePickerLogic'
import { formatRestClock } from '../../components/pickers/pickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import { groupIntoUnits } from '../../lib/supersetGroups'
import { useSettingsStore } from '../settings/settingsStore'
import { useSequenceCurrentCycle } from '../plan/useSequenceCurrentCycle'
import type { DayOfWeek, Exercise, Mesocycle, Program } from '../../types'
import {
  addExercise,
  addRoutineItem,
  canLinkBelow,
  editRoutineItem,
  linkWithBelow,
  moveExercise,
  moveExerciseToUnit,
  moveRoutineItem,
  removeExercise,
  removeRoutineItem,
  renameWorkout,
  setBlockRest,
  setExerciseRest,
  setExerciseTempo,
  setExerciseUnit,
  splitAfter,
  swapExercise,
  undoRemove,
  unlinkBlock,
  type DraftEntry,
  type DraftState,
} from './changeProgramDraft'
import { dragTarget } from './changeProgramDrag'
import ChangeProgramExerciseSheet from './ChangeProgramExerciseSheet'
import { BlockCard, RemovedLine, type CardBlock, type CardHandlers, type CardItem, type CardMarker } from './ChangeProgramExerciseCard'
import ChangeProgramWarmupCard from './ChangeProgramWarmupCard'
import { daysOfWorkout, type RunCopyExerciseRow } from './programChange'
import { scheduleForWeek } from './runSchedule'
import { useChangeProgram, weekOfRun } from './useChangeProgram'
import { useMesos } from './useMesos'
import { usePrograms } from './usePrograms'

// Chunk 51a (TASKS-1.2 "CHANGE THE PROGRAM: the screen, exercise-level changes and SAVE"; SPEC Programs and runs [1.2] → "Changing a
// running program: CHANGE THE PROGRAM", Screens → CHANGE THE PROGRAM; boards PL1, PL2, PL3, PL7, PL8, PL9, and PL4–PL6 through
// chunk 41's sheet). One screen edits the running program's COPY: its exercises (add, swap, remove, order), supersets, the warmup
// routine, each exercise's rest, rest after, tempo and unit, and the workouts' names. Nothing is written until SAVE CHANGES, which
// lands the whole edit on every session that hasn't started, from the current week on, in one request; CANCEL leaves nothing behind.
// Weekdays (the DAYS card) and the stable program's set rows are chunk 51b's; on a stable run this screen draws without them.
//
// Display choices no board settles, provisional under D31: a workout is renamed with a RENAME button under the WORKOUTS chips (the
// board puts RENAME in the DAYS card, which a sequence run doesn't have and chunk 51b adds); the chips show the days in force this
// week and scroll sideways when they don't fit; the save error sits above CANCEL and SAVE CHANGES under "Couldn't save the changes."
// (the real reason under it, SPEC Errors (15)); a failed or empty load says so in the same words as Plan's.

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }
const CAPTION: CSSProperties = { ...MONO, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

const DAY_SHORT: Record<DayOfWeek, string> = { monday: 'MON', tuesday: 'TUE', wednesday: 'WED', thursday: 'THU', friday: 'FRI', saturday: 'SAT', sunday: 'SUN' }

const letterOf = (index: number): string => String.fromCharCode(65 + index)

// ─── The route ───────────────────────────────────────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--base)' }}>
      <div className="animate-spin" style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
    </div>
  )
}

function LoadError({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--base)', padding: 16 }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <p style={{ ...MONO, fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--error)', margin: 0 }}>COULDN'T LOAD THE PROGRAM</p>
        <p style={{ ...MONO, fontSize: 10, color: 'var(--text-dim)', margin: 0 }}>{reason}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} style={{ ...MONO, height: 40, padding: '0 16px', borderRadius: 10, ...hairline('var(--border-strong)'), background: 'var(--surface)', fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-primary)', cursor: 'pointer' }}>
            TRY AGAIN
          </button>
        )}
      </div>
    </div>
  )
}

export default function ChangeProgramPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const mesosRead = useMesos()
  const programsRead = usePrograms()
  // Back to where the screen was opened from (Plan, and from chunk 65 EDIT PROGRAM). A page opened with no history (a reload, a
  // link) goes to Plan.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/plan', { replace: true }))

  if (mesosRead.isError && !mesosRead.data) return <LoadError reason={reasonOf(mesosRead.error)} onRetry={() => void mesosRead.refetch()} />
  if (programsRead.isError && !programsRead.data) return <LoadError reason={reasonOf(programsRead.error)} onRetry={() => void programsRead.refetch()} />
  if (!mesosRead.data || !programsRead.data) return <Spinner />

  const meso = mesosRead.data.find((m) => m.status === 'active')
  // No program is running: there is nothing to change, and Plan says so (PR2).
  if (!meso) return <Navigate to="/plan" replace />
  const program = programsRead.data.find((p) => p.id === meso.programId)
  if (!program) return <LoadError reason="This program's copy couldn't be found." />
  const savedName = programsRead.data.find((p) => p.id === meso.sourceProgramId)?.name ?? meso.name

  return (program.scheduleType ?? 'weekday') === 'sequence' ? (
    <SequenceWrapper meso={meso} program={program} savedName={savedName} onDone={goBack} />
  ) : (
    <ChangeProgramScreen meso={meso} program={program} savedName={savedName} currentWeek={weekOfRun(meso.startDate)} onDone={goBack} />
  )
}

function reasonOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string' && (error as { message: string }).message.trim() !== ''
    ? (error as { message: string }).message
    : 'Something went wrong.'
}

// A sequence run's current week is its current cycle, which three reads decide (Plan's own wrapper does the same).
function SequenceWrapper(props: { meso: Mesocycle; program: Program; savedName: string; onDone: () => void }) {
  const { cycle, failed } = useSequenceCurrentCycle(props.meso.id, props.meso.programId)
  if (cycle === null) return failed ? <LoadError reason="The current cycle couldn't be read." /> : <Spinner />
  return <ChangeProgramScreen {...props} currentWeek={cycle} />
}

// ─── The screen ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface ScreenProps {
  meso: Mesocycle
  program: Program
  savedName: string
  currentWeek: number
  onDone: () => void
}

type PickerState = { mode: 'add'; workoutId: string } | { mode: 'swap'; workoutId: string; key: string; exerciseId: string }

function ChangeProgramScreen({ meso, program, savedName, currentWeek, onDone }: ScreenProps) {
  const planningType = program.planningType ?? 'week_dependent'
  const isSequence = (program.scheduleType ?? 'weekday') === 'sequence'
  const unitWord = isSequence ? 'cycle' : 'week'
  const globalUnit = useSettingsStore((s) => s.weightUnit)
  const screen = useChangeProgram({ meso, program, savedName, currentWeek, onDone })
  const { draft, source, update, rule, startWeek } = screen

  const [workoutId, setWorkoutId] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [sheetKey, setSheetKey] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [dragging, setDragging] = useState<{ blockKey: string; dy: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const rowById = useMemo(() => new Map<string, RunCopyExerciseRow>((source?.runCopy.exercises ?? []).map((e) => [e.id, e])), [source])

  if (screen.load === 'error') return <LoadError reason={screen.loadError ?? 'Something went wrong.'} onRetry={screen.reload} />
  if (!draft || !source || !rule) return <Spinner />

  const workouts = draft.edit.workouts
  const selected = workouts.find((w) => w.id === workoutId) ?? workouts[0]
  if (!selected) return <LoadError reason="This program has no workouts." />

  const schedule = isSequence ? null : scheduleForWeek(source.scheduleRows, source.runCopy.schedule, currentWeek)
  const exerciseIdOf = (e: DraftEntry): string => (e.kind === 'kept' ? rowById.get(e.id)?.exerciseId ?? '' : e.exerciseId)
  const exerciseName = (e: DraftEntry): string => screen.exerciseOf(exerciseIdOf(e))?.name ?? 'Exercise'

  // ── The cards of the selected workout
  const baselineEntries = new Map<string, DraftEntry>()
  const units = groupIntoUnits(selected.exercises.map((e) => ({ id: e.key, supersetBlockId: e.supersetBlockId, entry: e })))
  const blockLetters = new Map<string, string>()
  units.filter((u) => u.length >= 2).forEach((u, i) => blockLetters.set(u[0].supersetBlockId!, letterOf(i)))

  const blockRest = (blockId: string) => draft.edit.blocks.find((b) => b.id === blockId)
  for (const e of selected.exercises) if (e.kind === 'kept') baselineEntries.set(e.key, rowAsEntry(e.key, rowById.get(e.id)))

  function markersOf(e: DraftEntry): CardMarker[] {
    const base = baselineEntries.get(e.key)
    const out: CardMarker[] = []
    if (e.restSeconds !== null) out.push({ label: `REST ${formatRestClock(e.restSeconds)}`, changed: base === undefined || base.restSeconds !== e.restSeconds })
    if (e.restAfterSeconds !== null) out.push({ label: `REST AFTER ${formatRestClock(e.restAfterSeconds)}`, changed: base === undefined || base.restAfterSeconds !== e.restAfterSeconds })
    if (e.tempo !== null) out.push({ label: `TEMPO ${e.tempo}`, changed: base === undefined || base.tempo !== e.tempo })
    // A unit that differs from Settings' is the one that changes what the user sees (Plan's STRUCTURE marker says the same).
    if (e.weightUnit !== null && e.weightUnit !== globalUnit) out.push({ label: `UNIT ${e.weightUnit.toUpperCase()}`, changed: base === undefined || base.weightUnit !== e.weightUnit })
    return out
  }

  function itemOf(e: DraftEntry, canLink: boolean, letter: string | null): CardItem {
    const exercise = screen.exerciseOf(exerciseIdOf(e))
    const group = exercise ? groupLabel(exercise) : ''
    const tag = e.kind === 'added' ? ' · NEW' : e.kind === 'swapped' ? ' · SWAPPED' : ''
    return {
      key: e.key,
      name: exercise?.name ?? 'Exercise',
      muscle: `${group}${tag}`,
      isChanged: e.kind !== 'kept',
      markers: markersOf(e),
      // A week-dependent run holds no sets here: a new exercise arrives with none (SPEC).
      note: e.kind === 'added' && planningType === 'week_dependent' ? `New. It lands in ${unitWord} ${startWeek} with no sets; add them in Plan.` : null,
      letter,
      canLink,
    }
  }

  const blocks: CardBlock[] = units.map((unit) => {
    const isSuperset = unit.length >= 2
    const blockId = unit[0].supersetBlockId
    const rest = isSuperset && blockId ? blockRest(blockId) : undefined
    return {
      key: unit[0].id,
      items: unit.map((m, i) => itemOf(m.entry, !isSuperset && canLinkBelow(selected, m.id), isSuperset ? letterOf(i) : null)),
      superset:
        isSuperset && blockId
          ? {
              blockId,
              letter: blockLetters.get(blockId) ?? 'A',
              restAfterText: rest && rest.restAfterRoundSeconds !== null ? `Rest ${formatRestClock(rest.restAfterRoundSeconds)} after each round` : null,
            }
          : null,
    }
  })

  const removedHere = draft.removed.filter((r) => r.workoutId === selected.id)
  const entryByKey = (key: string): DraftEntry | undefined => selected.exercises.find((e) => e.key === key)

  const edit = (fn: (s: DraftState) => DraftState) => update(fn)

  // ── Drag to reorder: pointer events on the grip; the dragged card follows the pointer and lands where it was let go.
  function onGripPointerDown(blockKey: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || !listRef.current) return
    const cards = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-unit-key]'))
    const centers = cards.map((c) => {
      const r = c.getBoundingClientRect()
      return r.top + r.height / 2
    })
    const from = cards.findIndex((c) => c.dataset.unitKey === blockKey)
    if (from < 0) return
    const startY = event.clientY
    const target = (y: number) => dragTarget(centers, from, centers[from] + (y - startY))
    setDragging({ blockKey, dy: 0 })
    const move = (ev: PointerEvent) => setDragging({ blockKey, dy: ev.clientY - startY })
    const finish = (commit: boolean, y: number) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      setDragging(null)
      const to = target(y)
      if (commit && to !== from) edit((s) => moveExerciseToUnit(s, selected.id, blockKey, to))
    }
    const up = (ev: PointerEvent) => finish(true, ev.clientY)
    const cancel = (ev: PointerEvent) => finish(false, ev.clientY)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  const handlers: CardHandlers = {
    onOptions: (key) => setSheetKey(key),
    onSwap: (key) => {
      const e = entryByKey(key)
      if (e) setPicker({ mode: 'swap', workoutId: selected.id, key, exerciseId: exerciseIdOf(e) })
    },
    onLink: (key) => edit((s) => linkWithBelow(s, selected.id, key)),
    onRemove: (key) => setRemoving(key),
    onUnlink: (blockId) => edit((s) => unlinkBlock(s, selected.id, blockId)),
    onSplitAfter: (key) => edit((s) => splitAfter(s, selected.id, key)),
    onMove: (key, direction) => edit((s) => moveExercise(s, selected.id, key, direction)),
    onGripPointerDown,
  }

  // ── The exercise ⋯ sheet
  const sheetEntry = sheetKey ? entryByKey(sheetKey) : undefined
  const sheetUnit = sheetEntry ? units.findIndex((u) => u.some((m) => m.id === sheetEntry.key)) : -1
  const sheetBlockId = sheetEntry?.supersetBlockId ?? null
  const sheetMembers = sheetBlockId ? selected.exercises.filter((e) => e.supersetBlockId === sheetBlockId) : []
  const sheetIsMember = sheetEntry !== undefined && sheetMembers.length >= 2

  // ── Number the cards: there is no DAYS card until chunk 51b, so the warmup routine is 1 and the exercises 2.
  const warmupNumber = 1
  const exercisesNumber = 2

  const pickerExclude = picker ? (workouts.find((w) => w.id === picker.workoutId)?.exercises ?? []).map(exerciseIdOf) : []

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', background: 'var(--base)', color: 'var(--text-primary)' }}>
      <div style={{ padding: '16px 16px 14px', borderWidth: '0 0 1px', borderStyle: 'solid', borderColor: 'var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          type="button"
          aria-label="Back to Plan"
          onClick={() => (screen.differs ? setConfirmCancel(true) : onDone())}
          style={{ width: 44, height: 44, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border-strong)'), background: 'var(--surface-raised)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: '0 0 auto' }}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ ...CAPTION, overflowWrap: 'anywhere' }}>
            {meso.name.toUpperCase()} · {planningType === 'stable' ? 'STABLE' : 'WEEK-DEPENDENT'}
          </span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, lineHeight: 1.05, color: 'var(--text-primary)' }}>CHANGE THE PROGRAM</h1>
        </div>
      </div>

      <div style={{ flex: 1, padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ borderRadius: 12, background: 'var(--accent-muted)', ...hairline('var(--accent)'), padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35, color: 'var(--text-primary)' }}>{rule.headline}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{rule.detail}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={CAPTION}>WORKOUTS</span>
            <span style={{ ...MONO, display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
              <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--accent-muted)', ...hairline('var(--accent)') }} />
              CHANGED IN THIS EDIT
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
            {workouts.map((w) => {
              const on = w.id === selected.id
              const days = schedule ? daysOfWorkout(schedule, w.id).map((d) => DAY_SHORT[d]).join(' · ') : ''
              return (
                <button
                  key={w.id}
                  type="button"
                  aria-current={on}
                  onClick={() => {
                    setWorkoutId(w.id)
                    setRenaming(false)
                  }}
                  style={{
                    flex: '0 0 auto',
                    minWidth: 64,
                    height: 52,
                    padding: '0 12px',
                    borderRadius: 10,
                    ...hairline(on ? 'var(--accent)' : 'var(--border)'),
                    background: on ? 'var(--accent)' : 'var(--surface)',
                    color: on ? 'var(--on-accent)' : 'var(--text-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    gap: 3,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>{w.name}</span>
                  {days !== '' && <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.15em', opacity: 0.85, whiteSpace: 'nowrap' }}>{days}</span>}
                </button>
              )
            })}
          </div>
          {renaming ? (
            <RenameRow
              key={selected.id}
              initial={selected.name}
              onDone={(name) => {
                setRenaming(false)
                if (name !== null && name !== selected.name) edit((s) => renameWorkout(s, selected.id, name))
              }}
            />
          ) : (
            <button
              type="button"
              aria-label={`Rename ${selected.name}`}
              onClick={() => setRenaming(true)}
              style={{ ...MONO, alignSelf: 'flex-start', height: 36, padding: '0 10px', borderRadius: 8, ...hairline('var(--border)'), background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-primary)', cursor: 'pointer' }}
            >
              <Pencil size={13} aria-hidden="true" />
              RENAME
            </button>
          )}
        </div>

        <ChangeProgramWarmupCard
          key={`routine-${selected.id}`}
          number={warmupNumber}
          items={selected.routine}
          everyText={isSequence ? 'EVERY CYCLE' : 'EVERY WEEK'}
          everyWord={unitWord}
          onAdd={(body) => edit((s) => addRoutineItem(s, selected.id, body))}
          onEdit={(key, body) => edit((s) => editRoutineItem(s, selected.id, key, body))}
          onMove={(key, direction) => edit((s) => moveRoutineItem(s, selected.id, key, direction))}
          onRemove={(key) => edit((s) => removeRoutineItem(s, selected.id, key))}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={CAPTION}>{exercisesNumber} · EXERCISES · DRAG TO REORDER</span>
          <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blocks.map((block, i) => (
              <div
                key={block.key}
                style={
                  dragging?.blockKey === block.key
                    ? { position: 'relative', zIndex: 2, transform: `translateY(${dragging.dy}px)`, opacity: 0.92, boxShadow: '0 6px 18px rgba(0,0,0,0.35)' }
                    : undefined
                }
              >
                <BlockCard block={block} unitIndex={i} handlers={handlers} />
              </div>
            ))}
          </div>
          {removedHere.map((r) => (
            <RemovedLine
              key={r.entry.key}
              name={exerciseName(r.entry)}
              sinceText={`REMOVED FROM ${unitWord.toUpperCase()} ${startWeek}`}
              onUndo={() => edit((s) => undoRemove(s, r.entry.key))}
            />
          ))}
          <button
            type="button"
            onClick={() => setPicker({ mode: 'add', workoutId: selected.id })}
            style={{ ...MONO, height: 48, boxSizing: 'border-box', borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--border-strong)', background: 'transparent', fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            + ADD EXERCISE
          </button>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, background: 'var(--base)', borderWidth: '1px 0 0', borderStyle: 'solid', borderColor: 'var(--border-subtle)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {screen.saveError !== null && (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--error)' }}>Couldn't save the changes.</span>
            <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{screen.saveError}</span>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <button
            type="button"
            disabled={screen.saving}
            onClick={() => (screen.differs ? setConfirmCancel(true) : onDone())}
            style={{ ...MONO, height: 52, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border-strong)'), background: 'var(--surface)', fontSize: 11, letterSpacing: '0.2em', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            CANCEL
          </button>
          <button
            type="button"
            disabled={screen.saving}
            onClick={() => void screen.save()}
            style={{ height: 52, boxSizing: 'border-box', borderRadius: 10, borderWidth: 0, background: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, letterSpacing: '0.03em', color: 'var(--on-accent)', opacity: screen.saving ? 0.7 : 1, cursor: screen.saving ? 'default' : 'pointer' }}
          >
            {screen.saving ? 'SAVING…' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>

      {removing && entryByKey(removing) && (
        <ConfirmDialog
          title={`Remove ${exerciseName(entryByKey(removing)!)} from ${unitWord} ${startWeek}?`}
          body={`This deletes its planned sets from ${unitWord} ${startWeek} on.`}
          confirmLabel="REMOVE"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const key = removing
            setRemoving(null)
            edit((s) => removeExercise(s, selected.id, key))
          }}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Discard your changes?"
          body="Nothing has been saved. Going back leaves the program as it is."
          confirmLabel="DISCARD"
          danger
          onCancel={() => setConfirmCancel(false)}
          onConfirm={onDone}
        />
      )}

      {picker && (
        <ExercisePickerSheet
          {...(picker.mode === 'swap'
            ? { mode: 'swap' as const, replacing: { id: picker.exerciseId, muscleGroup: screen.exerciseOf(picker.exerciseId)?.muscleGroup }, title: `Swap ${screen.exerciseOf(picker.exerciseId)?.name ?? 'exercise'}` }
            : { mode: 'add' as const, title: 'Add exercise' })}
          eyebrow={`${(workouts.find((w) => w.id === picker.workoutId)?.name ?? '').toUpperCase()} · FROM ${unitWord.toUpperCase()} ${startWeek}`}
          exclude={pickerExclude}
          onClose={() => setPicker(null)}
          onPick={(exercise: Exercise) => {
            screen.remember(exercise)
            const done = picker
            setPicker(null)
            if (done.mode === 'swap') edit((s) => swapExercise(s, done.workoutId, done.key, exercise.id))
            else edit((s) => addExercise(s, done.workoutId, exercise.id, globalUnit))
          }}
        />
      )}

      {sheetEntry && (
        <ChangeProgramExerciseSheet
          workoutName={selected.name}
          exerciseName={exerciseName(sheetEntry)}
          unitWord={unitWord}
          startWeek={startWeek}
          restSeconds={sheetEntry.restSeconds}
          restAfterSeconds={sheetEntry.restAfterSeconds}
          tempo={sheetEntry.tempo}
          weightUnit={sheetEntry.weightUnit}
          member={
            sheetIsMember && sheetBlockId
              ? {
                  blockLetter: blockLetters.get(sheetBlockId) ?? 'A',
                  otherNames: sheetMembers.filter((m) => m.key !== sheetEntry.key).map(exerciseName),
                  withinRoundSeconds: blockRest(sheetBlockId)?.restWithinRoundSeconds ?? null,
                  afterRoundSeconds: blockRest(sheetBlockId)?.restAfterRoundSeconds ?? null,
                  onWithinRoundChange: (v) => edit((s) => setBlockRest(s, sheetBlockId, 'restWithinRoundSeconds', v)),
                  onAfterRoundChange: (v) => edit((s) => setBlockRest(s, sheetBlockId, 'restAfterRoundSeconds', v)),
                }
              : undefined
          }
          onRestChange={(v) => edit((s) => setExerciseRest(s, selected.id, sheetEntry.key, 'restSeconds', v))}
          onRestAfterChange={(v) => edit((s) => setExerciseRest(s, selected.id, sheetEntry.key, 'restAfterSeconds', v))}
          onTempoChange={(v) => edit((s) => setExerciseTempo(s, selected.id, sheetEntry.key, v))}
          onUnitChange={(v) => edit((s) => setExerciseUnit(s, selected.id, sheetEntry.key, v))}
          canMoveUp={sheetUnit > 0}
          canMoveDown={sheetUnit >= 0 && sheetUnit < units.length - 1}
          onMoveUp={() => edit((s) => moveExercise(s, selected.id, sheetEntry.key, 'up'))}
          onMoveDown={() => edit((s) => moveExercise(s, selected.id, sheetEntry.key, 'down'))}
          onClose={() => setSheetKey(null)}
        />
      )}
    </div>
  )
}

// The run copy's row as a draft entry, for "changed in this edit": the values the screen started from.
function rowAsEntry(key: string, row: RunCopyExerciseRow | undefined): DraftEntry {
  return {
    key,
    kind: 'kept',
    id: row?.id ?? '',
    supersetBlockId: row?.supersetBlockId ?? null,
    restSeconds: row?.restSeconds ?? null,
    restAfterSeconds: row?.restAfterSeconds ?? null,
    tempo: row?.tempo ?? null,
    weightUnit: row?.weightUnit ?? null,
  }
}

function RenameRow({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const blank = text.trim() === ''
  const commit = () => onDone(blank ? null : text.trim())
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        ref={ref}
        aria-label="Workout name"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') onDone(null)
        }}
        style={{ flex: 1, minWidth: 0, height: 44, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--accent)'), borderWidth: 2, background: 'var(--surface)', padding: '0 12px', fontSize: 16, color: 'var(--text-primary)', outline: 'none' }}
      />
      <button
        type="button"
        disabled={blank}
        onClick={commit}
        style={{ ...MONO, flex: '0 0 auto', height: 44, padding: '0 14px', borderRadius: 10, borderWidth: 0, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, fontSize: 11, letterSpacing: '0.15em', opacity: blank ? 0.5 : 1, cursor: blank ? 'default' : 'pointer' }}
      >
        DONE
      </button>
    </div>
  )
}
