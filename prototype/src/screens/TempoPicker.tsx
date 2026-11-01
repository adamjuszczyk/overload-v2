// 1.2.1 item 3: tempo set like reps and RIR, in the target pickers' sheet (boards 6 and 7): NONE | SET, then four boxes,
// one per phase, each with − and + under it. Nothing is typed with dashes: the boxes are the four fields. A box takes a
// number (0–20) or X, typed or stepped (− from 0 gives X; + from X gives 0). Stored as before: "3-1-1-0" (normaliseTempo).
import { useState, type CSSProperties } from 'react'
import BottomSheet from '@app/components/BottomSheet'
import { hairline } from '@app/components/pickers/pickerControls'
import { normaliseTempo } from '@app/lib/plannerVocabulary'

type Field = number | 'X'
const PHASES = ['DOWN', 'BOTTOM', 'UP', 'TOP'] as const
const MAX = 20

const parse = (tempo: string | null): Field[] | null =>
  tempo ? tempo.split('-').map((f) => (f.toUpperCase() === 'X' ? 'X' : Number(f))) : null
const show = (f: Field) => String(f)

const SEGMENT: CSSProperties = { height: 46, padding: 0, borderWidth: 0, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, letterSpacing: '0.15em', cursor: 'pointer' }
const BOX: CSSProperties = {
  boxSizing: 'border-box', width: '100%', minWidth: 0, height: 72, margin: 0, padding: 0, borderRadius: 12, background: 'var(--surface)', appearance: 'none',
  textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, color: 'var(--text-primary)', ...hairline('var(--border-strong)'), outline: 'none',
}
const STEP: CSSProperties = { flex: 1, height: 44, padding: 0, borderRadius: 10, ...hairline('var(--border)'), background: 'var(--surface-raised)', fontFamily: 'var(--font-mono)', fontSize: 20, lineHeight: 1, cursor: 'pointer' }

export default function TempoPicker({ exerciseName, value, onSubmit, onClose }: { exerciseName: string; value: string | null; onSubmit: (tempo: string | null) => void; onClose: () => void }) {
  const [on, setOn] = useState(value !== null)
  const [fields, setFields] = useState<Field[]>(parse(value) ?? [3, 0, 1, 0])
  const [typing, setTyping] = useState<Record<number, string>>({})

  const setField = (i: number, f: Field) => setFields((all) => all.map((x, j) => (j === i ? f : x)))
  const less = (f: Field): Field => (f === 'X' ? 'X' : f === 0 ? 'X' : f - 1)
  const more = (f: Field): Field => (f === 'X' ? 0 : Math.min(MAX, f + 1))
  const leave = (i: number) => {
    const text = typing[i]
    if (text === undefined) return
    const t = text.trim().toUpperCase()
    if (t === 'X') setField(i, 'X')
    else if (/^\d+$/.test(t)) setField(i, Math.min(MAX, Number(t)))
    setTyping(({ [i]: _, ...rest }) => rest)
  }
  const tempo = on ? normaliseTempo(fields.map(show).join('-')) : null

  return (
    <BottomSheet
      eyebrow={exerciseName.toUpperCase()}
      title="Tempo"
      onClose={onClose}
      footer={
        <button type="button" onClick={() => onSubmit(tempo)} style={{ width: '100%', height: 52, borderRadius: 10, borderWidth: 0, background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, letterSpacing: '0.03em', cursor: 'pointer' }}>
          {tempo ? `SET TEMPO ${tempo}` : 'SET NO TEMPO'}
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div role="radiogroup" aria-label="Tempo" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', ...hairline('var(--border)'), borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
          {[{ id: false, label: 'NONE' }, { id: true, label: 'SET' }].map((m) => (
            <button key={m.label} type="button" aria-pressed={on === m.id} onClick={() => setOn(m.id)} style={{ ...SEGMENT, background: on === m.id ? 'var(--accent)' : 'var(--surface)', color: on === m.id ? 'var(--on-accent)' : 'var(--text-secondary)' }}>
              {m.label}
            </button>
          ))}
        </div>

        {on ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
              {PHASES.map((phase, i) => (
                <div key={phase} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, minWidth: 0 }}>
                  <span style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>{phase}</span>
                  <input
                    aria-label={`${phase} seconds`}
                    inputMode="text"
                    value={typing[i] ?? show(fields[i])}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setTyping((t) => ({ ...t, [i]: e.target.value.slice(0, 2) }))}
                    onBlur={() => leave(i)}
                    style={BOX}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" aria-label={`Less ${phase}`} onClick={() => setField(i, less(fields[i]))} style={{ ...STEP, color: 'var(--text-secondary)' }}>−</button>
                    <button type="button" aria-label={`More ${phase}`} onClick={() => setField(i, more(fields[i]))} style={{ ...STEP, color: 'var(--text-secondary)' }}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ margin: '-4px 0 0', textAlign: 'center', fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>Seconds per phase. X is as fast as you can.</p>
          </>
        ) : (
          <p style={{ margin: 0, textAlign: 'center', fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>No tempo on this exercise.</p>
        )}
      </div>
    </BottomSheet>
  )
}
