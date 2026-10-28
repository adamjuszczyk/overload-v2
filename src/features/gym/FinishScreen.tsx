// Chunk 64 — FINISH SESSION's screen (boards W18 and W19; SPEC [1.2] "Finishing (11, C6)"), replacing `SessionComplete`'s capture step: what the session did (the
// tiles), what is still unlogged (the warning, with GO BACK), how it felt (ENERGY, PUMP, NOTE), BACK TO SESSION and COMPLETE. A reopened session finishes through
// W19: the same screen without the warning, its note and ratings already in the boxes (`isReopened`).
// The writes are today's (TASKS 64): COMPLETE is `useCompleteSession().mutateAsync({ id, note, energyRating, pumpRating })` as `SessionComplete` sent it, whose success
// also clears the session's drafts and card lists on the phone since 63 (G46). The only new thing on the failure path is the real error line (SPEC Errors (15)).
// GymSession hands the screen what it already knows: the header's words, the warning (`useWorkoutRows`' `finish`, 46r's `finishWarning`) and the two ways back.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CAPTION_STYLE, hairline } from '../../components/pickers/pickerControls'
import type { EnergyRating, PumpRating } from '../../types'
import { ErrorLine } from './cardOptions'
import { finishTiles, finishTitle, isReopened } from './finishView'
import { ENERGY_SCALE, PUMP_SCALE, type RatingScale } from './ratingScales'
import { useActiveSession, useCompleteSession } from './useSession'
import type { FinishWarning } from './workoutRules'

const MONO = 'var(--font-mono)'

interface FinishScreenProps {
  sessionId: string
  /** "WEEK 2 · TUESDAY · 52:40": the workout header's line with the clock after it. */
  eyebrow: string
  /** The workout's name; the title is "FINISH " and this in capitals. */
  workoutName: string
  /** What 46r's `finishWarning` says is still unlogged, or null. A reopened session never shows it. */
  warning: Pick<FinishWarning, 'text' | 'firstKey'> | null
  /** BACK TO SESSION: closes the screen where the workout was. */
  onBack: () => void
  /** GO BACK: closes the screen and scrolls to the first listed set (its row key). */
  onGoBack: (firstKey: string) => void
}

const TILE_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  minWidth: 0,
  ...hairline('var(--border)'),
  borderRadius: 12,
  padding: 12,
  background: 'var(--surface)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}
const TILE_LABEL_STYLE: CSSProperties = { fontFamily: MONO, fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)', overflowWrap: 'anywhere' }
const TILE_VALUE_STYLE: CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 24, lineHeight: 1.1 }
const WARNING_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'var(--border-strong)',
  borderRadius: 12,
  padding: '12px 14px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
}
const GO_BACK_STYLE: CSSProperties = {
  flex: '0 0 auto',
  boxSizing: 'border-box',
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  ...hairline('var(--border-strong)'),
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontFamily: MONO,
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: '0.15em',
  cursor: 'pointer',
}
const NOTE_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: 96,
  borderRadius: 10,
  ...hairline('var(--border-strong)'),
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  padding: '12px 14px',
  fontFamily: 'var(--font-sans)',
  fontSize: 15,
  resize: 'none',
}
const FOOTER_STYLE: CSSProperties = {
  marginTop: 'auto',
  position: 'sticky',
  bottom: 0,
  zIndex: 20,
  padding: '12px 16px 20px',
  borderTopWidth: 1,
  borderTopStyle: 'solid',
  borderTopColor: 'var(--border-subtle)',
  background: 'var(--base)',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10,
}
const BACK_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  height: 52,
  borderRadius: 10,
  ...hairline('var(--border-strong)'),
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontFamily: MONO,
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.15em',
  cursor: 'pointer',
}
const COMPLETE_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  height: 52,
  borderRadius: 10,
  borderWidth: 0,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontFamily: 'var(--font-display)',
  fontWeight: 800,
  fontSize: 14,
  letterSpacing: '0.03em',
  cursor: 'pointer',
}

