import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { errorReason } from '../../components/exercisePickerLogic'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { fullDeleteBody, fullDeleteTitle } from './fullDeleteText'
import type { FullDeleteState } from './fullDeleteText'
import { useDeleteFinishedRun, useFinishedRunCounts } from './useMesos'

// The one confirmation behind a finished program's full delete (chunk 75; 1.2.1 item 8b; SPEC Screens → Finished program: full delete; prototype
// "Finished program": Delete, Delete (no Coach rows), Delete offline). DELETE THIS FINISHED PROGRAM on the finished page and History's program-filter
// delete both draw this and nothing else; each says what happens next (`onDeleted`): the page goes back to PROGRAMS, History resets its filter.
//
// Mounted only while it is open, so the counts are read only while it is (`useFinishedRunCounts(id, enabled)` is enabled here by the phone being
// online, and the component exists only for an open confirmation), and `useOnlineStatus` watches the phone only then.
//   - Online: "Counting what goes…" with DELETE off until the counts AND the program's session ids have both answered, then "Deletes its …" and DELETE on.
//     A read that failed keeps DELETE off and says why (ours: no board draws it). A count is named only while it is fresh: going offline and back
//     online counts again.
//   - Offline: "You're offline. Deleting needs a connection." and DELETE off. The counts are not read, and nothing is queued (SPEC Rules 2).
//   - DELETE: `useDeleteFinishedRun` (the RPC, then the phone's queue and caches); pending DELETING…; a failure stays inside as "Couldn't delete
//     [name]." and the reason the database gave (`errorReason` reads the message of a Supabase error, which is no `Error`); a second press in the same
//     instant is one delete (a ref: the pending state is not drawn yet).
//
// The program is held by the caller as a whole `{ id, name }` for as long as this is open: the program list is read again before the delete resolves
// and no longer holds it, which must not take the dialog away from under its own DELETING….

const FAILURE_CAPTION: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', color: 'var(--error)', overflowWrap: 'anywhere' }

function Failure({ caption, reason }: { caption: string; reason: string }) {
  return (
    <span role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
      <span style={FAILURE_CAPTION}>{caption}</span>
      <span style={{ fontSize: 13, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{reason}</span>
    </span>
  )
}

export default function FullDeleteConfirm({
  run,
  onCancel,
  onDeleted,
}: {
  run: { id: string; name: string }
  onCancel: () => void
  onDeleted: () => void
}) {
  const isOnline = useOnlineStatus()
  const read = useFinishedRunCounts(run.id, isOnline)
  const deleteRun = useDeleteFinishedRun()
  const [failure, setFailure] = useState<{ reason: unknown } | null>(null)
  // A second tap on DELETE in the same instant arrives before React has drawn the pending state: a ref says a delete is already out.
  const sending = useRef(false)

  // What the phone knows now. A count is named only while it is fresh: a read being made again (reconnecting asks again) is "counting", whatever the
  // last one said, and a read that failed is a failure even if an earlier one answered.
  let state: FullDeleteState
  if (!isOnline) state = { kind: 'offline' }
  else if (read.isFetching || (read.data === undefined && !read.isError)) state = { kind: 'counting' }
  else if (read.isError || read.data === undefined) state = { kind: 'failed' }
  else state = { kind: 'counted', counts: read.data.counts }
  const body = fullDeleteBody(state)

  async function confirm() {
    if (!body.canDelete || !read.data || sending.current) return
    sending.current = true
    setFailure(null)
    try {
      await deleteRun.mutateAsync({ id: run.id, sessionIds: read.data.sessionIds })
      onDeleted()
    } catch (reason) {
      setFailure({ reason })
    } finally {
      sending.current = false
    }
  }

  return (
    <ConfirmDialog
      title={fullDeleteTitle(run.name)}
      body={
        <>
          {state.kind === 'failed' ? (
            <Failure caption={body.text} reason={errorReason(read.error, false)} />
          ) : (
            <span style={{ overflowWrap: 'anywhere' }}>{body.text}</span>
          )}
          {failure && <Failure caption={`Couldn't delete ${run.name}.`} reason={errorReason(failure.reason, !isOnline)} />}
        </>
      }
      confirmLabel="DELETE"
      pendingLabel={deleteRun.isPending ? 'DELETING…' : 'DELETE'}
      danger
      isPending={deleteRun.isPending || !body.canDelete}
      onConfirm={confirm}
      onCancel={onCancel}
    />
  )
}
