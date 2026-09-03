import { describe, it, expect } from 'vitest'
import { selectPreviousMeso } from './usePriorityContext'
import type { Mesocycle } from '../../types'

// Fixture factory — only the fields selectPreviousMeso actually reads
// (id, startDate, createdAt) vary meaningfully per test; the rest are fixed
// so each test only has to state what's relevant to it.
function meso(overrides: Partial<Mesocycle> & { id: string }): Mesocycle {
  return {
    userId: 'u1',
    name: overrides.id,
    programId: 'p1',
    status: 'completed',
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('selectPreviousMeso — Q1a\'s selection rule', () => {
  it('greatest start_date wins', () => {
    const mesos = [
      meso({ id: 'target', startDate: '2026-03-01', createdAt: '2026-03-01T00:00:00Z' }),
      meso({ id: 'oldest', startDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' }),
      meso({ id: 'newest-prior', startDate: '2026-02-15', createdAt: '2026-02-15T00:00:00Z' }),
      meso({ id: 'middle', startDate: '2026-02-01', createdAt: '2026-02-01T00:00:00Z' }),
    ]
    expect(selectPreviousMeso(mesos, 'target')?.id).toBe('newest-prior')
  })

  it('the target meso is excluded even when it is the newest by start_date — the next-greatest among the remainder wins', () => {
    const mesos = [
      meso({ id: 'target', startDate: '2026-05-01', createdAt: '2026-05-01T00:00:00Z' }),
      meso({ id: 'runner-up', startDate: '2026-03-01', createdAt: '2026-03-01T00:00:00Z' }),
      meso({ id: 'oldest', startDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' }),
    ]
    const result = selectPreviousMeso(mesos, 'target')
    expect(result?.id).toBe('runner-up')
    expect(result?.id).not.toBe('target')
  })

  it('created_at desc breaks a tie when two mesos share the same start_date', () => {
    const mesos = [
      meso({ id: 'target', startDate: '2026-03-01', createdAt: '2026-03-01T00:00:00Z' }),
      meso({ id: 'created-earlier', startDate: '2026-02-01', createdAt: '2026-02-01T00:00:00Z' }),
      meso({ id: 'created-later', startDate: '2026-02-01', createdAt: '2026-02-05T00:00:00Z' }),
    ]
    expect(selectPreviousMeso(mesos, 'target')?.id).toBe('created-later')
  })

  it('returns null when no prior meso exists — the case that hides the copy button', () => {
    expect(selectPreviousMeso([meso({ id: 'only-one' })], 'only-one')).toBeNull()
    expect(selectPreviousMeso([], 'target')).toBeNull()
  })

  it('returns null when the only other mesos present are also excluded by id (defensive: never returns the target itself)', () => {
    const mesos = [meso({ id: 'target', startDate: '2026-01-01' })]
    const result = selectPreviousMeso(mesos, 'target')
    expect(result).toBeNull()
  })
})