function Tile({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div data-finish-tile={label} style={TILE_STYLE}>
      <span style={TILE_LABEL_STYLE}>{label}</span>
      <span style={{ ...TILE_VALUE_STYLE, color: muted ? 'var(--text-muted)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

/** ENERGY or PUMP: the scale's chips as the board draws them; a tap selects, a tap on the selected chip clears it back to "not rated" (SPEC §7: absence is data too). */
function ScaleRow<T extends string>({ label, scale, value, onChange }: { label: string; scale: RatingScale<T>; value: T | null; onChange: (value: T | null) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={CAPTION_STYLE}>{label}</span>
      <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {scale.values.map((v) => {
          const on = value === v
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? null : v)}
              style={{
                boxSizing: 'border-box',
                height: 44,
                padding: '0 12px',
                borderRadius: 8,
                ...hairline(on ? 'var(--accent)' : 'var(--border)'),
                background: on ? 'var(--accent-muted)' : 'var(--surface)',
                color: on ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: MONO,
                fontWeight: 600,
                fontSize: 10,
                letterSpacing: '0.12em',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {scale.labels[v]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function FinishScreen({ sessionId, eyebrow, workoutName, warning, onBack, onGoBack }: FinishScreenProps) {
  const [note, setNote] = useState('')
  const [energyRating, setEnergyRating] = useState<EnergyRating | null>(null)
  const [pumpRating, setPumpRating] = useState<PumpRating | null>(null)
  const { data: session } = useActiveSession(sessionId)
  const completeSession = useCompleteSession()

  // A reopened session's note and ratings come back into the boxes (W19) — once each, so a prefill never clobbers what is being typed (as `SessionComplete` did:
  // v3 Personalization TASKS §4 item 5, "a reopened, previously-completed session's ratings must prefill rather than silently reset to 'not rated' on re-completion").
  const noteInitialisedRef = useRef(false)
  useEffect(() => {
    if (noteInitialisedRef.current || session?.note == null) return
    noteInitialisedRef.current = true
    setNote(session.note)
  }, [session?.note])
  const energyInitialisedRef = useRef(false)
  useEffect(() => {
    if (energyInitialisedRef.current || session?.energyRating == null) return
    energyInitialisedRef.current = true
    setEnergyRating(session.energyRating)
  }, [session?.energyRating])
  const pumpInitialisedRef = useRef(false)
  useEffect(() => {
    if (pumpInitialisedRef.current || session?.pumpRating == null) return
    pumpInitialisedRef.current = true
    setPumpRating(session.pumpRating)
  }, [session?.pumpRating])

  const tiles = finishTiles(session?.setLogs ?? [])
  const reopened = isReopened(session)
  const listed = reopened ? null : warning
  const pending = completeSession.isPending

  // The write is today's. A failure is the mutation's own state, drawn below with its real reason (SPEC Errors (15)); nothing is thrown at the tap.
  async function handleComplete() {
    try {
      await completeSession.mutateAsync({ id: sessionId, note: note.trim() || null, energyRating, pumpRating })
    } catch {
      // `completeSession.error` holds it
    }
  }

  return (
    <div data-finish={reopened ? 'reopened' : 'new'} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <header
        style={{
          padding: '18px 16px 14px',
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: 'var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <span data-finish-eyebrow style={{ fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>
          {eyebrow}
        </span>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: 30,
            lineHeight: 1,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)',
            overflowWrap: 'anywhere',
          }}
        >
          {finishTitle(workoutName)}
        </h1>
      </header>

      <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <Tile label="WORKING SETS" value={tiles.working} />
          <Tile label="SKIPPED" value={tiles.skipped} muted />
          <Tile label="WARMUPS" value={tiles.warmups} />
        </div>

        {listed !== null && (
          <div data-finish-warning style={WARNING_STYLE}>
            <span style={{ minWidth: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{listed.text}</span>
            <button type="button" onClick={() => onGoBack(listed.firstKey)} style={GO_BACK_STYLE}>
              GO BACK
            </button>
          </div>
        )}

        <ScaleRow label="ENERGY" scale={ENERGY_SCALE} value={energyRating} onChange={setEnergyRating} />
        <ScaleRow label="PUMP" scale={PUMP_SCALE} value={pumpRating} onChange={setPumpRating} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="finish-note" style={CAPTION_STYLE}>
            NOTE
          </label>
          <textarea id="finish-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="How did it feel?" style={NOTE_STYLE} />
        </div>

        {completeSession.isError && <ErrorLine headline="Couldn't complete the session." error={completeSession.error} />}
      </div>

      <div style={FOOTER_STYLE}>
        <button type="button" onClick={onBack} style={BACK_STYLE}>
          BACK TO SESSION
        </button>
        <button type="button" onClick={handleComplete} disabled={pending} aria-busy={pending} style={COMPLETE_STYLE}>
          {pending ? 'SAVING…' : 'COMPLETE'}
        </button>
      </div>
    </div>
  )
}
