// Chunk 58a — one row of the workout, whatever state it is in (TASKS-1.2 58a: "one row component per state, `useExerciseCardState.ts`
// deciding which from `currentSet()`"). ExerciseCard and SupersetBlock draw every row of a card through this.
// Chunk 60 (SPEC [1.2] "Log lock (18a)", G54; board W1): every open row has its boxes and LOG, and `currentSet()` only says which of them is
// styled as the current one. LOG on any row goes through the log lock (`useExerciseCardState`'s `lockFor`, 46r's `lockDecision`): it logs at once,
// or the row's `LogOrderPrompt` asks first, and confirming runs the row's own LOG (the unchanged write path).
// Chunk 61 (boards W7, W8, W9, W2b): an open row's ⋯ is the set options sheet and a logged row's pen is the edit panel; both reach what the card owns
// (CUES, and DELETE's W9 question) through `RowMenu`, built here. W9 itself is the card's (`CardDeleteConfirm`), not the row's, because its row is out
// of the order as soon as its delete starts.
// Chunk 62 (boards W7a, W7, W2b): the SET TYPE row of the ⋯ and of the edit panel opens the type picker, which this row mounts outside its own frames as it does
// the cues sheet (`WorkoutSetTypeSheet`), and the old ADD STAGE and "mark as dropset" buttons after a logged head are gone: a drop is a type the set is given.
import { Fragment, useRef, useState } from 'react'
import type { SessionSetChangeType, SetLog } from '../../types'
import { cuesSummary } from '../../components/pickers/pickerLogic'
import { errorReason } from '../../components/exercisePickerLogic'
import { useSettingsStore } from '../settings/settingsStore'
import { useToastStore } from '../notifications/toastStore'
import type { SupersetChainInput } from './restChain'
import type { ExerciseCardState } from './useExerciseCardState'
import { sameType, type ResolvedRow, type TypedNumbers } from './workoutRules'
import { resolveStageCarryWeightKg } from './stageCarryLogic'
import LogOrderPrompt, { type LogOrderQuestion } from './LogOrderPrompt'
import DeleteSetConfirm from './DeleteSetConfirm'
import SetCuesSheet from './SetCuesSheet'
import WorkoutSetTypeSheet from './WorkoutSetTypeSheet'
import { UNLOG_BLOCKED_NOTE, typeRowText } from './setOptionsView'
import SetRowCurrent, { type RowMenu } from './SetRowCurrent'
import SetRowLogged from './SetRowLogged'
import SetRowWarmup from './SetRowWarmup'
import { SetRowLocked, SetRowSkipped } from './SetRowUpcoming'
import { lastLineText, stageChipText, stageLock } from './workoutRowView'

const MONO = 'var(--font-mono)'

interface WorkoutRowProps {
  state: ExerciseCardState
  row: ResolvedRow
  /** The session's current set (`currentSet()`): the one row of the screen that is styled as current (every open row has inputs since chunk 60). */
  current: ResolvedRow | null
  /** A superset cell's round context for the rest chain (chunk 16); absent outside a block. */
  supersetContext?: SupersetChainInput
}

