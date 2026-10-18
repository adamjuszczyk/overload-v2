import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { ArrowRightLeft, Link as LinkIcon, Trash2 } from 'lucide-react'
import { hairline } from '../../components/pickers/pickerControls'
import { SupersetLinkToggle } from '../planner/designFieldEditors'

// Chunk 51a (TASKS-1.2; board PL1, SPEC "Looks the same in CHANGE THE PROGRAM as in the workout (12)"): the cards of the EXERCISES
// list. A single exercise is a card with its name, its muscle group, the markers of what is set on it (REST, TEMPO, …), SWAP,
// SUPERSET and REMOVE, and a ⋯ that opens PL2's sheet; a superset is ONE card (a header with its round rest and UNLINK, each
// member with its letter, its own ⋯, SWAP and REMOVE), as the workout screen draws it. A removed exercise is a dashed line with UNDO.
//
// These draw and call back; nothing here knows what a draft is. The grip on the left is the drag handle (pointer events, no
// library) and takes ArrowUp / ArrowDown too; the ⋯ sheet holds MOVE UP / MOVE DOWN as the fallback.

export interface CardMarker {
  label: string
  /** Set or changed in this edit: the accent outline of board PL1's "CHANGED IN THIS EDIT". */
  changed: boolean
}

export interface CardItem {
  key: string
  name: string
  /** `BACK`, or `REAR DELTS · NEW`. */
  muscle: string
  /** New or swapped in this edit. */
  isChanged: boolean
  markers: CardMarker[]
  /** "New. It lands in week 2 with no sets; add them in Plan." */
  note: string | null
  /** A member's letter in its superset. */
  letter: string | null
  /** SUPERSET on this card (it links with the exercise below). */
  canLink: boolean
}

export interface CardBlock {
  /** The unit's key: its first exercise's. */
  key: string
  items: CardItem[]
  superset: { blockId: string; letter: string; restAfterText: string | null } | null
}

export interface CardHandlers {
  onOptions: (key: string) => void
  onSwap: (key: string) => void
  onLink: (key: string) => void
  onRemove: (key: string) => void
  onUnlink: (blockId: string) => void
  onSplitAfter: (key: string) => void
  onMove: (key: string, direction: 'up' | 'down') => void
  onGripPointerDown: (blockKey: string, event: ReactPointerEvent<HTMLElement>) => void
}

const MONO_10: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10 }

