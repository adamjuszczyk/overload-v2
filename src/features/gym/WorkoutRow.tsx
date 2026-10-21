// Chunk 58a — one row of the workout, whatever state it is in (TASKS-1.2 58a: "one row component per state, `useExerciseCardState.ts`
// deciding which from `currentSet()`"). ExerciseCard and SupersetBlock draw every row of a card through this.
import { Fragment, useState } from 'react'
import { Plus } from 'lucide-react'
import type { SetLog } from '../../types'
import { resolveStageKind } from '../../lib/plannerVocabulary.js'
import { useSettingsStore } from '../settings/settingsStore'
import type { SupersetChainInput } from './restChain'
import type { ExerciseCardState } from './useExerciseCardState'
import type { ResolvedRow } from './workoutRules'
import { canAddStageTo } from './setGroupLogic'
import { resolveStageCarryWeightKg } from './stageCarryLogic'
import SetRowCurrent from './SetRowCurrent'
import SetRowLogged from './SetRowLogged'
import SetRowWarmup from './SetRowWarmup'
import { SetRowLocked, SetRowSkipped, SetRowUpcoming } from './SetRowUpcoming'
import { lastLineText, stageChipText, stageLock } from './workoutRowView'

const MONO = 'var(--font-mono)'

interface WorkoutRowProps {
  state: ExerciseCardState
  row: ResolvedRow
  /** The session's current set (`currentSet()`): the one row of the screen that has inputs. */
  current: ResolvedRow | null
  /** A superset cell's round context for the rest chain (chunk 16); absent outside a block. */
  supersetContext?: SupersetChainInput
}

export default function WorkoutRow({ state, row, current, supersetContext }: WorkoutRowProps) {
  const warmupDisplay = useSettingsStore((s) => s.warmupDisplay)
  const unit = state.resolvedWeightUnit
  const planned = state.plannedOf(row)
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
        onLog={(params) => void state.logWarmup(row, params)}
        onUpdate={(changes) => log && state.onUpdateSet(log.id, changes)}
        onDelete={() => {
          if (log) state.onDeleteSet(log.id).catch((err) => console.error('Failed to delete warmup', err))
        }}
      />
    )
  }
  if (row.state === 'skipped') return <SetRowSkipped key={row.key} row={row} />
  if (row.state === 'logged') {
    if (log === null) return null
    return (
      <SetRowLogged
        key={row.key}
        row={row}
        log={log}
        resolvedUnit={unit}
        onUpdate={(changes) => state.onUpdateSet(log.id, changes)}
        onDelete={() => (isStage ? state.handleDeleteStage(row) : void state.handleDeleteHead(row))}
      />
    )
  }
  const lock = stageLock(row, state.cardRows)
  if (lock !== null) return <SetRowLocked key={row.key} row={row} planned={planned} unit={unit} lock={lock} />
  if (current !== null && row.key === current.key) {
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
        lastLoading={row.kind === 'working' && state.lastLogsLoading}
        carryWeightKg={headLog && row.stageKind ? resolveStageCarryWeightKg(row.stageKind, { head: headLog, stages: stageLogs }) : null}
        restElapsed={state.currentRestElapsed}
        onLog={(params) => void (isStage ? state.logStage(row, params, supersetContext) : state.logHead(row, params, supersetContext))}
      />
    )
  }
  return <SetRowUpcoming key={row.key} row={row} planned={planned} unit={unit} lastLine={lastLineText(state.lastFor(row), unit)} lastLoading={row.kind === 'working' && state.lastLogsLoading} />
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
