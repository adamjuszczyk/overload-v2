// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { Session, WeekPlan } from '../../types'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

// Chunk 61 — auto-finish waits for what the workout's rows say is left (DECISIONS 166 (a), Adam 2026-10-16; SPEC "Finishing": "Auto-finish waits for what the
// workout's rows say is left (the same view as the finish warning)"). The hook is told whether nothing is left (`nothingLeft`, the screen's `finishWarning`
// being null); the threshold and the grace window are as they were. `GymSession.autoFinish.test.tsx` holds the screen's side: that it asks the rows, not the logs.
const complete = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock('./useSession', () => ({ useCompleteSession: () => complete }))

const { useAutoFinishSession } = await import('./useAutoFinishSession')

const MIN = 60_000
const START = new Date('2026-01-06T09:00:00Z').getTime()
const plan = { sets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } as unknown as WeekPlan
const log = (id: string, minutesAfterStart: number) => ({ id, weekPlanSetId: id, loggedAt: new Date(START + minutesAfterStart * MIN).toISOString() })
const sessionWith = (logs: ReturnType<typeof log>[], over: Partial<Session> = {}) =>
  ({ id: 's1', status: 'in_progress', note: null, setLogs: logs, ...over }) as unknown as Session

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START + 6 * MIN)
  complete.mutate.mockReset()
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, autoFinishMinutes: 10 })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const wait = (minutes: number) => vi.advanceTimersByTime(minutes * MIN)

describe('auto-finish (166 (a))', () => {
  it('finishes once nothing is left and the last set is older than the threshold, after the grace window since the screen opened; the finish is `{ id, note }`', () => {
    // logged 'a' and 'c' only: 'b' is the set the session deleted (the screen says nothing is left, the logs name no 'b')
    renderHook(() => useAutoFinishSession(sessionWith([log('a', 1), log('c', 2)], { note: 'felt good' }), plan, true))
    wait(5) // the grace window (10 min since the screen was armed) is not over
    expect(complete.mutate).not.toHaveBeenCalled()
    wait(6)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
    expect(complete.mutate.mock.calls[0][0]).toEqual({ id: 's1', note: 'felt good' })
    wait(30)
    expect(complete.mutate).toHaveBeenCalledTimes(1) // once
  })

  it('never finishes while the rows say something is left, however long it has been', () => {
    renderHook(() => useAutoFinishSession(sessionWith([log('a', 1), log('b', 2)]), plan, false))
    wait(120)
    expect(complete.mutate).not.toHaveBeenCalled()
  })

  it('does not read the logs for the plan\'s sets: a planned set with no log (deleted) does not hold it back, and one more log would not hurry it', () => {
    const view = renderHook(({ left }: { left: boolean }) => useAutoFinishSession(sessionWith([log('a', 1)]), plan, left), { initialProps: { left: false } })
    wait(30)
    expect(complete.mutate).not.toHaveBeenCalled()
    view.rerender({ left: true })
    wait(1)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
  })

  it('waits for the threshold since the last log, a newer log moves it, and a session with no log never finishes by itself', () => {
    const view = renderHook(({ logs }: { logs: ReturnType<typeof log>[] }) => useAutoFinishSession(sessionWith(logs), plan, true), { initialProps: { logs: [log('a', 11)] } })
    wait(11) // the grace window is over; the last log is 6 + 11 − 11 = 6 minutes old
    expect(complete.mutate).not.toHaveBeenCalled()
    view.rerender({ logs: [log('a', 11), log('b', 16)] }) // a newer one
    wait(8)
    expect(complete.mutate).not.toHaveBeenCalled()
    wait(4)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
    cleanup()
    complete.mutate.mockReset()
    renderHook(() => useAutoFinishSession(sessionWith([]), plan, true))
    wait(120)
    expect(complete.mutate).not.toHaveBeenCalled()
  })

  it('does nothing with the setting off, on a session that is not in progress, or on a plan with no sets', () => {
    useSettingsStore.setState({ autoFinishMinutes: null })
    const off = renderHook(() => useAutoFinishSession(sessionWith([log('a', 1)]), plan, true))
    wait(120)
    off.unmount() // it subscribes to the setting: turning it on again would wake it
    useSettingsStore.setState({ autoFinishMinutes: 10 })
    renderHook(() => useAutoFinishSession(sessionWith([log('a', 1)], { status: 'completed' }), plan, true))
    renderHook(() => useAutoFinishSession(sessionWith([log('a', 1)]), { sets: [] } as unknown as WeekPlan, true))
    renderHook(() => useAutoFinishSession(sessionWith([log('a', 1)]), null, true))
    wait(120)
    expect(complete.mutate).not.toHaveBeenCalled()
  })
})
