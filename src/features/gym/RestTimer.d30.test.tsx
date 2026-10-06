// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// D30 (Adam's standing rule, chunk 9) — "Rest timing must also be
// unchanged. Show the rest timer starts with the same duration after
// logging a set as on master." Neither file this test exercises
// (RestTimer.tsx, restTimerStore.ts) has any diff against master 071151b
// (git diff 071151b -- these files is empty — see this chunk's report), and
// neither takes a program exercise, a week plan or any chunk-9 data as
// input at all:
//   - useRestTimerStore.start() takes NO arguments — it can only ever read
//     Date.now(), never anything about which exercise or week a set
//     belongs to.
//   - RestTimer() takes NO props — its only inputs are restTimerStore's own
//     state and settingsStore's restTimerEnabled/targetRestSeconds/
//     buzzOnRestComplete, none of which chunk 9 touches.
// This proves the duration a rest period starts with (targetRestSeconds)
// is governed purely by Settings, unaffected by which exercise (template,
// week-only swap replacement, or newly added) the just-logged set belongs
// to — there is no code path by which it could be otherwise.

afterEach(() => cleanup())

const { useRestTimerStore } = await import('./restTimerStore')
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../settings/settingsStore')
const { default: RestTimer } = await import('./RestTimer')

beforeEach(() => {
  useRestTimerStore.setState({ startedAt: null, isVisible: true, anchorId: null })
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-05T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('D30 — rest timer duration comes from Settings only, same as master', () => {
  it('start() takes no arguments: logging ANY set (any exercise, any slot) starts the timer the same way', () => {
    // No programExerciseId, no exerciseId, nothing — the function this
    // app's onLog chain calls (GymSession.tsx's handleLog, unchanged)
    // cannot pass per-exercise data in even if it wanted to.
    expect(useRestTimerStore.getState().start.length).toBe(0)
    useRestTimerStore.getState().start()
    expect(useRestTimerStore.getState().startedAt).toBe(Date.now())
  })

  it('the rest timer is still at the Settings target (120s default) after a set is logged — "GO" appears exactly at targetRestSeconds, not a moment before', () => {
    useSettingsStore.setState({ targetRestSeconds: 45 })
    useRestTimerStore.getState().start() // what GymSession's set-logging chain triggers (via ExerciseCard/SetRow, unchanged)

    const { container } = render(<RestTimer />)

    act(() => { vi.advanceTimersByTime(44_000) })
    expect(container.textContent).not.toContain('GO')

    act(() => { vi.advanceTimersByTime(1_000) }) // 45s elapsed
    expect(container.textContent).toContain('GO')
  })

  it('a DIFFERENT targetRestSeconds (a different user setting, nothing about the exercise) changes the threshold identically', () => {
    useSettingsStore.setState({ targetRestSeconds: 90 })
    useRestTimerStore.getState().start()

    const { container } = render(<RestTimer />)

    act(() => { vi.advanceTimersByTime(89_000) })
    expect(container.textContent).not.toContain('GO')
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(container.textContent).toContain('GO')
  })

  it('restTimerEnabled: false (a Settings toggle, unrelated to any chunk-9 data) still hides the timer entirely, same as master', () => {
    useSettingsStore.setState({ restTimerEnabled: false })
    useRestTimerStore.getState().start()

    const { container } = render(<RestTimer />)
    expect(container.innerHTML).toBe('')
  })
})
