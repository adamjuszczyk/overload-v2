// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import PlanTabs, { PLAN_LOCKED_HINT } from './PlanTabs'

// Chunk 65 (SPEC Navigation and settings [1.2] → PLAN | PROGRAMS (8): "With no program running it opens on PROGRAMS; PLAN shows a lock, and
// tapping it shows 'Start a program to plan your weeks.' (PR2)"; boards PR1, PR2). The locked PLAN tab at its own layer: what it draws, what
// a tap does (the hint, never Plan), and when the hint goes. Plan's own header (chunk 52) draws the tabs unlocked, exactly as it did.

afterEach(cleanup)

const plan = () => screen.getByRole('tab', { name: 'PLAN' })
const programs = () => screen.getByRole('tab', { name: 'PROGRAMS' })

describe('PlanTabs, unlocked (Plan\'s own header, and PROGRAMS with a program running)', () => {
  it('draws exactly PLAN and PROGRAMS: no lock, no disabled mark, and each tap opens its tab', () => {
    const onSelect = vi.fn()
    const { container } = render(<PlanTabs active="plan" onSelect={onSelect} />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['PLAN', 'PROGRAMS'])
    expect(plan().getAttribute('aria-selected')).toBe('true')
    expect(programs().getAttribute('aria-selected')).toBe('false')
    expect(plan().hasAttribute('aria-disabled')).toBe(false)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.click(programs())
    expect(onSelect).toHaveBeenLastCalledWith('programs')
    fireEvent.click(plan())
    expect(onSelect).toHaveBeenLastCalledWith('plan')
    // an unlocked PLAN never shows the hint
    expect(screen.queryByText(PLAN_LOCKED_HINT)).toBeNull()
  })

  it('the open tab is underlined in the accent and named in the primary text colour; the other is muted with no underline', () => {
    render(<PlanTabs active="programs" onSelect={() => undefined} />)
    expect(programs().style.borderBottomColor).toBe('var(--accent)')
    expect(programs().style.color).toBe('var(--text-primary)')
    expect(plan().style.borderBottomColor).toBe('transparent')
    expect(plan().style.color).toBe('var(--text-muted)')
  })
})

describe('PlanTabs, with PLAN locked (PR1 and PR2: no program running)', () => {
  it('PLAN is dimmed, carries a lock and is marked disabled; PROGRAMS is the open tab', () => {
    const { container } = render(<PlanTabs active="programs" onSelect={() => undefined} planLocked />)

    expect(plan().getAttribute('aria-disabled')).toBe('true')
    expect(plan().style.color).toBe('var(--text-dim)')
    // the lock is on PLAN's tab and nowhere else
    expect(plan().querySelector('svg')).not.toBeNull()
    expect(programs().querySelector('svg')).toBeNull()
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    // its accessible name stays "PLAN": the icon says nothing to a screen reader
    expect(plan().textContent).toBe('PLAN')
    expect(plan().querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(programs().getAttribute('aria-selected')).toBe('true')
    expect(programs().hasAttribute('aria-disabled')).toBe(false)
  })

  it('a tap on PLAN shows the hint and does not open Plan; a tap on PROGRAMS still selects it', () => {
    const onSelect = vi.fn()
    render(<PlanTabs active="programs" onSelect={onSelect} planLocked />)
    expect(screen.queryByText(PLAN_LOCKED_HINT)).toBeNull()

    fireEvent.click(plan())

    expect(screen.getByRole('status').textContent).toBe(PLAN_LOCKED_HINT)
    expect(PLAN_LOCKED_HINT).toBe('Start a program to plan your weeks.')
    expect(onSelect).not.toHaveBeenCalled()
    // PR2's arrow at the tab: a 12 px square turned 45 degrees, hidden from a screen reader, inside the bubble
    const arrow = screen.getByRole('status').querySelector('[aria-hidden="true"]') as HTMLElement
    expect(arrow).not.toBeNull()
    expect(arrow.style.width).toBe('12px')
    expect(arrow.style.height).toBe('12px')
    expect(arrow.style.transform).toBe('rotate(45deg)')

    fireEvent.click(programs())
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('programs')
  })

  it('a second tap on PLAN puts the hint away, and a third brings it back', () => {
    render(<PlanTabs active="programs" onSelect={() => undefined} planLocked />)
    fireEvent.click(plan())
    expect(screen.queryByRole('status')).not.toBeNull()
    fireEvent.click(plan())
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(plan())
    expect(screen.queryByRole('status')).not.toBeNull()
  })

  it('a tap anywhere else puts the hint away; a tap on PLAN itself is not "anywhere else" (it toggles, it does not close and reopen)', () => {
    render(
      <div>
        <PlanTabs active="programs" onSelect={() => undefined} planLocked />
        <p>somewhere else on the screen</p>
      </div>,
    )
    fireEvent.click(plan())
    expect(screen.queryByRole('status')).not.toBeNull()

    // the pointer going down on PLAN leaves it open (the click that follows toggles it off, once)
    fireEvent.pointerDown(plan())
    expect(screen.queryByRole('status')).not.toBeNull()
    fireEvent.pointerDown(screen.getByText('somewhere else on the screen'))
    expect(screen.queryByRole('status')).toBeNull()

    // and once it is away, a tap elsewhere has nothing to do and doesn't open it
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('the hint goes with the lock: once a program runs, PLAN is a tab like any other and the hint is not left behind', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<PlanTabs active="programs" onSelect={onSelect} planLocked />)
    fireEvent.click(plan())
    expect(screen.queryByRole('status')).not.toBeNull()

    rerender(<PlanTabs active="programs" onSelect={onSelect} planLocked={false} />)

    expect(screen.queryByRole('status')).toBeNull()
    expect(plan().hasAttribute('aria-disabled')).toBe(false)
    expect(plan().querySelector('svg')).toBeNull()
    fireEvent.click(plan())
    expect(onSelect).toHaveBeenCalledWith('plan')
    // ... and locking it again does not bring the old hint back
    rerender(<PlanTabs active="programs" onSelect={onSelect} planLocked />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
