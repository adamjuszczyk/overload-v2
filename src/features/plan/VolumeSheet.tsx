import type { CSSProperties } from 'react'
import BottomSheet from '../../components/BottomSheet'
import { errorReason } from '../../components/exercisePickerLogic'
import { useSettingsStore } from '../settings/settingsStore'
import type { WeekPlan, WeeklySchedule } from '../../types'
import { formatVolumeCount, formatVolumeDelta, volumeRows } from './volumePerMuscle'
import { useVolumeSessions } from './useVolumeSessions'
import { lastWeekIsEmpty, muscleName, occurrencesOf, volumeExercises, volumeFooter } from './volumeSheetLogic'

// Chunk 55 (TASKS-1.2 "VOLUME"; SPEC [1.2] Volume per muscle (14), Settings (14b), G51; board 3): the sheet the VOLUME button opens. Every
// muscle as "last week → this week" with the change highlighted, and under a muscle whose last week differed from its plan "YOU PLANNED 4 LAST
// WEEK · DID 10". It draws chunk 44's `volumeRows`, which only this file may import (G51's test): the counting, the notes and the fractions
// are that module's; what is decided here is which data goes in and how it is drawn.
//
// What goes in (each from the place Plan already has it, so the sheet adds one read):
//   - this week: the open week's own plan rows, the query Plan draws the week from (`weekPlans`), never the run's every-week list, which
//     an edit of the week leaves as it was until a later week exists (`refreshWeeksComparedWithThisOne`);
//   - last week: week N−1's plan rows out of that every-week list. A week nobody planned has none (DECISIONS 131: a week with nothing in it);
//   - last week's sessions with their logs and `deleted` changes: `useVolumeSessions`, the one new read, by last week's plan rows;
//   - each plan row's `occurrences` from the weekday schedule in force in its own week (chunk 50), so a workout on two days counts twice;
//   - the muscle groups of the exercises the plans and the logs name; the rule from the settings store (49): nothing else reads it (G51);
//   - `ended`, which the page says: true when Plan shows the current week or cycle, false on a week planned ahead (DECISIONS 133).
//
// Display choices no board settles, provisional under D31 (DECISIONS): the rows read `Chest`, `Hamstrings` (the board's own words, its
// subgroup names being sample data); an empty last week (P1.2-2) shows "—" in its column with no change chip and no note; loading is
// the page's spinner under the column heads, a failed read is "Couldn't load last week." with the real reason (SPEC Errors (15)) and TRY
// AGAIN; two empty weeks read "Nothing is planned in either week."; the footer keeps the board's words whether last week is over or not.

export interface VolumeSheetProps {
  unit: 'week' | 'cycle'
  /** The open week (cycle): 2 or more, VOLUME isn't offered on the first (P1.2-1). */
  weekNumber: number
  /** Last week is over: Plan shows the current week (cycle). False on a week planned ahead. */
  ended: boolean
  /** The open week's plan rows, as Plan draws them. */
  thisWeek: readonly WeekPlan[]
  /** The plan rows of week N−1; none for a week nobody planned. */
  lastWeek: readonly WeekPlan[]
  /** The weekday schedule in force in each week; `null` on a sequence run, whose every slot is a plan row of its own. */
  thisWeekSchedule: WeeklySchedule | null
  lastWeekSchedule: WeeklySchedule | null
  onClose: () => void
}

const COLUMNS = 'minmax(0, 1fr) 64px 24px 64px 56px'

const HEAD: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLUMNS,
  alignItems: 'center',
  padding: '0 2px 8px',
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderBottomColor: 'var(--border-subtle)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 9,
  letterSpacing: '0.15em',
  color: 'var(--text-muted)',
}

const ROW: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '9px 2px',
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderBottomColor: 'var(--border-subtle)',
}

const COUNTS: CSSProperties = { display: 'grid', gridTemplateColumns: COLUMNS, alignItems: 'center' }

const MONO_15: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 15 }

// The change chip: an accent-tinted box, its text in the accent (a tint isn't the accent: RULES, text on the accent). Borders as longhands,
// which a captured render keeps.
const CHIP: CSSProperties = {
  justifySelf: 'end',
  minWidth: 38,
  boxSizing: 'border-box',
  textAlign: 'center',
  padding: '3px 6px',
  borderRadius: 6,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--accent)',
  background: 'var(--accent-muted)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  fontSize: 11,
  color: 'var(--accent)',
}

const NOTE: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-muted)' }

