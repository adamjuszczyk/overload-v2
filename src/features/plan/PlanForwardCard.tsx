import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { Lock } from 'lucide-react'
import { errorReason } from '../../components/exercisePickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import type { PlanningType } from '../../types'
import { usePlanForward, useDefaultHasSets } from './usePlanForward'
import { nothingToPlanFrom } from './planForwardLogic'

// Chunk 52 (TASKS-1.2 "Plan's header" → PlanForwardCard; SPEC Screens → Plan screen → Week row, Weeks and copying [1.2] → "How far
// ahead", Defaults; board 1b; P1.2-10). What opening the first unplanned week after the current one shows: "Week 3 isn't planned yet",
// PLAN FORWARD, what it takes, and which workouts the week will have, by the weekdays in force for that week (chunk 50). Opening the
// week plans nothing; the button plans exactly the week of the tile that is open, which PlanPage hands in from `weekTiles`' `planForward`
// tile (the week after the current one, never the highest planned week plus one).
//
// Display choices no board settles, provisional under D31 (chunk 52's report lists them): on a sequence run the list names the slots
// ("SLOT 2 · Rest day"), the card says "cycle" for "week"; the failure is a line under the button, "Couldn't plan week 3." and the real
// reason under it (SPEC Errors (15)); a stable run whose default has no set in any of the week's workouts has the button disabled with
// "Nothing to plan from" under it (P1.2-10).

export interface WillHaveRow {
  /** `MON`, or `SLOT 2` on a sequence run. */
  label: string
  /** The workout's name; "Rest day" for a slot that has none. */
  name: string
}

export interface PlanForwardCardProps {
  mesoId: string
  /** The week this card plans: the week of the open tile. */
  week: number
  unit: 'week' | 'cycle'
  planningType: PlanningType
  /** The small print under the button (`forwardNote`). */
  note: string
  /** The week's workouts, by the schedule in force for it. */
  willHave: readonly WillHaveRow[]
  /** The workouts of the week, for the stable default's emptiness check. */
  workoutDayIds: readonly string[]
}

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export default function PlanForwardCard({ mesoId, week, unit, planningType, note, willHave, workoutDayIds }: PlanForwardCardProps) {
  const forward = usePlanForward(mesoId)
  const stable = planningType === 'stable'
  const defaultRead = useDefaultHasSets(workoutDayIds, stable)
  const nothing = nothingToPlanFrom(planningType, defaultRead.data)
  const inFlight = useRef(false)

  async function plan() {
    if (inFlight.current || nothing) return
    inFlight.current = true
    try {
      await forward.mutateAsync(week)
    } catch {
      // the failure is the mutation's own state: the line under the button
    } finally {
      inFlight.current = false
    }
  }

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 14,
          padding: '22px 18px',
          borderRadius: 12,
          background: 'var(--surface)',
          ...hairline('var(--border)'),
        }}
      >
        <div
          aria-hidden="true"
          style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--surface-raised)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Lock size={20} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 20, lineHeight: 1.15, color: 'var(--text-primary)' }}>
            {`${capitalised(unit)} ${week} isn't planned yet`}
          </span>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            {`It plans itself when the ${unit} starts. Plan it now if you want to set its numbers ahead.`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void plan()}
          disabled={forward.isPending || nothing}
          style={{
            width: '100%',
            height: 52,
            borderWidth: 0,
            borderRadius: 10,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 15,
            letterSpacing: '0.03em',
            cursor: forward.isPending || nothing ? 'default' : 'pointer',
            opacity: nothing ? 0.5 : 1,
          }}
        >
          {forward.isPending ? 'PLANNING…' : 'PLAN FORWARD'}
        </button>
        {nothing && (
          <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.1em', lineHeight: 1.6, color: 'var(--text-muted)' }}>Nothing to plan from</span>
        )}
        {forward.isError && (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.1em', lineHeight: 1.6, color: 'var(--error)' }}>{`Couldn't plan ${unit} ${week}.`}</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{errorReason(forward.error, offline)}</span>
          </div>
        )}
        <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.1em', lineHeight: 1.6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{note}</span>
      </div>

      {willHave.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{`${unit.toUpperCase()} ${week} WILL HAVE`}</span>
          <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 12, background: 'var(--surface)', ...hairline('var(--border)') }}>
            {willHave.map((row, index) => (
              <div
                key={`${row.label}:${index}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  minHeight: 44,
                  padding: '0 14px',
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopStyle: 'solid',
                  borderTopColor: 'var(--border-subtle)',
                }}
              >
                <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{row.label}</span>
                <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-secondary)' }}>{row.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
