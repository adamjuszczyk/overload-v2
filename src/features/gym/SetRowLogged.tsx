// Chunk 58a — a logged set's row (boards W1, W2, W3): a compact line with its numbers, a pen and a tick (SPEC [1.2] "Row states":
// "logged → compact read-only line with a tick and a pen"). A drop carries its kind (board W3: DROP, REST-PAUSE, MYO-REPS, CLUSTER).
// Chunk 61 (board W2b; SPEC [1.2] "A logged row shows a pen next to its tick (18d). Tapping the row opens its edit panel"): the pen opens
// `SetEditPanel` in place of the row, which replaces 1.1's inline edit; the writes are today's: `onUpdate` is `updateSetLog`'s patch, and
// DELETE asks W9 (`onDelete`, the row's own confirm) before it deletes anything. Chunk 62: the panel's SET TYPE row opens the type picker (`menu.openSetType`).
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { FormRating, SetLog, WeightUnit } from '../../types'
import type { ResolvedRow } from './workoutRules'
import SetEditPanel from './SetEditPanel'
import type { RowMenu } from './SetRowCurrent'
import { FAILED_ROW_BACKGROUND, RowLabel, SyncMark, rowFrame, useRowSyncFailed } from './setRowParts'
import { loggedText, rowLabelText, stageKindWord } from './workoutRowView'

interface SetRowLoggedProps {
  row: ResolvedRow
  log: SetLog
  resolvedUnit: WeightUnit
  /** The panel's SET TYPE row ("Normal", "Dropset · 1 drop"); null for a drop (it has no type of its own). */
  typeText: string | null
  /** The row's menu (chunk 62): the SET TYPE row opens the type picker through it. */
  menu?: RowMenu
  onUpdate: (changes: { weight: number | null; reps: number | null; rir?: number | null; formRating?: FormRating | null }) => void
  /** DELETE in the panel: the row asks W9. */
  onDelete: () => void
}

export default function SetRowLogged({ row, log, resolvedUnit, typeText, menu, onUpdate, onDelete }: SetRowLoggedProps) {
  const [isEditing, setIsEditing] = useState(false)
  // Board W6: a row whose write stopped retrying is tinted (and says ONLY ON THIS PHONE · RETRY).
  const syncFailed = useRowSyncFailed(log.id)
  const isStage = row.kind === 'stage'

  if (isEditing) {
    return (
      <div data-row-key={row.key}>
        <SetEditPanel
          label={rowLabelText(row)}
          log={log}
          resolvedUnit={resolvedUnit}
          isWarmup={false}
          typeText={typeText}
          onSetType={menu === undefined ? undefined : menu.openSetType}
          onSave={(changes) => {
            onUpdate(changes)
            setIsEditing(false)
          }}
          onCancel={() => setIsEditing(false)}
          onDelete={onDelete}
        />
      </div>
    )
  }

  const text = loggedText(log, resolvedUnit)
  return (
    <div style={rowFrame({ backgroundColor: syncFailed ? FAILED_ROW_BACKGROUND : 'var(--surface)', ...(syncFailed ? { flexWrap: 'wrap', rowGap: 0, paddingTop: 2, paddingBottom: 2 } : {}) })} data-row-key={row.key} data-row-state="logged">
      <RowLabel text={rowLabelText(row)} />
      <span className="flex-1 text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', ...(syncFailed ? { whiteSpace: 'nowrap', flex: '1 1 auto' } : {}) }}>
        {text.weight}
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}> {text.unit} </span>× {text.reps}
        {text.rir !== '' && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}> {text.rir}</span>}
        {isStage && (
          <span className="ml-2 text-xs px-1 rounded" style={{ backgroundColor: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            {stageKindWord(row.stageKind)}
          </span>
        )}
      </span>
      <button type="button" onClick={() => setIsEditing(true)} className="flex-shrink-0 flex items-center justify-center" style={{ width: 28, height: 28, color: 'var(--text-muted)' }} aria-label="Edit set">
        <Pencil size={13} />
      </button>
      <SyncMark logId={log.id} />
    </div>
  )
}
