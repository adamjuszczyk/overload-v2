import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Pencil } from 'lucide-react'
import { hairline } from '../../components/pickers/pickerControls'

// Chunk 51a (TASKS-1.2; board PL1): renaming the selected workout. Chunk 51b moved the button into the DAYS card, where board PL1 draws
// it, for a weekday run; a sequence run has no DAYS card and keeps the row under the WORKOUTS chips (DECISIONS 172 (a)).

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }

export function RenameButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Rename ${name}`}
      onClick={onClick}
      style={{ ...MONO, alignSelf: 'flex-start', flex: '0 0 auto', height: 36, padding: '0 10px', borderRadius: 8, ...hairline('var(--border)'), background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-primary)', cursor: 'pointer' }}
    >
      <Pencil size={13} aria-hidden="true" />
      RENAME
    </button>
  )
}

export function RenameRow({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const blank = text.trim() === ''
  const commit = () => onDone(blank ? null : text.trim())
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        ref={ref}
        aria-label="Workout name"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') onDone(null)
        }}
        style={{ flex: 1, minWidth: 0, height: 44, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--accent)'), borderWidth: 2, background: 'var(--surface)', padding: '0 12px', fontSize: 16, color: 'var(--text-primary)', outline: 'none' }}
      />
      <button
        type="button"
        disabled={blank}
        onClick={commit}
        style={{ ...MONO, flex: '0 0 auto', height: 44, padding: '0 14px', borderRadius: 10, borderWidth: 0, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, fontSize: 11, letterSpacing: '0.15em', opacity: blank ? 0.5 : 1, cursor: blank ? 'default' : 'pointer' }}
      >
        DONE
      </button>
    </div>
  )
}