// The ring of the page's own spinner, one side at a time (a captured render drops a `border` shorthand with `var()`).
const SPINNER_RING: CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: 'var(--accent)',
  borderRightColor: 'var(--border-strong)',
  borderBottomColor: 'var(--border-strong)',
  borderLeftColor: 'var(--border-strong)',
}

export default function VolumeSheet({ unit, weekNumber, ended, thisWeek, lastWeek, thisWeekSchedule, lastWeekSchedule, onClose }: VolumeSheetProps) {
  const rule = useSettingsStore((s) => s.stageVolumeRule)
  const read = useVolumeSessions(lastWeek.map((plan) => plan.id))
  // With no plan row last week there is nothing to read: the sessions are none, at once.
  const noPlanRows = lastWeek.length === 0
  const sessions = read.data?.sessions
  // A read that can't start because the phone is offline is paused, not failed (TanStack waits for the network): a spinner that never ends
  // says nothing, so it reads as a failed one, whose reason is then that the phone is offline (SPEC Errors (15)).
  const paused = read.fetchStatus === 'paused'
  const loading = !noPlanRows && sessions === undefined && !read.isError && !paused
  const failed = !noPlanRows && sessions === undefined && (read.isError || paused)
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  const UNIT = unit === 'week' ? 'WEEK' : 'CYCLE'
  const lastNumber = weekNumber - 1

  // Counted on every render: a few dozen sets, and the inputs are the page's own arrays.
  const ready = noPlanRows || sessions !== undefined
  const rows = !ready
    ? []
    : volumeRows({
        lastWeek: {
          sessions: sessions ?? [],
          plan: lastWeek.map((plan) => ({ ...plan, occurrences: occurrencesOf(plan, lastWeekSchedule) })),
          ended,
        },
        thisWeek: thisWeek.map((plan) => ({ ...plan, occurrences: occurrencesOf(plan, thisWeekSchedule) })),
        exercises: volumeExercises([...thisWeek, ...lastWeek], read.data?.exercises ?? []),
        rule,
      })

  const emptyLast = !loading && !failed && lastWeekIsEmpty(lastWeek, sessions?.length ?? 0)

  return (
    <BottomSheet eyebrow={`${UNIT} ${weekNumber} · SETS PER MUSCLE`} title="Volume" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div role="table" aria-label="Sets per muscle, last week and this week" style={{ display: 'flex', flexDirection: 'column' }}>
          <div role="row" style={HEAD}>
            <span role="columnheader">MUSCLE</span>
            <span role="columnheader" style={{ textAlign: 'right' }}>{`${UNIT} ${lastNumber}`}</span>
            <span aria-hidden="true" />
            <span role="columnheader">{`${UNIT} ${weekNumber}`}</span>
            <span aria-hidden="true" />
          </div>

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0' }}>
              <div role="status" aria-label="Loading" className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', ...SPINNER_RING }} />
            </div>
          )}

          {failed && (
            <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: '18px 2px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', color: 'var(--error)' }}>
                {`Couldn't load ${unit === 'week' ? 'last week' : 'last cycle'}.`}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{errorReason(read.error, offline)}</span>
              <button
                type="button"
                onClick={() => void read.refetch()}
                style={{ height: 40, padding: '0 16px', borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-strong)', background: 'var(--surface)', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-primary)', cursor: 'pointer' }}
              >
                TRY AGAIN
              </button>
            </div>
          )}

          {!loading && !failed && rows.length === 0 && (
            <span style={{ padding: '18px 2px', fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
              {`Nothing is planned in either ${unit}.`}
            </span>
          )}

          {!loading &&
            !failed &&
            rows.map((row) => {
              const delta = emptyLast ? '' : formatVolumeDelta(row.delta)
              return (
                <div key={row.muscle} role="row" data-muscle={row.muscle} style={ROW}>
                  <div style={COUNTS}>
                    <span role="cell" style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{muscleName(row.muscle)}</span>
                    <span role="cell" style={{ ...MONO_15, textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {emptyLast ? '—' : formatVolumeCount(row.last)}
                    </span>
                    <span aria-hidden="true" style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>→</span>
                    <span role="cell" style={{ ...MONO_15, fontWeight: 700, color: 'var(--text-primary)' }}>{formatVolumeCount(row.this)}</span>
                    <span role="cell" data-delta={delta === '' ? 'none' : 'change'} style={delta === '' ? undefined : CHIP}>{delta}</span>
                  </div>
                  {row.note && <span style={NOTE}>{row.note}</span>}
                </div>
              )
            })}
        </div>

        <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{volumeFooter({ unit, lastWeek: lastNumber, rule })}</span>
      </div>
    </BottomSheet>
  )
}
