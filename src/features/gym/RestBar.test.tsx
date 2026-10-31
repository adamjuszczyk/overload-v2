// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'

// Chunk 58a — the pinned rest bar (SPEC [1.2] "Rest timer (C5)"; boards W1, W4). It carries the D30 pins of the floating RestTimer it
// replaces (the duration is the rest chain's or Settings', GO appears exactly at the target, the Settings toggle hides it) and the
// bar's own states: past target, hidden, the jump button, and nothing at all when there is nothing to say.
afterEach(() => cleanup())

const { useRestTimerStore } = await import('./restTimerStore')
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../settings/settingsStore')
const { default: RestBar } = await import('./RestBar')

const noJump = { direction: null, label: null, onJump: () => {} } as const

beforeEach(() => {
  useRestTimerStore.setState({ startedAt: null, isVisible: true, anchorId: null, targetSeconds: null })
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-05T10:00:00.000Z'))
})
afterEach(() => vi.useRealTimers())

describe('D30 — the rest timer duration comes from Settings unless the rest chain resolved one, same as before (RestTimer.d30.test.tsx\'s pins)', () => {
  it('start() takes no arguments: logging ANY set starts the timer the same way', () => {
    expect(useRestTimerStore.getState().start.length).toBe(0)
    useRestTimerStore.getState().start()
    expect(useRestTimerStore.getState().startedAt).toBe(Date.now())
  })

  it('"GO" appears exactly at targetRestSeconds, not a moment before', () => {
    useSettingsStore.setState({ targetRestSeconds: 45 })
    useRestTimerStore.getState().start()
    const { container } = render(<RestBar jump={noJump} />)
    act(() => void vi.advanceTimersByTime(44_000))
    expect(container.textContent).not.toContain('GO')
    act(() => void vi.advanceTimersByTime(1_000)) // 45 s elapsed
    expect(container.textContent).toContain('GO')
  })

  it('a different Settings target moves the threshold identically', () => {
    useSettingsStore.setState({ targetRestSeconds: 90 })
    useRestTimerStore.getState().start()
    const { container } = render(<RestBar jump={noJump} />)
    act(() => void vi.advanceTimersByTime(89_000))
    expect(container.textContent).not.toContain('GO')
    act(() => void vi.advanceTimersByTime(1_000))
    expect(container.textContent).toContain('GO')
  })

  it('the rest chain\'s own target (chunk 16) wins over Settings\': startRest(40) shows "/ 0:40" and GO at 40 s', () => {
    useSettingsStore.setState({ targetRestSeconds: 90 })
    useRestTimerStore.getState().startRest(40)
    const { container } = render(<RestBar jump={noJump} />)
    expect(container.textContent).toContain('/ 0:40')
    act(() => void vi.advanceTimersByTime(39_000))
    expect(container.textContent).not.toContain('GO')
    act(() => void vi.advanceTimersByTime(1_000))
    expect(container.textContent).toContain('GO')
  })

  it('restTimerEnabled false hides the timer entirely: with no jump to show, nothing is drawn', () => {
    useSettingsStore.setState({ restTimerEnabled: false })
    useRestTimerStore.getState().start()
    const { container } = render(<RestBar jump={noJump} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('the bar\'s states (board W4)', () => {
  it('resting: "REST 1:12 / 2:00" with a progress bar and the chevron', () => {
    useSettingsStore.setState({ targetRestSeconds: 120 })
    useRestTimerStore.getState().start()
    const { container } = render(<RestBar jump={noJump} />)
    act(() => void vi.advanceTimersByTime(72_000))
    expect(container.textContent).toContain('REST')
    expect(container.textContent).toContain('1:12')
    expect(container.textContent).toContain('/ 2:00')
    expect(screen.getByLabelText('Hide rest timer')).toBeTruthy()
  })

  it('hidden: "REST 0:48" and the chevron back, no target and no progress bar; showing it again brings them back', () => {
    useRestTimerStore.getState().start()
    const { container } = render(<RestBar jump={noJump} />)
    act(() => void vi.advanceTimersByTime(48_000))
    fireEvent.click(screen.getByLabelText('Hide rest timer'))
    expect(container.textContent).toContain('0:48')
    expect(container.textContent).not.toContain('/ ')
    fireEvent.click(screen.getByLabelText('Show rest timer'))
    expect(container.textContent).toContain('/ ')
  })

  it('no inline timer exists anywhere: the bar is the only element that reads a rest time', () => {
    useRestTimerStore.getState().start()
    const { container } = render(<RestBar jump={noJump} />)
    expect(container.querySelectorAll('[data-rest-bar]')).toHaveLength(1)
  })

  it('the jump button points at the set — "↓ SET 03" below, "↑ SET 03" above — and scrolls when pressed', () => {
    const onJump = vi.fn()
    const { rerender } = render(<RestBar jump={{ direction: 'down', label: 'SET 03', onJump }} />)
    const button = screen.getByLabelText('Jump to SET 03')
    expect(button.textContent).toBe('SET 03')
    expect(button.querySelector('svg.lucide-arrow-down')).not.toBeNull()
    fireEvent.click(button)
    expect(onJump).toHaveBeenCalledTimes(1)
    rerender(<RestBar jump={{ direction: 'up', label: 'SET 03', onJump }} />)
    expect(screen.getByLabelText('Jump to SET 03').querySelector('svg.lucide-arrow-up')).not.toBeNull()
  })

  it('with the rest timer off (or no rest running) and the current set below, only the jump button is drawn', () => {
    useSettingsStore.setState({ restTimerEnabled: false })
    useRestTimerStore.getState().start()
    const { container } = render(<RestBar jump={{ direction: 'down', label: 'SET 03', onJump: () => {} }} />)
    expect(container.textContent).toBe('SET 03')
    expect(screen.queryByLabelText('Hide rest timer')).toBeNull()
  })

  it('resting with the current set above: the timer and the button share the bar', () => {
    useRestTimerStore.getState().start()
    render(<RestBar jump={{ direction: 'up', label: 'A2', onJump: () => {} }} />)
    expect(screen.getByLabelText('Jump to A2')).toBeTruthy()
    expect(screen.getByLabelText('Hide rest timer')).toBeTruthy()
  })

  it('the current set on screen and no rest: nothing is drawn, whatever the set is called', () => {
    const { container, rerender } = render(<RestBar jump={noJump} />)
    expect(container.innerHTML).toBe('')
    rerender(<RestBar jump={{ direction: null, label: 'SET 03', onJump: () => {} }} />) // a name but no direction: the set is in view
    expect(container.innerHTML).toBe('')
  })
})

// Chunk 78 (SPEC 1.2.1 [6]): "Once every working set and stage is logged or skipped, the rest bar shows WORKOUT COMPLETE and a FINISH button (which opens the finish
// screen) instead of the rest timer and the jump button. The rest keeps being timed underneath. An added set or exercise brings the bar back, showing the rest since the
// last set." The bar is told by the screen (`complete`); when the screen is right is GymSession.workoutComplete.test.tsx.
describe('WORKOUT COMPLETE (chunk 78; SPEC 1.2.1 [6])', () => {
  const styleOf = (el: Element) => el.getAttribute('style') ?? ''

  it('says WORKOUT COMPLETE with a FINISH button in place of the timer and the jump button, and FINISH calls the screen\'s finish once', () => {
    useSettingsStore.setState({ targetRestSeconds: 120 })
    useRestTimerStore.getState().start()
    const onFinish = vi.fn()
    const onJump = vi.fn()
    const { container } = render(<RestBar jump={{ direction: 'down', label: 'SET 03', onJump }} complete={{ onFinish }} />)
    act(() => void vi.advanceTimersByTime(72_000))
    expect(container.textContent).toBe('WORKOUT COMPLETEFINISH')
    // neither the timer nor its chevron nor the jump button
    expect(screen.queryByLabelText('Hide rest timer')).toBeNull()
    expect(screen.queryByLabelText('Show rest timer')).toBeNull()
    expect(screen.queryByLabelText('Jump to SET 03')).toBeNull()
    expect(container.textContent).not.toContain('REST')
    expect(container.querySelectorAll('[data-rest-bar]')).toHaveLength(1) // still the one bar
    fireEvent.click(screen.getByText('FINISH'))
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onJump).not.toHaveBeenCalled()
  })

  it('draws the bar with the rest timer off and with nothing resting too: the workout being done is not a rest', () => {
    useSettingsStore.setState({ restTimerEnabled: false })
    const view = render(<RestBar jump={noJump} complete={{ onFinish: () => {} }} />)
    expect(view.container.textContent).toBe('WORKOUT COMPLETEFINISH')
    view.unmount()
    useSettingsStore.setState({ restTimerEnabled: true })
    const idle = render(<RestBar jump={noJump} complete={{ onFinish: () => {} }} />) // no rest started at all
    expect(idle.container.textContent).toBe('WORKOUT COMPLETEFINISH')
  })

  it('FINISH is text on the accent, drawn in --on-accent (the standing rule for text on the accent)', () => {
    render(<RestBar jump={noJump} complete={{ onFinish: () => {} }} />)
    const finish = screen.getByText('FINISH')
    expect(styleOf(finish)).toContain('background-color: var(--accent)')
    expect(styleOf(finish)).toContain('color: var(--on-accent)')
  })

  it('the rest keeps being timed underneath: the timer is back at once, showing the rest since the last set, when the screen stops saying it is complete (an added set)', () => {
    useSettingsStore.setState({ targetRestSeconds: 120 })
    useRestTimerStore.getState().start()
    const { container, rerender } = render(<RestBar jump={noJump} complete={{ onFinish: () => {} }} />)
    act(() => void vi.advanceTimersByTime(45_000))
    expect(container.textContent).not.toContain('0:45') // nothing of the timer is drawn while the workout is complete
    rerender(<RestBar jump={{ direction: 'down', label: 'SET 04', onJump: () => {} }} complete={null} />) // + ADD SET: a current set again
    // no tick has passed since the rerender: the 45 s were counted while the bar said the workout was complete
    expect(container.textContent).toContain('REST0:45')
    expect(container.textContent).toContain('/ 2:00')
    expect(screen.getByLabelText('Jump to SET 04')).toBeTruthy()
    expect(container.textContent).not.toContain('WORKOUT COMPLETE')
    expect(useRestTimerStore.getState().startedAt).toBe(new Date('2026-01-05T10:00:00.000Z').getTime()) // the store itself was never touched
  })

  it('FINISH does not stop or restart the rest timer, and a null or missing `complete` is the usual bar', () => {
    useRestTimerStore.getState().start()
    const onFinish = vi.fn()
    const { container, rerender } = render(<RestBar jump={noJump} complete={{ onFinish }} />)
    fireEvent.click(screen.getByText('FINISH'))
    expect(useRestTimerStore.getState().startedAt).not.toBeNull()
    rerender(<RestBar jump={noJump} complete={null} />)
    expect(container.textContent).toContain('REST')
    rerender(<RestBar jump={noJump} />)
    expect(container.textContent).toContain('REST')
    expect(container.textContent).not.toContain('FINISH')
  })
})
