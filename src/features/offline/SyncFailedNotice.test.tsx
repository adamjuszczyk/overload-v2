// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useOfflineStore, type SyncFailure } from './offlineStore'

const retryMock = vi.fn().mockResolvedValue(undefined)
vi.mock('./useSyncQueue', () => ({ retrySyncFailures: () => retryMock() }))

const { default: SyncFailedNotice } = await import('./SyncFailedNotice')

const failure = (queueId: number, sessionId: string | null): SyncFailure => ({
  queueId, table: 'v2_set_logs', recordId: `l${queueId}`, sessionId,
})

afterEach(() => {
  cleanup()
  retryMock.mockClear()
  useOfflineStore.getState().setSyncFailures([])
})

describe('SyncFailedNotice', () => {
  it('renders nothing when nothing failed (a screen without failures is unchanged)', () => {
    const { container } = render(<SyncFailedNotice sessionId="s1" className="px-4" />)
    expect(container.innerHTML).toBe('')
  })

  it('shows only its own session’s failures, in one short line', () => {
    useOfflineStore.getState().setSyncFailures([failure(1, 's1'), failure(2, 's2')])
    render(<SyncFailedNotice sessionId="s1" />)
    expect(screen.getByRole('button').textContent).toBe("1 change couldn't sync. Tap to retry.")
  })

  it('counts several', () => {
    useOfflineStore.getState().setSyncFailures([failure(1, 's1'), failure(2, 's1')])
    render(<SyncFailedNotice sessionId="s1" />)
    expect(screen.getByRole('button').textContent).toBe("2 changes couldn't sync. Tap to retry.")
  })

  it('a note with no session shows where sessionId is null', () => {
    useOfflineStore.getState().setSyncFailures([failure(1, null)])
    render(<SyncFailedNotice sessionId={null} />)
    expect(screen.getByRole('button')).toBeTruthy()
  })

  it('tapping retries once, even on a double tap', async () => {
    let release!: () => void
    retryMock.mockImplementationOnce(() => new Promise<void>((r) => { release = r }))
    useOfflineStore.getState().setSyncFailures([failure(1, 's1')])
    render(<SyncFailedNotice sessionId="s1" />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('RETRYING…'))
    release()
    await waitFor(() => expect(retryMock).toHaveBeenCalledTimes(1))
  })
})
