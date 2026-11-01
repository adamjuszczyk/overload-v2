// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]): the two pieces this chunk draws, in SPEC's own words. The queue's length is the one input
// the screen reads (`useQueuedWriteCount`, stood in for here and proven on its own); whether a screen or the strip shows at all is `useGate`'s
// and `App.tsx`'s (App.maintenance.test.tsx).
const queued = vi.hoisted(() => ({ count: 0 }))
vi.mock('./useQueuedWriteCount', () => ({ useQueuedWriteCount: () => queued.count }))

const { MaintenanceScreen, MaintenanceStrip, GateScreen, UpdateRequiredScreen } = await import('./gates')

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

// Chunk 73 (SPEC.md 1.2.1, Screens → Update to continue [11]; the prototype's "Update to continue": Ready, Unsent changes, Updating, Couldn't update).
// SPEC's words: "UPDATE / UPDATE TO CONTINUE / This is 1.2.0. Overload needs 1.2.1 or newer." with an UPDATE button; "With unsent changes, it adds:
// 'Unsent changes are kept and sent after the update.'"; UPDATING…; "Couldn't update. Check your connection and try again.", and the button reads TRY AGAIN.
describe('UpdateRequiredScreen', () => {
  const UNSENT = 'Unsent changes are kept and sent after the update.'
  const ERROR = "Couldn't update. Check your connection and try again."
  const draw = (state: 'ready' | 'updating' | 'failed' = 'ready', onUpdate = vi.fn()) =>
    render(<UpdateRequiredScreen appVersion="1.2.0" minVersion="1.2.1" state={state} onUpdate={onUpdate} />)

  it('Ready: UPDATE / UPDATE TO CONTINUE / "This is 1.2.0. Overload needs 1.2.1 or newer." and an UPDATE button, nothing else', () => {
    const { container } = draw()
    expect(container.querySelector('p')!.textContent, 'the eyebrow').toBe('UPDATE')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('UPDATE TO CONTINUE')
    expect(screen.getByText('This is 1.2.0. Overload needs 1.2.1 or newer.')).toBeTruthy()
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('UPDATE')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(UNSENT)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.textContent).toBe('UPDATEUPDATE TO CONTINUEThis is 1.2.0. Overload needs 1.2.1 or newer.UPDATE')
  })

  it('the two versions are the ones it is given, whatever they are', () => {
    render(<UpdateRequiredScreen appVersion="1.2.1" minVersion="1.2.2" state="ready" onUpdate={vi.fn()} />)
    expect(screen.getByText('This is 1.2.1. Overload needs 1.2.2 or newer.')).toBeTruthy()
  })

  it('Unsent changes: the line follows the version sentence when the phone holds writes (the queue holds 3), and is gone with none', () => {
    queued.count = 3
    draw()
    const first = screen.getByText('This is 1.2.0. Overload needs 1.2.1 or newer.')
    expect(first.compareDocumentPosition(screen.getByText(UNSENT)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup()
    for (const [count, shown] of [[0, false], [1, true], [3, true], [40, true]] as const) {
      queued.count = count
      const { unmount } = draw()
      expect(screen.queryAllByText(UNSENT).length, `queue of ${count}`).toBe(shown ? 1 : 0)
      unmount()
    }
  })

  it('Updating: the button reads UPDATING… and is held, so a second press does nothing', () => {
    const onUpdate = vi.fn()
    draw('updating', onUpdate)
    const button = screen.getByRole('button') as HTMLButtonElement
    expect(button.textContent).toBe('UPDATING…')
    expect(button.disabled).toBe(true)
    expect(button.style.opacity).toBe('0.6')
    fireEvent.click(button)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("Couldn't update: the error line (an alert) under the sentences, and the button reads TRY AGAIN and works", () => {
    const onUpdate = vi.fn()
    draw('failed', onUpdate)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(ERROR)
    expect(alert.style.color).toBe('var(--error)')
    expect(screen.getByText('This is 1.2.0. Overload needs 1.2.1 or newer.').compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const button = screen.getByRole('button', { name: 'TRY AGAIN' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.style.opacity).toBe('1')
    fireEvent.click(button)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('the error line is only in the failed state, and TRY AGAIN only there; UPDATE reads UPDATE in the others', () => {
    for (const state of ['ready', 'updating'] as const) {
      const { unmount } = draw(state)
      expect(screen.queryByRole('alert'), state).toBeNull()
      expect(screen.queryByText('TRY AGAIN'), state).toBeNull()
      unmount()
    }
  })

  it('UPDATE calls the update once per press', () => {
    const onUpdate = vi.fn()
    draw('ready', onUpdate)
    fireEvent.click(screen.getByRole('button'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('replaces the whole app: a full-height screen of its own; the button is the accent with its text in --on-accent; no hard-coded colour', () => {
    const { container } = draw()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-dvh')
    expect(root.style.background).toBe('var(--base)')
    const button = screen.getByRole('button')
    expect(button.style.background).toBe('var(--accent)')
    expect(button.style.color).toBe('var(--on-accent)')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('has no way past it: no other button, no link', () => {
    const { container } = draw('failed')
    expect(container.querySelectorAll('button').length).toBe(1)
    expect(container.querySelectorAll('a').length).toBe(0)
  })
})