const SMALL_BUTTON: CSSProperties = {
  ...MONO_10,
  height: 36,
  boxSizing: 'border-box',
  padding: '0 10px',
  borderRadius: 8,
  ...hairline('var(--border)'),
  background: 'var(--surface)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  letterSpacing: '0.12em',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}

function GripIcon() {
  return (
    <svg width="14" height="20" viewBox="0 0 24 34" fill="var(--text-dim)" aria-hidden="true">
      <circle cx="9" cy="9" r="2" />
      <circle cx="15" cy="9" r="2" />
      <circle cx="9" cy="17" r="2" />
      <circle cx="15" cy="17" r="2" />
      <circle cx="9" cy="25" r="2" />
      <circle cx="15" cy="25" r="2" />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

function Marker({ marker }: { marker: CardMarker }) {
  return (
    <span
      style={{
        ...MONO_10,
        letterSpacing: '0.1em',
        padding: '3px 6px',
        borderRadius: 6,
        background: marker.changed ? 'var(--accent-muted)' : 'var(--surface-raised)',
        color: marker.changed ? 'var(--accent)' : 'var(--text-muted)',
        ...hairline(marker.changed ? 'var(--accent)' : 'var(--border)'),
      }}
    >
      {marker.label}
    </span>
  )
}

function Item({
  item,
  first,
  inSuperset,
  handlers,
}: {
  item: CardItem
  first: boolean
  inSuperset: boolean
  handlers: CardHandlers
}) {
  const changed = item.isChanged
  return (
    <div
      data-exercise-key={item.key}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        margin: '0 -6px',
        padding: inSuperset ? '10px 6px' : '0 6px',
        borderRadius: 10,
        background: changed ? 'var(--accent-muted)' : 'transparent',
        ...hairline(changed ? 'var(--accent)' : 'transparent'),
        borderTopColor: changed ? 'var(--accent)' : first ? 'transparent' : 'var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {item.letter !== null && (
          <span
            style={{
              flex: '0 0 auto',
              width: 26,
              height: 26,
              borderRadius: 6,
              background: 'var(--surface-raised)',
              ...hairline('var(--border)'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
          >
            {item.letter}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.25, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{item.name}</span>
          <span style={{ ...MONO_10, letterSpacing: '0.15em', color: changed ? 'var(--accent)' : 'var(--text-muted)', overflowWrap: 'anywhere' }}>
            {item.muscle}
          </span>
        </div>
        <button
          type="button"
          aria-label={`${item.name}: rest, tempo, unit`}
          onClick={() => handlers.onOptions(item.key)}
          style={{
            flex: '0 0 auto',
            width: 36,
            height: 36,
            padding: 0,
            borderWidth: 0,
            background: 'transparent',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <DotsIcon />
        </button>
      </div>
      {item.markers.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {item.markers.map((m) => (
            <Marker key={m.label} marker={m} />
          ))}
        </div>
      )}
      {item.note !== null && <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{item.note}</span>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" aria-label={`Swap ${item.name}`} onClick={() => handlers.onSwap(item.key)} style={SMALL_BUTTON}>
          <ArrowRightLeft size={13} aria-hidden="true" />
          SWAP
        </button>
        {item.canLink && (
          <button type="button" aria-label={`Link ${item.name} with the exercise below`} onClick={() => handlers.onLink(item.key)} style={SMALL_BUTTON}>
            <LinkIcon size={13} aria-hidden="true" />
            SUPERSET
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${item.name}`}
          onClick={() => handlers.onRemove(item.key)}
          style={{ ...SMALL_BUTTON, color: 'var(--error)' }}
        >
          <Trash2 size={13} aria-hidden="true" />
          REMOVE
        </button>
      </div>
    </div>
  )
}

export function BlockCard({ block, unitIndex, handlers }: { block: CardBlock; unitIndex: number; handlers: CardHandlers }) {
  const first = block.items[0]
  return (
    <div
      data-unit-index={unitIndex}
      data-unit-key={block.key}
      style={{
        background: 'var(--surface)',
        ...hairline('var(--border)'),
        borderRadius: 12,
        padding: '12px 12px 12px 6px',
        display: 'flex',
        gap: 6,
      }}
    >
      <div style={{ flex: '0 0 auto', paddingTop: 4 }}>
        <button
          type="button"
          aria-label={block.superset ? `Reorder superset ${block.superset.letter}` : `Reorder ${first.name}`}
          onPointerDown={(e) => handlers.onGripPointerDown(block.key, e)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              handlers.onMove(first.key, e.key === 'ArrowUp' ? 'up' : 'down')
            }
          }}
          style={{
            width: 22,
            height: 36,
            padding: 0,
            borderWidth: 0,
            background: 'transparent',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            cursor: 'grab',
            // The grip takes the touch: dragging it must not scroll the page.
            touchAction: 'none',
          }}
        >
          <GripIcon />
        </button>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {block.superset && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ ...MONO_10, display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.2em', color: 'var(--text-secondary)' }}>
                <LinkIcon size={13} aria-hidden="true" />
                SUPERSET {block.superset.letter}
              </span>
              {block.superset.restAfterText !== null && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{block.superset.restAfterText}</span>
              )}
            </span>
            <button
              type="button"
              aria-label={`Unlink superset ${block.superset.letter}`}
              onClick={() => handlers.onUnlink(block.superset!.blockId)}
              style={SMALL_BUTTON}
            >
              UNLINK
            </button>
          </div>
        )}
        {block.items.map((item, i) => (
          <div key={item.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {i > 0 && block.superset && (
              <SupersetLinkToggle linked disabled={false} onToggle={() => handlers.onSplitAfter(block.items[i - 1].key)} />
            )}
            <Item item={item} first={i === 0} inSuperset={block.superset !== null} handlers={handlers} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function RemovedLine({
  name,
  sinceText,
  onUndo,
}: {
  name: string
  /** `REMOVED FROM WEEK 2`. */
  sinceText: string
  onUndo: () => void
}) {
  return (
    <div
      style={{
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: 'var(--border-strong)',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-muted)', textDecoration: 'line-through', overflowWrap: 'anywhere' }}>{name}</span>
        <span style={{ ...MONO_10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{sinceText}</span>
      </div>
      <button
        type="button"
        aria-label={`Undo removing ${name}`}
        onClick={onUndo}
        style={{
          ...MONO_10,
          flex: '0 0 auto',
          height: 40,
          padding: '0 12px',
          borderRadius: 8,
          ...hairline('var(--border-strong)'),
          background: 'var(--surface)',
          letterSpacing: '0.15em',
          color: 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        UNDO
      </button>
    </div>
  )
}