export default function WorkoutRow(props: WorkoutRowProps) {
  const { state, row } = props
  // The log lock (chunk 60): every LOG of this row, a warmup's too, passes `guard` with what it would do. `state.lockFor(row)` says 'log' for the
  // current row, for every row with "Log sets in order" off and for every warmup (G54), and then it logs at once; otherwise the question is
  // held, with the LOG it stands for, until it is answered. The sheet is this row's own, so a CANCEL leaves the row's boxes as typed.
  const [asking, setAsking] = useState<{ question: LogOrderQuestion; log: () => void } | null>(null)
  function guard(log: () => void) {
    const decision = state.lockFor(row)
    if (decision === 'log') log()
    else setAsking({ question: decision, log })
  }
  // Chunk 61: the set's ⋯ (CUES, DELETE) and its edit panel (DELETE) reach the cues sheet, which this row owns and mounts outside its own frames (a
  // sheet's events never bubble through a row), and W9's confirm, which the card owns (`CardDeleteConfirm`).
  const [cuesOpen, setCuesOpen] = useState(false)
  const cues = state.cuesOf(row)
  // Chunk 62: SET TYPE. A warmup logged with no weight or reps asks for both in the panel before its type changes (DECISIONS 152 (a)): the picker then only
  // hands back what was picked (`heldType`), and SAVE writes it with the numbers in one request.
  const showToast = useToastStore((s) => s.show)
  const [typeOpen, setTypeOpen] = useState(false)
  const [heldType, setHeldType] = useState<SessionSetChangeType | null>(null)
  const holdsPick = row.state === 'logged' && row.type?.kind === 'warmup' && state.needsNumbers(row, { kind: 'normal' })
  async function saveHeldType(numbers: TypedNumbers): Promise<void> {
    if (heldType === null) return
    try {
      await state.changeSetType(row, heldType, { numbers })
      setHeldType(null)
    } catch (err) {
      console.error('[workout] set type change failed', err)
      showToast(`Couldn't change the set type. ${errorReason(err, typeof navigator !== 'undefined' && navigator.onLine === false)}`)
      throw err
    }
  }
  const menu: RowMenu = {
    cuesText: cues === null ? null : cuesSummary(cues.planned.tags ?? []),
    openCues: () => setCuesOpen(true),
    askDelete: () => state.askDelete(row),
    openSetType: () => setTypeOpen(true),
    heldType,
    clearHeldType: () => setHeldType(null),
    saveHeldType,
    // Chunk 63: UNLOG (SPEC 18c: no confirm, works offline). A refused request says why, as a type change does; the set is then still logged.
    unlog: () => {
      state.handleUnlogRow(row).catch((err) => {
        console.error('[workout] unlog failed', err)
        showToast(`Couldn't unlog the set. ${errorReason(err, typeof navigator !== 'undefined' && navigator.onLine === false)}`)
      })
    },
    unlogNote: row.state !== 'logged' || state.canUnlogRow(row) ? null : UNLOG_BLOCKED_NOTE,
  }
  return (
    <>
      <RowBody {...props} guard={guard} menu={menu} />
      {asking !== null && (
        <LogOrderPrompt
          exerciseName={row.exerciseName}
          question={asking.question}
          onConfirm={() => {
            setAsking(null)
            asking.log()
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {typeOpen && row.type !== null && (
        <WorkoutSetTypeSheet
          row={row}
          state={state}
          value={holdsPick ? (heldType ?? row.type) : row.type}
          {...(holdsPick ? { onHold: (pick: SessionSetChangeType) => setHeldType(sameType(pick, row.type!) ? null : pick) } : {})}
          onClose={() => setTypeOpen(false)}
        />
      )}
      {cuesOpen && cues !== null && (
        <SetCuesSheet
          exerciseName={row.exerciseName}
          setNumber={row.number}
          planned={cues.planned}
          heads={cues.heads}
          mesocycleId={state.writers.mesocycleId}
          weekNumber={state.writers.weekNumber}
          isCycle={state.writers.isCycle}
          onClose={() => setCuesOpen(false)}
        />
      )}
    </>
  )
}

/**
 * W9 for a card: asked by a row's ⋯ or edit panel (`state.askDelete`), answered here. It is mounted by the card, not by the row, so it outlives the row
 * it names (the row is out of the order as soon as its delete starts); it says why a delete didn't happen and can be answered again.
 */
export function CardDeleteConfirm({ state }: { state: ExerciseCardState }) {
  const open = state.confirmDelete
  return open === null ? null : <DeleteConfirmDialog key={open.row.key} state={state} open={open} />
}

function DeleteConfirmDialog({ state, open }: { state: ExerciseCardState; open: NonNullable<ExerciseCardState['confirmDelete']> }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ headline: string; reason: string } | null>(null)
  // A second press while the delete is out is ignored: a ref, because two presses in one instant both read the state before React draws.
  const inFlight = useRef(false)

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      await state.handleDeleteRow(open.row)
      state.closeDeleteConfirm()
    } catch (err) {
      console.error('[workout] delete failed', err)
      setError({ headline: "Couldn't delete the set.", reason: errorReason(err, typeof navigator !== 'undefined' && navigator.onLine === false) })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return <DeleteSetConfirm eyebrow={open.eyebrow} title={open.title} body={open.body} pending={pending} error={error} onConfirm={() => void confirm()} onCancel={state.closeDeleteConfirm} />
}

function RowBody({ state, row, current, supersetContext, guard, menu }: WorkoutRowProps & { guard: (log: () => void) => void; menu: RowMenu }) {
  const warmupDisplay = useSettingsStore((s) => s.warmupDisplay)
  const unit = state.resolvedWeightUnit
  // What the row shows is the targets of its plan's set: a set a swap moved here shows the ones it had on the card it left (chunk 59).
  const planned = state.targetsOf(row)
  const log = state.logOf(row)
  const isStage = row.kind === 'stage'

  if (row.kind === 'warmup') {
    return (
      <SetRowWarmup
        key={row.key}
        row={row}
        planned={planned}
        log={log}
        unit={unit}
        display={warmupDisplay === 'tick' ? 'tick' : 'rows'}
        restElapsed={state.currentRestElapsed}
        draft={state.draftOf(row)}
        onLog={(params) => guard(() => void state.logWarmup(row, params))}
        onUpdate={(changes) => log && state.onUpdateSet(log.id, changes)}
        onDelete={() => {
          if (log) state.onDeleteSet(log.id).catch((err) => console.error('Failed to delete warmup', err))
        }}
        onAskDelete={menu.askDelete}
        menu={menu}
      />
    )
  }
  if (row.state === 'skipped') return <SetRowSkipped key={row.key} row={row} onDelete={menu.askDelete} />
  if (row.state === 'logged') {
    if (log === null) return null
    return (
      <SetRowLogged
        key={row.key}
        row={row}
        log={log}
        resolvedUnit={unit}
        typeText={isStage ? null : typeRowText(row.type)}
        menu={menu}
        onUpdate={(changes) => state.onUpdateSet(log.id, changes)}
        onDelete={menu.askDelete}
      />
    )
  }
  const lock = stageLock(row, state.cardRows)
  if (lock !== null) return <SetRowLocked key={row.key} row={row} planned={planned} unit={unit} lock={lock} />
  // Every other open row has its boxes too (chunk 60; SPEC "every row can be typed into", board W1); only the current row is styled as it and
  // draws "couldn't load last week" with its RETRY.
  const isCurrent = current !== null && row.key === current.key
  const headRow = isStage ? state.cardRows.find((r) => r.key === row.headKey) : undefined
  const headLog = headRow ? state.logOf(headRow) : null
  const stageLogs = headLog ? stageLogsOf(state.logs, headLog) : []
  return (
    <SetRowCurrent
      key={row.key}
      row={row}
      planned={planned}
      resolvedUnit={unit}
      lastLine={lastLineText(state.lastFor(row), unit)}
      lastLoading={row.kind === 'working' && state.lastLoading}
      lastFailed={isCurrent && row.kind === 'working' && state.lastFailed}
      onRetryLast={state.retryLast}
      carryWeightKg={headLog && row.stageKind ? resolveStageCarryWeightKg(row.stageKind, { head: headLog, stages: stageLogs }) : null}
      restElapsed={state.currentRestElapsed}
      isCurrent={isCurrent}
      menu={menu}
      draft={state.draftOf(row)}
      beforeLog={guard}
      onLog={(params) => void (isStage ? state.logStage(row, params, supersetContext) : state.logHead(row, params, supersetContext))}
    />
  )
}

const stageLogsOf = (logs: readonly SetLog[], head: SetLog): SetLog[] =>
  logs.filter((log) => log.parentSetId === head.id).sort((a, b) => a.stageIndex - b.stageIndex)

/**
 * The card's rows in order, each through `WorkoutRow`, with a staged head's chip above its row while stages are still to come (board W3: "DROPSET · 2 DROPS").
 * A drop is part of the set's type now (chunk 62): no button after a logged head adds one.
 */
export function CardRows({
  state,
  stateOf,
  rows,
  current,
  supersetContextOf,
}: {
  state: ExerciseCardState
  /** In a superset block each row belongs to its own member's card: the state that draws and writes it. */
  stateOf?: (row: ResolvedRow) => ExerciseCardState
  rows: readonly ResolvedRow[]
  current: ResolvedRow | null
  supersetContextOf?: (row: ResolvedRow) => SupersetChainInput | undefined
}) {
  return (
    <>
      {rows.map((row) => {
        // The chip says what is coming ("DROPSET · 2 DROPS"); once every stage under the head is logged or skipped the logged stage
        // rows carry their own kind marker (boards W3: no chip above a finished group).
        const stagesPending = row.kind === 'working' && rows.some((r) => r.kind === 'stage' && r.headKey === row.key && r.state === 'unlogged')
        const chip = row.kind === 'working' && row.type?.kind === 'staged' && stagesPending ? stageChipText(row.type.stageKind, row.type.stageCount) : null
        const rowState = stateOf?.(row) ?? state
        return (
          <Fragment key={row.key}>
            {chip && (
              <span
                className="inline-block text-xs font-bold px-2 py-0.5 rounded"
                style={{ marginLeft: 36, backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em' }}
              >
                {chip}
              </span>
            )}
            <WorkoutRow state={rowState} row={row} current={current} supersetContext={supersetContextOf?.(row)} />
          </Fragment>
        )
      })}
    </>
  )
}
