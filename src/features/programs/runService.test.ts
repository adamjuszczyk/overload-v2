import { describe, it, expect, vi, beforeEach } from 'vitest'

// runService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing, and would otherwise hit the
// network) — mocked here the same way sessionService.test.ts's own
// precedent does, with `rpc` mocked directly (reassignService.test.ts's own
// precedent for the repo's first .rpc() call) so startRun's exact function
// name and argument shape can be inspected rather than inferred.
const rpcMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))

const { startRun } = await import('./runService')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('startRun — calls v2_start_run with the right args', () => {
  it('calls supabase.rpc with the function name and the three named params', async () => {
    rpcMock.mockResolvedValue({ data: 'new-meso-1', error: null })

    await startRun('prog-1', 'Summer Block', '2026-10-04')

    expect(rpcMock).toHaveBeenCalledWith('v2_start_run', {
      p_program_id: 'prog-1',
      p_name: 'Summer Block',
      p_start_date: '2026-10-04',
    })
  })

  it('returns the new mesocycle id the RPC resolves with', async () => {
    rpcMock.mockResolvedValue({ data: 'new-meso-1', error: null })

    const result = await startRun('prog-1', 'Summer Block', '2026-10-04')

    expect(result).toBe('new-meso-1')
  })

  it('different arguments produce a different call — the wrapper does not hardcode or drop them', async () => {
    rpcMock.mockResolvedValue({ data: 'new-meso-2', error: null })

    await startRun('prog-2', 'Another Block', '2026-11-01')

    expect(rpcMock).toHaveBeenCalledWith('v2_start_run', {
      p_program_id: 'prog-2',
      p_name: 'Another Block',
      p_start_date: '2026-11-01',
    })
  })
})

describe('startRun — surfaces errors', () => {
  it('throws the exact error the RPC returned, rather than swallowing it', async () => {
    const rpcError = new Error('v2_start_run: program prog-1 is not a saved program (kind=run)')
    rpcMock.mockResolvedValue({ data: null, error: rpcError })

    await expect(startRun('prog-1', 'Summer Block', '2026-10-04')).rejects.toBe(rpcError)
  })

  it('a thrown/rejected call (network failure) propagates rather than resolving', async () => {
    rpcMock.mockRejectedValue(new Error('network down'))

    await expect(startRun('prog-1', 'Summer Block', '2026-10-04')).rejects.toThrow('network down')
  })
})
