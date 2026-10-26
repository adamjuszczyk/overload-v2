// Chunk 58a — one row of the workout, whatever state it is in (TASKS-1.2 58a: "one row component per state, `useExerciseCardState.ts`
// deciding which from `currentSet()`"). ExerciseCard and SupersetBlock draw every row of a card through this.
// Chunk 60 (SPEC [1.2] "Log lock (18a)", G54; board W1): every open row has its boxes and LOG, and `currentSet()` only says which of them is
// styled as the current one. LOG on any row goes through the log lock (`useExerciseCardState`'s `lockFor`, 46r's `lockDecision`): it logs at once,
// or the row's `LogOrderPrompt` asks first, and confirming runs the row's own LOG (the unchanged write path).
import { Fragment, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { SetLog } from '../../types'
import { cuesSummary } from '../../components/pickers/pickerLogic'
import { errorReason } from '../../components/exercisePickerLogic'
import { resolveStageKind } from '../../lib/plannerVocabulary.js'
import { useSettingsStore } from '../settings/settingsStore'
import type { SupersetChainInput } from './restChain'
import type { ExerciseCardState } from './useExerciseCardState'
import type { ResolvedRow } from './workoutRules'
import { canAddStageTo } from './setGroupLogic'
import { resolveStageCarryWeightKg } from './stageCarryLogic'
import LogOrderPrompt, { type LogOrderQuestion } from './LogOrderPrompt'
import DeleteSetConfirm from './DeleteSetConfirm'
import SetCuesSheet from './SetCuesSheet'
import { deleteConfirm, loggedNumbersText, plannedNumbersText, typeRowText } from './setOptionsView'
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
  // Chunk 61: the set's ⋯ (CUES, DELETE) and its edit panel (DELETE) reach two sheets of this row's own: the cues sheet and W9's confirm. They are
  // mounted here, outside the row's own frames, so a sheet's events never bubble through a row.
  const [confirming, setConfirming] = useState(false)
  const [cuesOpen, setCuesOpen] = useState(false)
  const cues = state.cuesOf(row)
  const menu: RowMenu = {
    cuesText: cues === null ? null : cuesSummary(cues.planned.tags ?? []),
    openCues: () => setCuesOpen(true),
    askDelete: () => setConfirming(true),
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
      {confirming && <RowDeleteConfirm state={state} row={row} onClose={() => setConfirming(false)} />}
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

/** W9 over a row: the numbers it would delete, and the delete itself, which says why when it didn't happen. */
function RowDeleteConfirm({ state, row, onClose }: { state: ExerciseCardState; row: ResolvedRow; onClose: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ headline: string; reason: string } | null>(null)
  // A second press while the delete is out is ignored: a ref, because two presses in one instant both read the state before React draws.
  const inFlight = useRef(false)
  const log = state.logOf(row)
  const unit = state.resolvedWeightUnit
  const numbers = log !== null ? loggedNumbersText(log, unit) : plannedNumbersText(state.targetsOf(row), unit)
  const text = deleteConfirm(row, numbers)

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      await state.handleDeleteRow(row)
      onClose()
    } catch (err) {
      console.error('[workout] delete failed', err)
      setError({ headline: "Couldn't delete the set.", reason: errorReason(err, typeof navigator !== 'undefined' && navigator.onLine === false) })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return <DeleteSetConfirm {...text} pending={pending} error={error} onConfirm={() => void confirm()} onCancel={onClose} />
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
        onLog={(params) => guard(() => void state.logWarmup(row, params))}
        onUpdate={(changes) => log && state.onUpdateSet(log.id, changes)}
        onDelete={() => {
          if (log) state.onDeleteSet(log.id).catch((err) => console.error('Failed to delete warmup', err))
        }}
        onAskDelete={menu.askDelete}
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
      beforeLog={guard}
      onLog={(params) => void (isStage ? state.logStage(row, params, supersetContext) : state.logHead(row, params, supersetContext))}
    />
  )
}

const stageLogsOf = (logs: readonly SetLog[], head: SetLog): SetLog[] =>
  logs.filter((log) => log.parentSetId === head.id).sort((a, b) => a.stageIndex - b.stageIndex)

/**
 * The card's rows in order, each through `WorkoutRow`, with a staged head's chip above its row while stages are still to come (board W3: "DROPSET · 2 DROPS") and,
 * after the last row of a logged head's group, today's ADD STAGE / "mark as dropset" (chunk 62 removes them with the set type picker).
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
      {rows.map((row, i) => {
        const next = rows[i + 1]
        const endsGroup = row.kind !== 'warmup' && (next === undefined || next.kind !== 'stage' || next.headKey !== (row.kind === 'stage' ? row.headKey : row.key))
        const head = row.kind === 'stage' ? rows.find((r) => r.key === row.headKey) : row
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
            {endsGroup && head !== undefined && <AddStage state={rowState} head={head} rows={rows} supersetContext={supersetContextOf?.(head)} />}
          </Fragment>
        )
      })}
    </>
  )
}

// ADD STAGE and "mark as dropset" (SPEC "Set types and staged sets": they stay until chunk 62's picker replaces them): a drop nobody
// planned, under a logged head, logged with the head as its parent. With a planned drop still open there is a row for it instead.
function AddStage({ state, head, rows, supersetContext }: { state: ExerciseCardState; head: ResolvedRow; rows: readonly ResolvedRow[]; supersetContext?: SupersetChainInput }) {
  const [adding, setAdding] = useState(false)
  const headLog = head.kind === 'working' && head.state === 'logged' ? state.logOf(head) : null
  if (headLog === null || !canAddStageTo(headLog)) return null
  if (rows.some((r) => r.kind === 'stage' && r.headKey === head.key && r.state === 'unlogged')) return null
  const stageLogs = stageLogsOf(state.logs, headLog)
  const stageKind = resolveStageKind(headLog.stageKind ?? head.stageKind ?? null)
  const synthetic: ResolvedRow = { ...head, key: `${head.key}:adhoc`, kind: 'stage', state: 'unlogged', logId: null, headKey: head.key, stageNumber: stageLogs.length + 1, stageKind, type: null }
  if (adding) {
    return (
      <SetRowCurrent
        key={synthetic.key}
        row={synthetic}
        planned={null}
        resolvedUnit={state.resolvedWeightUnit}
        lastLine=""
        carryWeightKg={resolveStageCarryWeightKg(stageKind, { head: headLog, stages: stageLogs })}
        restElapsed={state.currentRestElapsed}
        onLog={(params) => {
          void state.logAdHocStage(head, params, supersetContext)
          setAdding(false)
        }}
      />
    )
  }
  return stageLogs.length === 0 ? (
    <button type="button" onClick={() => setAdding(true)} className="flex items-center text-xs font-medium" style={{ minHeight: 36, marginLeft: 36, color: 'var(--text-muted)', fontFamily: MONO, fontSize: 10 }}>
      mark as dropset
    </button>
  ) : (
    <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-xs font-bold tracking-widest" style={{ minHeight: 36, marginLeft: 36, color: 'var(--text-muted)', fontFamily: MONO }}>
      <Plus size={11} />
      ADD STAGE
    </button>
  )
}
