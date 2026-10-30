// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]): the two pieces this chunk draws, in SPEC's own words. The queue's length is the one input
// the screen reads (`useQueuedWriteCount`, stood in for here and proven on its own); whether a screen or the strip shows at all is `useGate`'s
// and `App.tsx`'s (App.maintenance.test.tsx).
const queued = vi.hoisted(() => ({ count: 0 }))
vi.mock('./useQueuedWriteCount', () => ({ useQueuedWriteCount: () => queued.count }))

const { MaintenanceScreen, MaintenanceStrip, GateScreen } = await import('./gates')

const QUEUED_LINE = 'Changes you made offline are kept and sent then.'

beforeEach(() => {
  queued.count = 0
})
afterEach(() => cleanup())

describe('MaintenanceScreen', () => {
  it('says MAINTENANCE / BACK SOON / "Overload is being updated. It opens again by itself when that\'s done." and nothing else when nothing is waiting', () => {
    render(<MaintenanceScreen />)
    expect(screen.getByText('MAINTENANCE')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('BACK SOON')
    expect(screen.getByText("Overload is being updated. It opens again by itself when that's done.")).toBeTruthy()
    expect(screen.queryByText(QUEUED_LINE)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull() // signed in: no action at all
  })

  it('with unsent offline changes (the queue holds 3) it adds "Changes you made offline are kept and sent then."', () => {
    queued.count = 3
    render(<MaintenanceScreen />)
    expect(screen.getByText(QUEUED_LINE)).toBeTruthy()
    // the line follows the one it adds to
    const first = screen.getByText("Overload is being updated. It opens again by itself when that's done.")
    expect(first.compareDocumentPosition(screen.getByText(QUEUED_LINE)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a table over the queue length: 0 draws no line, 1, 3 and 40 draw it once', () => {
    for (const [count, shown] of [[0, false], [1, true], [3, true], [40, true]] as const) {
      queued.count = count
      const { unmount } = render(<MaintenanceScreen />)
      expect(screen.queryAllByText(QUEUED_LINE).length, `queue of ${count}`).toBe(shown ? 1 : 0)
      unmount()
    }
  })

  it('has SIGN IN only when it is given the way to the sign-in page (a signed-out visitor), and it calls it once per press', () => {
    const onSignIn = vi.fn()
    const { rerender } = render(<MaintenanceScreen onSignIn={onSignIn} />)
    const button = screen.getByRole('button', { name: 'SIGN IN' })
    fireEvent.click(button)
    expect(onSignIn).toHaveBeenCalledTimes(1)
    rerender(<MaintenanceScreen />)
    expect(screen.queryByRole('button', { name: 'SIGN IN' })).toBeNull()
  })

  it('replaces the whole app: a full-height screen of its own, drawn in tokens (no hard-coded colour)', () => {
    const { container } = render(<MaintenanceScreen onSignIn={() => {}} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-dvh')
    expect(root.style.background).toBe('var(--base)')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('GateScreen', () => {
  it('draws the eyebrow, the title, the lines and the action it is given, in that order (the update screen of chunk 73 uses it too)', () => {
    render(
      <GateScreen eyebrow="EYEBROW" title="TITLE" action={<button type="button">ACT</button>}>
        <p>BODY</p>
      </GateScreen>,
    )
    const order = ['EYEBROW', 'TITLE', 'BODY', 'ACT'].map((text) => screen.getByText(text))
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, order[i].textContent!).toBeTruthy()
  })
})

describe('MaintenanceStrip', () => {
  it('says "MAINTENANCE ON · ONLY YOUR ACCOUNT CAN USE THE APP", in the accent tint like the banner it stands in for', () => {
    const { container } = render(<MaintenanceStrip />)
    expect(screen.getByRole('status').textContent).toBe('MAINTENANCE ON · ONLY YOUR ACCOUNT CAN USE THE APP')
    const strip = container.firstElementChild as HTMLElement
    expect(strip.style.background).toBe('var(--accent-muted)')
    expect(strip.style.borderBottomColor).toBe('var(--accent)')
    expect(screen.getByText(/^MAINTENANCE ON/).style.color).toBe('var(--accent)')
  })

  it('is not a screen: no heading, no action, nothing that covers the app', () => {
    render(<MaintenanceStrip />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
