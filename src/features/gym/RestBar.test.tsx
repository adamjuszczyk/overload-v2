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
