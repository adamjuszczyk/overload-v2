// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Chunk 52 (TASKS-1.2 "Plan's header" → PlanForwardCard; SPEC Weeks and copying [1.2]; P1.2-10; board 1b). The card as a component, with
// the hooks behind it stood in for: what the button looks like in each of its states (ready, planning, nothing to plan from), when the
// "WILL HAVE" list is drawn, and how its rows are ruled. Which week the card names, what the button calls and what the tiles do after are
// PlanPage.planning.test.tsx's, against the real hooks.

const hook = vi.hoisted(() => ({
  forward: { isPending: false, isError: false, error: null as unknown, mutateAsync: vi.fn() },
  defaultHasSets: undefined as boolean | undefined,
}))
vi.mock('./usePlanForward', () => ({
  usePlanForward: () => hook.forward,
  useDefaultHasSets: () => ({ data: hook.defaultHasSets }),
}))

const { default: PlanForwardCard } = await import('./PlanForwardCard')

beforeEach(() => {
  hook.forward = { isPending: false, isError: false, error: null, mutateAsync: vi.fn().mockResolvedValue(2) }
  hook.defaultHasSets = undefined
})
afterEach(cleanup)

const ROWS = [
  { label: 'MON', name: 'Push Day' },
  { label: 'WED', name: 'Pull Day' },
  { label: 'FRI', name: 'Leg Day' },
]

function card(props: Partial<Parameters<typeof PlanForwardCard>[0]> = {}) {
  return render(
    <PlanForwardCard
      mesoId="meso-1"
      week={3}
      unit="week"
      planningType="week_dependent"
      note="Takes week 2's sets and set types. Numbers come with COPY. Week 4 opens once week 3 is planned."
      willHave={ROWS}
      workoutDayIds={['wd-push', 'wd-pull']}
      {...props}
    />,
  )
}
const button = () => screen.getByRole('button') as HTMLButtonElement

describe('the PLAN FORWARD button in each of its states', () => {
  it('ready: PLAN FORWARD, enabled, the pointer, full strength', () => {
    card()
    expect(button().textContent).toBe('PLAN FORWARD')
    expect(button().disabled).toBe(false)
    expect(button().style.cursor).toBe('pointer')
    expect(button().style.opacity).toBe('1')
  })

  it('while the week is being planned: PLANNING…, disabled, no pointer, still full strength (it is working, not unavailable)', () => {
    hook.forward.isPending = true
    card()
    expect(button().textContent).toBe('PLANNING…')
    expect(button().disabled).toBe(true)
    expect(button().style.cursor).toBe('default')
    expect(button().style.opacity).toBe('1')
  })

  it('a stable run whose default holds no set: disabled, no pointer, half strength, "Nothing to plan from" under it, and a press calls nothing', () => {
    hook.defaultHasSets = false
    card({ planningType: 'stable' })
    expect(button().disabled).toBe(true)
    expect(button().style.cursor).toBe('default')
    expect(button().style.opacity).toBe('0.5')
    expect(screen.getByText('Nothing to plan from')).toBeTruthy()
    fireEvent.click(button())
    expect(hook.forward.mutateAsync).not.toHaveBeenCalled()
  })

  it('a stable run whose default holds a set: the same button as any other, and the press plans the week the card names', () => {
    hook.defaultHasSets = true
    card({ planningType: 'stable', week: 5 })
    expect(button().disabled).toBe(false)
    expect(button().style.cursor).toBe('pointer')
    expect(button().style.opacity).toBe('1')
    expect(screen.queryByText('Nothing to plan from')).toBeNull()
    fireEvent.click(button())
    expect(hook.forward.mutateAsync.mock.calls).toEqual([[5]])
  })

  it('a week-dependent run is never held back by the default, whatever it holds', () => {
    hook.defaultHasSets = false
    card({ planningType: 'week_dependent' })
    expect(button().disabled).toBe(false)
    expect(button().style.opacity).toBe('1')
    expect(screen.queryByText('Nothing to plan from')).toBeNull()
  })
})

describe('"WEEK 3 WILL HAVE": the workouts the week will have', () => {
  const rowsOf = () => Array.from((screen.getByText('WEEK 3 WILL HAVE').nextElementSibling as HTMLElement).children) as HTMLElement[]

  it('one row per workout in the order given, the label then the name, ruled between rows and not above the first', () => {
    card()
    expect(rowsOf().map((row) => row.textContent)).toEqual(['MONPush Day', 'WEDPull Day', 'FRILeg Day'])
    expect(rowsOf().map((row) => parseFloat(row.style.borderTopWidth))).toEqual([0, 1, 1])
  })

  it('a week with no workout draws no list and no heading over nothing; the card and its button are still there', () => {
    card({ willHave: [] })
    expect(screen.queryByText(/WILL HAVE/)).toBeNull()
    expect(button().textContent).toBe('PLAN FORWARD')
    expect(screen.getByText(/Numbers come with COPY/)).toBeTruthy()
  })

  it('a sequence run names the cycle: "CYCLE 8 WILL HAVE" over the slots, and the card says cycle', () => {
    card({ unit: 'cycle', week: 8, willHave: [{ label: 'SLOT 1', name: 'Push Day' }, { label: 'SLOT 2', name: 'Rest day' }] })
    expect(screen.getByText('CYCLE 8 WILL HAVE')).toBeTruthy()
    expect(screen.getByText("Cycle 8 isn't planned yet")).toBeTruthy()
    expect(screen.getByText('It plans itself when the cycle starts. Plan it now if you want to set its numbers ahead.')).toBeTruthy()
  })
})
