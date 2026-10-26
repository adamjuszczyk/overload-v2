// Chunk 62 (TASKS-1.2 62; SPEC [1.2] "Set type during a workout (19), (19c)", "Offline (G47)"; DECISIONS 141, 146 (a), 147, 150 (b), 152 (a), 161, 167 (a),
// 168 (a), 173; board W7a): what a set's new type writes, and in which order. `applySetTypeChange` (46r) says everything a change calls for; this file sends it,
// as `setDelete.ts` sends a delete. The card calls `runTypeChange` once per change and the screen's writers do the requests.
//
// WHERE A TYPE LIVES (SPEC Objects stored, "set kind and stage kind as done"; never the plan):
//   - a LOGGED head: its log (`is_warmup`, `stage_kind`), the drops it has (stage logs), and the drops still to log in a `pending_stages` row keyed by the
//     log (the set's total, logged drops included: RULES); a logged PLANNED head also has its `retyped` row, keyed by the planned set (141: REVIEW reads the
//     type as done through the change rows);
//   - an UPCOMING planned set: the `retyped` row alone (the log doesn't exist yet; LOG then writes the retyped kind, `useExerciseCardState.logHead`);
//   - an UPCOMING added set: the card's own state (`useWorkoutRows.setAddedType`), written with its log when it is logged (161).
//
// THE ORDER for a logged head (G47: the change needs a connection, so every request is awaited and the first refusal stops the rest):
//   1. the log's patch: the type and, for a numberless warmup made a working set, its weight and reps in the same request (152: the table refuses the type
//      alone, 23514). Nothing destructive happens unless this one went through;
//   2. the logged drops that go, the last first (19c: the caller asked first);
//   3. the change rows (`retyped`, `pending_stages`), replacing the rows the session holds by their ids;
//   4. the renumber (a switch to or from Warmup, 146 (a), 173): `set_number` patches, 58a's `patch` item, which is what 178's corrections write too.
// A change that stopped part way is idempotent: the screen reads the type from the rows it finds, the user presses the same pick again, and
// `applySetTypeChange` is asked again from what is there.
//
// An UPCOMING set's change works offline (168 (a): "the switch and the renumbering of later logged sets queue offline, like a delete"): the `retyped` row is a
// queued upsert and the renumber queued `patch` items. A change on a LOGGED set is not queued (G47: "A set type change on a logged set ... need[s] a
// connection"): the queue's `patch` item admits `set_number` and a null `stage_kind` and nothing else, and this chunk adds no shape (the coordinator's brief,
// 61's carry note).
import type { StageKind } from '../../lib/plannerVocabulary'
import type { SessionSetChangeType } from '../../types'
import type { SetType } from '../../components/pickers/pickerLogic'
import type { SessionWriters } from './setDelete'
import { DELETE_NOTE, optionsEyebrow } from './setOptionsView'
import type { LoggedSet, ResolvedRow, SetTypeChange } from './workoutRules'

/** What the picker holds for a set's type (`SetType`, which also carries the rest between stages the workout doesn't store). */
export function toPickerType(type: SessionSetChangeType | null): SetType {
  if (type === null || type.kind === 'normal') return { kind: 'normal' }
  if (type.kind === 'warmup') return { kind: 'warmup' }
  return { kind: 'staged', stageKind: type.stageKind, stageCount: type.stageCount, stageRestSeconds: null }
}

/** What a picked `SetType` stores: the type without the rest between stages (`v2_session_set_changes` has no column for it). */
export function fromPickerType(type: SetType): SessionSetChangeType {
  return type.kind === 'staged' ? { kind: 'staged', stageKind: type.stageKind, stageCount: type.stageCount } : { kind: type.kind }
}

/** A change on a logged set needs a connection (G47); the panel's SET TYPE row is off offline and this is what the card throws if it is asked anyway. */
export class RequiresConnectionError extends Error {
  constructor() {
    super('Requires a connection')
    this.name = 'RequiresConnectionError'
  }
}

/** What the card asks for when it writes a type change: the screen's writers, the awaited delete of one log, and the card's own list of added sets. */
export interface TypeChangeDeps {
  writers: Pick<SessionWriters, 'online' | 'writeChanges' | 'patchNumbers' | 'patchLog'>
  /** One log: the screen's `useDeleteSetLog` (online the request). A drop names its head. */
  deleteLog: (log: Pick<LoggedSet, 'id' | 'parentSetId'>) => Promise<void>
  /** An added set that isn't logged yet keeps its type in the card (DECISIONS 161): `useWorkoutRows.setAddedType` for the row's entry. */
  keepAddedType: (type: SessionSetChangeType) => void
}

export async function runTypeChange(row: ResolvedRow, effects: SetTypeChange, { writers, deleteLog, keepAddedType }: TypeChangeDeps): Promise<void> {
  if (!effects.changed) return
  if (row.state === 'logged') {
    if (!writers.online) throw new RequiresConnectionError()
    if (row.logId === null || effects.headPatch === null) throw new RangeError(`the logged row ${row.key} has no log to patch`)
    await writers.patchLog(row.logId, effects.headPatch)
    for (const stage of effects.stagesToDelete) await deleteLog({ id: stage.id, parentSetId: row.logId })
  } else if (row.weekPlanSetId === null) {
    // An added set that isn't logged: the card's state, nothing to send. The logged sets after it still move when it joins or leaves the warmups.
    keepAddedType(effects.type)
  }
  if (effects.changes.length > 0) await writers.writeChanges(effects.changes)
  if (effects.renumber.length > 0) await writers.patchNumbers(effects.renumber)
}

/** The question 19c asks before logged drops are deleted. */
export interface TypeConfirm {
  eyebrow: string
  /** `Delete the 2 logged drops?` */
  title: string
  /** `Only today's session changes; the plan stays the same.` */
  body: string
  /** `DELETE 2 DROPS` / `DELETE DROP`: the button. */
  confirmLabel: string
}

const noun = (kind: StageKind): string => (kind === 'dropset' ? 'drop' : 'stage')

/**
 * SPEC 19c: "Switching a set back to Normal when some of its drops are already logged asks before deleting them." The words are TASKS 62's ("Delete the 2
 * logged drops?", "Delete the 1 logged drop?"); no board draws the question, so the dialog is W9's (`DeleteSetConfirm`) with its own button, and the word
 * for a stage of any kind but a dropset is "stage" as everywhere else (D31, provisional). `count` is `SetTypeChange.confirmCount`, the done drops only.
 */
export function typeConfirm(row: ResolvedRow, count: number): TypeConfirm {
  const stageKind = row.type?.kind === 'staged' ? row.type.stageKind : 'dropset'
  const word = noun(stageKind)
  const plural = count === 1 ? word : `${word}s`
  return {
    eyebrow: optionsEyebrow(row),
    title: `Delete the ${count} logged ${plural}?`,
    body: DELETE_NOTE,
    confirmLabel: count === 1 ? `DELETE ${word.toUpperCase()}` : `DELETE ${count} ${word.toUpperCase()}S`,
  }
}
