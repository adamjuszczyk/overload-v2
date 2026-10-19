import type { CSSProperties } from 'react'
import { hairline } from '../../components/pickers/pickerControls'
import type { DayOfWeek } from '../../types'
import { RenameButton, RenameRow } from './ChangeProgramRename'

// Chunk 51b (TASKS-1.2; board PL1, SPEC Programs and runs [1.2] → "Weekdays (1e)" and "Weekdays storage"): the DAYS card of the
// selected workout, weekday runs only. Seven day toggles; a day on is the accent outline, a day this week's sessions are on and the
// edit turns off is struck through ("Was Tuesday"). A day another workout holds can't be picked: its toggle is disabled and the card
// says whose day it is ("Thu is Push 2's day", Defaults 2). The last day a workout has can't be turned off ("At least one day stays
// on"). The line under the toggles says when the new days start ("Was Tuesday. New days start in week 3. This week Pull 1 stays on
// Tuesday; MOVE THIS SESSION in Plan moves just this week."). RENAME sits in the card's header, as board PL1 draws it.
//
// This draws and calls back; the rules are `changeProgramDraft.ts`'s `dayToggle`.

export interface DayView {
  day: DayOfWeek
  /** `M`; the toggle's accessible name is the whole day (`Tuesday`). */
  letter: string
  name: string
  on: boolean
  /** In force for this workout this week and off in the edit: struck through. */
  was: boolean
  disabled: boolean
}

export interface DaysCardProps {
  /** The card's number among the screen's cards (DAYS is 1). */
  number: number
  workoutName: string
  days: readonly DayView[]
  /** "Thu is Push 2's day": why the greyed days are greyed. */
  taken: readonly string[]
  /** The workout has one day and it can't be turned off. */
  lastDay: boolean
  /** "Was Tuesday. New days start in week 3. …"; null while the days are as they were. */
  caption: string | null
  renaming: boolean
  onToggle: (day: DayOfWeek) => void
  onRenameStart: () => void
  onRenameDone: (name: string | null) => void
}

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }
const NOTE: CSSProperties = { fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }

export default function ChangeProgramDaysCard(props: DaysCardProps) {
  const { number, workoutName, days, taken, lastDay, caption, renaming, onToggle, onRenameStart, onRenameDone } = props
  return (
    <section
      aria-label={`${workoutName}: days`}
      style={{ background: 'var(--surface)', ...hairline('var(--border)'), borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ ...MONO, minWidth: 0, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
          {number} · {workoutName.toUpperCase()} · DAYS
        </span>
        {!renaming && <RenameButton name={workoutName} onClick={onRenameStart} />}
      </div>
      {renaming && <RenameRow key={workoutName} initial={workoutName} onDone={onRenameDone} />}
      <div role="group" aria-label={`${workoutName} days`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
        {days.map((d) => (
          <button
            key={d.day}
            type="button"
            aria-label={d.name}
            aria-pressed={d.on}
            disabled={d.disabled}
            onClick={() => onToggle(d.day)}
            style={{
              ...MONO,
              height: 44,
              padding: 0,
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 11,
              ...hairline(d.on ? 'var(--accent)' : 'var(--border)'),
              background: d.on ? 'var(--accent-muted)' : d.disabled ? 'var(--surface-raised)' : 'var(--surface)',
              color: d.on ? 'var(--accent)' : d.disabled || d.was ? 'var(--text-dim)' : 'var(--text-secondary)',
              textDecoration: d.was ? 'line-through' : 'none',
              cursor: d.disabled ? 'default' : 'pointer',
            }}
          >
            {d.letter}
          </button>
        ))}
      </div>
      {(taken.length > 0 || lastDay) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 2 }}>
          {taken.map((line) => (
            <span key={line} style={{ ...NOTE, color: 'var(--text-muted)' }}>
              {line}
            </span>
          ))}
          {lastDay && <span style={{ ...NOTE, color: 'var(--text-muted)' }}>At least one day stays on.</span>}
        </div>
      )}
      {caption !== null && <span style={NOTE}>{caption}</span>}
    </section>
  )
}
