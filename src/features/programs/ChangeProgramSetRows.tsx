import type { CSSProperties } from 'react'
import { REST_MAX_SECONDS } from '../../components/pickers/pickerLogic'
import { hairline } from '../../components/pickers/pickerControls'

// Chunk 51b (TASKS-1.2; board PL1b, SPEC Programs and runs [1.2] → "Stable: it also shows the default's sets, as rows"): the set rows
// of one exercise's card on a stable run. An ALL row (the rep target every set has, or MIXED; opens the rep target picker for every
// set) with the REST AFTER column's caption, then a row per set of the default: its number (opens the set type picker), its rep
// target (opens the rep target picker; a staged set says its kind and how many stages, a warmup says WARMUP), and the REST AFTER
// stepper (CHAIN until the set has a rest of its own), then "+ SET". A staged set's stages are nested rows under it, each with the
// rep box of its own (TASKS 51b: "the rep box on a stage row opens the picker for the stage"; the stepped planner draws them the
// same way, "↳"). A set changed in this edit has the accent outline.
//
// These draw and call back; nothing here knows what a draft is. The labels are the caller's (`numberSets`).

export interface SetRowView {
  /** `01`, `W`, or the member's letter and number in a superset (`A1`). */
  label: string
  /** The rep box's text (`8–10`, `AMRAP`, a dash for none). */
  target: string
  /** WARMUP, or the kind and its stages (`DROPSET · 1`); null for a Normal set. */
  kind: string | null
  changed: boolean
  /** `CHAIN` or `2:00`. */
  rest: string
  restSeconds: number | null
  stages: ReadonlyArray<{ target: string; changed: boolean }>
}

export interface SetRowsView {
  /** `8–10`, or `MIXED`. */
  all: string
  rows: readonly SetRowView[]
}

export interface SetRowsHandlers {
  onType: (index: number) => void
  onReps: (index: number) => void
  onStageReps: (index: number, stage: number) => void
  onAll: () => void
  onRest: (index: number, direction: 1 | -1) => void
  onAdd: () => void
}

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }

const COLUMN_NUMBER = 40
const COLUMN_REST = 128

const CELL: CSSProperties = {
  height: 40,
  boxSizing: 'border-box',
  borderRadius: 8,
  background: 'var(--surface)',
  cursor: 'pointer',
}

function RepBox({ target, kind, changed, label, onClick }: { target: string; kind: string | null; changed: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        ...CELL,
        flex: 1,
        minWidth: 0,
        padding: '0 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 4,
        ...hairline(changed ? 'var(--accent)' : 'var(--border)'),
        background: changed ? 'var(--accent-muted)' : 'var(--surface)',
      }}
    >
      <span style={{ ...MONO, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{target}</span>
      {kind !== null && (
        <span
          style={{
            ...MONO,
            padding: '2px 5px',
            borderRadius: 4,
            fontSize: 8,
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
            background: changed ? 'var(--surface)' : 'var(--surface-raised)',
            color: changed ? 'var(--accent)' : 'var(--text-secondary)',
            ...hairline(changed ? 'var(--accent)' : 'var(--border-subtle)'),
          }}
        >
          {kind}
        </span>
      )}
    </button>
  )
}

function RestStepper({ name, label, row, index, onRest }: { name: string; label: string; row: SetRowView; index: number; onRest: SetRowsHandlers['onRest'] }) {
  const lessDisabled = row.restSeconds === null
  const moreDisabled = row.restSeconds !== null && row.restSeconds >= REST_MAX_SECONDS
  const stepStyle: CSSProperties = { height: '100%', borderWidth: 0, background: 'transparent', fontSize: 15, padding: 0 }
  return (
    <div
      role="group"
      aria-label={`Rest after set ${label} of ${name}`}
      style={{
        flex: '0 0 auto',
        display: 'grid',
        gridTemplateColumns: '36px 56px 36px',
        height: 40,
        boxSizing: 'border-box',
        borderRadius: 8,
        ...hairline('var(--border)'),
        background: 'var(--surface)',
        alignItems: 'center',
      }}
    >
      <button
        type="button"
        aria-label={`Less rest after set ${label} of ${name}`}
        disabled={lessDisabled}
        onClick={() => onRest(index, -1)}
        style={{ ...stepStyle, color: lessDisabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: lessDisabled ? 'default' : 'pointer' }}
      >
        −
      </button>
      <span style={{ ...MONO, fontWeight: 700, fontSize: 10, textAlign: 'center', color: row.restSeconds === null ? 'var(--text-muted)' : 'var(--text-primary)' }}>{row.rest}</span>
      <button
        type="button"
        aria-label={`More rest after set ${label} of ${name}`}
        disabled={moreDisabled}
        onClick={() => onRest(index, 1)}
        style={{ ...stepStyle, color: moreDisabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: moreDisabled ? 'default' : 'pointer' }}
      >
        +
      </button>
    </div>
  )
}

export default function ChangeProgramSetRows({ name, sets, handlers }: { name: string; sets: SetRowsView; handlers: SetRowsHandlers }) {
  return (
    <div data-set-rows style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sets.rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ ...MONO, flex: '0 0 auto', width: COLUMN_NUMBER, fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>ALL</span>
          <button
            type="button"
            aria-label={`All sets of ${name}: rep target`}
            onClick={handlers.onAll}
            style={{ ...CELL, ...MONO, flex: 1, minWidth: 0, padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', ...hairline('var(--border)') }}
          >
            {sets.all}
          </button>
          <span style={{ ...MONO, flex: '0 0 auto', width: COLUMN_REST, textAlign: 'center', fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>REST AFTER</span>
        </div>
      )}
      {sets.rows.length === 0 && (
        <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', color: 'var(--error)' }}>NO SETS YET</span>
      )}
      {sets.rows.map((row, index) => (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              aria-label={`Set ${row.label} of ${name}: type`}
              onClick={() => handlers.onType(index)}
              style={{ ...CELL, ...MONO, flex: '0 0 auto', width: COLUMN_NUMBER, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', ...hairline('var(--border)') }}
            >
              {row.label}
            </button>
            <RepBox target={row.target} kind={row.kind} changed={row.changed} label={`Set ${row.label} of ${name}: rep target`} onClick={() => handlers.onReps(index)} />
            <RestStepper name={name} label={row.label} row={row} index={index} onRest={handlers.onRest} />
          </div>
          {row.stages.map((stage, s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ ...MONO, flex: '0 0 auto', width: COLUMN_NUMBER, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>↳</span>
              <RepBox target={stage.target} kind={null} changed={stage.changed} label={`Stage ${s + 1} of set ${row.label} of ${name}: rep target`} onClick={() => handlers.onStageReps(index, s)} />
              <span aria-hidden="true" style={{ flex: '0 0 auto', width: COLUMN_REST }} />
            </div>
          ))}
        </div>
      ))}
      <button
        type="button"
        aria-label={`Add a set to ${name}`}
        onClick={handlers.onAdd}
        style={{
          ...MONO,
          alignSelf: 'flex-start',
          height: 32,
          boxSizing: 'border-box',
          padding: '0 10px',
          borderRadius: 6,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: 'var(--border-strong)',
          background: 'transparent',
          fontSize: 10,
          letterSpacing: '0.1em',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        + SET
      </button>
    </div>
  )
}
