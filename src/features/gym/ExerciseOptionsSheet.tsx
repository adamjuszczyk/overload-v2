import { useState, type CSSProperties, type ReactNode } from 'react'
import { History, Plus, Repeat2, SkipForward } from 'lucide-react'
import BottomSheet from '../../components/BottomSheet'

// Chunk 59 (TASKS-1.2 59; board W10; SPEC [1.2] "The set's ⋯ during a workout (C9)", "Swap during a workout (C7)", Supersets): the
// exercise ⋯ of a card on the workout screen. "BACK · 2 OF 3 SETS DONE" over the exercise's name, then four rows with their sublines:
// Swap for today (its picker is W11), Skip the rest of this exercise (its confirm is inline, as W10 draws it: CANCEL and SKIP 2 SETS),
// Add a set (this exercise only; in a superset the others stay as they are) and Exercise history. A row the card doesn't offer isn't
// drawn: no swap on a card a swap made or on an ADDED TODAY card (DECISIONS 199 (a)); no skip when nothing is left to skip ("Nothing
// left to skip" omits the row); no Add a set on the card a swap moved sets from.
//
// It writes nothing: the card passes what each row does. The skip's words and count come from `exerciseOptions.ts`.
//
// Display choices no board settles, provisional under D31: the skip row is closed until it is tapped and the board's expanded frame
// opens under it; while the skips are written the button reads SKIPPING… and the sheet closes when they are done; a row is a 60 px
// target as the board draws it; "Exercise history" opens the same last-time sheet as the card's history icon (58b).

export interface ExerciseOptionsSheetProps {
  exerciseName: string
  /** `BACK · 2 OF 3 SETS DONE` (`optionsEyebrow`). */
  eyebrow: string
  /** Swap for today; null where the card doesn't offer it. */
  onSwap: (() => void) | null
  /** Skip the rest of this exercise; null when nothing is left to skip. `onConfirm` resolves when the skips are written. */
  skip: { description: string; label: string; onConfirm: () => Promise<void> } | null
  /** Add a set; null where the card doesn't offer it. */
  onAddSet: (() => void) | null
  onHistory: () => void
  onClose: () => void
}

const MONO = 'var(--font-mono)'

const ROW: CSSProperties = {
  width: '100%',
  minHeight: 60,
  boxSizing: 'border-box',
  padding: 0,
  borderWidth: '0 0 1px',
  borderStyle: 'solid',
  borderColor: 'var(--border-subtle)',
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  textAlign: 'left',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}

const TITLE: CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }
const SUBLINE: CSSProperties = { fontSize: 12, lineHeight: 1.4, color: 'var(--text-muted)', overflowWrap: 'anywhere' }

function Tile({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        flexShrink: 0,
        borderRadius: 8,
        background: danger ? 'color-mix(in srgb, var(--error) 15%, transparent)' : 'var(--surface-raised)',
        color: danger ? 'var(--error)' : 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </span>
  )
}

const BUTTON: CSSProperties = {
  height: 44,
  borderRadius: 10,
  fontFamily: MONO,
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.15em',
  cursor: 'pointer',
}

export default function ExerciseOptionsSheet({ exerciseName, eyebrow, onSwap, skip, onAddSet, onHistory, onClose }: ExerciseOptionsSheetProps) {
  const [confirming, setConfirming] = useState(false)
  const [skipping, setSkipping] = useState(false)

  async function confirmSkip() {
    if (skip === null || skipping) return
    setSkipping(true)
    try {
      await skip.onConfirm()
    } finally {
      setSkipping(false)
    }
    onClose()
  }

  return (
    <BottomSheet eyebrow={eyebrow} title={exerciseName} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border-subtle)' }}>
        {onSwap !== null && (
          <button
            type="button"
            onClick={() => {
              onClose()
              onSwap()
            }}
            style={ROW}
          >
            <Tile>
              <Repeat2 size={16} />
            </Tile>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={TITLE}>Swap for today</span>
              <span style={SUBLINE}>Next week's plan stays the same.</span>
            </span>
          </button>
        )}

        {skip !== null && (
          <div style={{ padding: '10px 0 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-expanded={confirming}
              style={{ ...ROW, minHeight: 0, borderWidth: 0, cursor: confirming ? 'default' : 'pointer' }}
            >
              <Tile danger>
                <SkipForward size={16} />
              </Tile>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={TITLE}>Skip the rest of this exercise</span>
                <span style={SUBLINE}>{skip.description}</span>
              </span>
            </button>
            {confirming && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, paddingLeft: 48 }}>
                <button
                  type="button"
                  disabled={skipping}
                  onClick={() => setConfirming(false)}
                  style={{ ...BUTTON, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-strong)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  disabled={skipping}
                  onClick={() => void confirmSkip()}
                  style={{ ...BUTTON, fontWeight: 700, borderWidth: 0, background: 'color-mix(in srgb, var(--error) 15%, transparent)', color: 'var(--error)', opacity: skipping ? 0.6 : 1 }}
                >
                  {skipping ? 'SKIPPING…' : skip.label}
                </button>
              </div>
            )}
          </div>
        )}

        {onAddSet !== null && (
          <button
            type="button"
            onClick={() => {
              onAddSet()
              onClose()
            }}
            style={ROW}
          >
            <Tile>
              <Plus size={16} />
            </Tile>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={TITLE}>Add a set</span>
              <span style={SUBLINE}>This exercise only. In a superset, the others stay as they are.</span>
            </span>
          </button>
        )}

        <button type="button" onClick={onHistory} style={{ ...ROW, borderBottomWidth: 0 }}>
          <Tile>
            <History size={16} />
          </Tile>
          <span style={TITLE}>Exercise history</span>
        </button>
      </div>
    </BottomSheet>
  )
}
