import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import BottomSheet from '../../components/BottomSheet'
import { errorReason } from '../../components/exercisePickerLogic'
import { primaryAction, reviewItemText, type ReviewAction, type ReviewEntry, type ReviewGroup } from './review'
import { reviewEyebrow, reviewExplanation, reviewFailureHeadline, reviewPendingLabel, type ReviewUnit } from './reviewLogic'
import type { DecideArgs } from './reviewService'
import { useReview, useReviewAction, type ReviewReadArgs } from './useReview'

// Chunk 56 (TASKS-1.2 "REVIEW"; SPEC [1.2] Review (13) and Actions (Defaults 4); board 4): the sheet the line opens. Every item of last week
// that is left to decide, under the day and workout it came from ("TUE · PULL 1"), worded by chunk 43's `reviewItemText`, each with IGNORE
// and its one action: USE, ADD THIS SET, REMOVE THIS SET, ADD EXERCISE or SWAP FROM WEEK N. An action writes at once (`useReviewAction`:
// the item's writes and its decision row in one request) and a decided item is gone, for good, when the request has settled.
//
// While one request is out every button is off: two decisions on one exercise would both compute their set numbers from the plan as it
// was read, and the second would number its set like the first. A failed action keeps its item, with a line under its buttons: the headline
// and the real reason (SPEC Errors (15)).
//
// Display choices no board settles, provisional under D31: the pressed button reads USING…, ADDING…, REMOVING…, SWAPPING… or IGNORING… while
// its request is out; with every item decided the sheet reads "Nothing left to decide." until it is closed; a read that fails or is still
// out draws the page's spinner or "Couldn't load last week." with its reason.

export interface ReviewSheetProps extends ReviewReadArgs {
  unit: ReviewUnit
  /** CHANGE THE PROGRAM's week (the first session not started): "SWAP FROM WEEK N" and "from week N on" (chunk 45's `changeStartWeek`). */
  fromWeek: number
  program: DecideArgs['program']
  onClose: () => void
}

const CAPTION: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

const CARD: CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
}

const BUTTON: CSSProperties = {
  height: 44,
  boxSizing: 'border-box',
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'solid',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: '0.15em',
  cursor: 'pointer',
}

const SPINNER_RING: CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: 'var(--accent)',
  borderRightColor: 'var(--border-strong)',
  borderBottomColor: 'var(--border-strong)',
  borderLeftColor: 'var(--border-strong)',
}

interface ItemProps {
  entry: ReviewEntry
  fromWeek: number
  unit: ReviewUnit
  pending: ReviewAction | null
  busy: boolean
  error: { action: ReviewAction; message: string } | undefined
  onPress: (action: ReviewAction) => void
}

function Item({ entry, fromWeek, unit, pending, busy, error, onPress }: ItemProps) {
  const text = reviewItemText(entry.item, { fromWeek, period: unit })
  const main = primaryAction(entry.item)
  return (
    <div data-review-item={entry.key} style={CARD}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...CAPTION, fontSize: 9, letterSpacing: '0.18em' }}>{text.eyebrow}</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{text.headline}</span>
        {text.detail && <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)' }}>{text.detail}</span>}
      </div>
      {text.note && <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{text.note}</span>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => onPress('ignore')}
          style={{ ...BUTTON, borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)' }}
        >
          {pending === 'ignore' ? reviewPendingLabel('ignore') : 'IGNORE'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onPress(main)}
          style={{ ...BUTTON, borderColor: 'var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)' }}
        >
          {pending === main ? reviewPendingLabel(main) : text.action}
        </button>
      </div>
      {error && (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', color: 'var(--error)' }}>{reviewFailureHeadline(error.action)}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{error.message}</span>
        </div>
      )}
    </div>
  )
}

export default function ReviewSheet({ unit, fromWeek, program, onClose, ...args }: ReviewSheetProps) {
  const read = useReview(args)
  const act = useReviewAction(program)
  const [pending, setPending] = useState<{ key: string; action: ReviewAction } | null>(null)
  const [errors, setErrors] = useState<Record<string, { action: ReviewAction; message: string }>>({})
  const inFlight = useRef(false)
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  async function decide(group: ReviewGroup, entry: ReviewEntry, action: ReviewAction) {
    const weekPlan = args.thisWeek.find((plan) => plan.id === group.weekPlanId)
    if (inFlight.current || !weekPlan) return
    inFlight.current = true
    setPending({ key: entry.key, action })
    setErrors(({ [entry.key]: _gone, ...rest }) => rest)
    try {
      await act.mutateAsync({ entry, action, weekPlan })
    } catch (error) {
      setErrors((cur) => ({ ...cur, [entry.key]: { action, message: errorReason(error, offline) } }))
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  return (
    <BottomSheet eyebrow={reviewEyebrow(read.count, unit)} title="What went differently" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{reviewExplanation(unit)}</span>

        {read.status === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0' }}>
            <div role="status" aria-label="Loading" className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', ...SPINNER_RING }} />
          </div>
        )}

        {read.status === 'failed' && (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', color: 'var(--error)' }}>{`Couldn't load last ${unit}.`}</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{errorReason(read.error, offline)}</span>
          </div>
        )}

        {read.status === 'ready' && read.count === 0 && <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>Nothing left to decide.</span>}

        {read.status === 'ready' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {read.groups.map((group) => (
              <div key={group.sessionId} data-review-group={group.sessionId} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={CAPTION}>{group.heading}</span>
                {group.items.map((entry) => (
                  <Item
                    key={entry.key}
                    entry={entry}
                    fromWeek={fromWeek}
                    unit={unit}
                    pending={pending?.key === entry.key ? pending.action : null}
                    busy={pending !== null}
                    error={errors[entry.key]}
                    onPress={(action) => void decide(group, entry, action)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
