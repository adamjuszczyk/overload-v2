import { describe, it, expect, vi } from 'vitest'
import { planCurationApply, runCurationSteps } from './curationApply'
import type { CurationDecision } from '../../types'

describe('planCurationApply', () => {
  it('routes add/update/expire decisions into their own buckets', () => {
    const decisions: CurationDecision[] = [
      { op: 'add', body: 'new entry', reason: 'genuinely new' },
      { op: 'update', id: 'mem-1', body: 'revised entry', reason: 'corrected' },
      { op: 'expire', id: 'mem-2', reason: 'no longer true' },
    ]
    const plan = planCurationApply(decisions, new Set(['mem-1', 'mem-2']))

    expect(plan.toInsert).toEqual([{ body: 'new entry', reason: 'genuinely new' }])
    expect(plan.toUpdate).toEqual([{ id: 'mem-1', body: 'revised entry', reason: 'corrected' }])
    expect(plan.toExpire).toEqual([{ id: 'mem-2', reason: 'no longer true' }])
    expect(plan.rejectedIds).toEqual([])
  })

  it('drops an update/expire referencing an id never sent to the model, and records it as rejected', () => {
    const decisions: CurationDecision[] = [
      { op: 'update', id: 'hallucinated-id', body: 'anything', reason: 'anything' },
      { op: 'expire', id: 'also-hallucinated', reason: 'anything' },
      { op: 'update', id: 'mem-1', body: 'real update', reason: 'real' },
    ]
    const plan = planCurationApply(decisions, new Set(['mem-1']))

    expect(plan.toUpdate).toEqual([{ id: 'mem-1', body: 'real update', reason: 'real' }])
    expect(plan.toExpire).toEqual([])
    expect(plan.rejectedIds).toEqual(['hallucinated-id', 'also-hallucinated'])
  })

  it('never invents an id — an update/expire against an empty valid set is entirely rejected', () => {
    const decisions: CurationDecision[] = [
      { op: 'update', id: 'mem-1', body: 'x', reason: 'x' },
      { op: 'expire', id: 'mem-2', reason: 'x' },
    ]
    const plan = planCurationApply(decisions, new Set())

    expect(plan.toUpdate).toEqual([])
    expect(plan.toExpire).toEqual([])
    expect(plan.rejectedIds).toEqual(['mem-1', 'mem-2'])
  })

  it('drops an add with an empty or whitespace-only body without rejecting anything (no id to reject)', () => {
    const decisions: CurationDecision[] = [
      { op: 'add', body: '   ', reason: 'x' },
      { op: 'add', body: '', reason: 'x' },
    ]
    const plan = planCurationApply(decisions, new Set())

    expect(plan.toInsert).toEqual([])
    expect(plan.rejectedIds).toEqual([])
  })

  it('drops an update that would blank a real entry, treating it as a no-op rather than erasing the body', () => {
    const decisions: CurationDecision[] = [{ op: 'update', id: 'mem-1', body: '   ', reason: 'x' }]
    const plan = planCurationApply(decisions, new Set(['mem-1']))

    expect(plan.toUpdate).toEqual([])
    expect(plan.rejectedIds).toEqual([])
  })

  it('trims body whitespace on both add and update', () => {
    const decisions: CurationDecision[] = [
      { op: 'add', body: '  new  ', reason: 'x' },
      { op: 'update', id: 'mem-1', body: '  revised  ', reason: 'x' },
    ]
    const plan = planCurationApply(decisions, new Set(['mem-1']))

    expect(plan.toInsert[0].body).toBe('new')
    expect(plan.toUpdate[0].body).toBe('revised')
  })

  it('returns empty buckets for an empty decision list — curation is allowed to decide nothing changed', () => {
    const plan = planCurationApply([], new Set(['mem-1']))
    expect(plan).toEqual({ toInsert: [], toUpdate: [], toExpire: [], rejectedIds: [] })
  })

  it('dedupes two update decisions for the same id, keeping only the LAST one — matches the real write order, never reports an overwritten body as a live change', () => {
    const decisions: CurationDecision[] = [
      { op: 'update', id: 'mem-1', body: 'Version A', reason: 'first note' },
      { op: 'update', id: 'mem-1', body: 'Version B', reason: 'second note, same fact' },
    ]
    const plan = planCurationApply(decisions, new Set(['mem-1']))

    expect(plan.toUpdate).toEqual([{ id: 'mem-1', body: 'Version B', reason: 'second note, same fact' }])
  })

  it('dedupes two expire decisions for the same id down to one', () => {
    const decisions: CurationDecision[] = [
      { op: 'expire', id: 'mem-1', reason: 'first reason' },
      { op: 'expire', id: 'mem-1', reason: 'second reason' },
    ]
    const plan = planCurationApply(decisions, new Set(['mem-1']))

    expect(plan.toExpire).toEqual([{ id: 'mem-1', reason: 'second reason' }])
  })

  it('dedupes repeated hallucinated ids in rejectedIds', () => {
    const decisions: CurationDecision[] = [
      { op: 'update', id: 'ghost', body: 'x', reason: 'x' },
      { op: 'expire', id: 'ghost', reason: 'x' },
    ]
    const plan = planCurationApply(decisions, new Set())

    expect(plan.rejectedIds).toEqual(['ghost'])
  })

  it('still applies both an update AND an expire for the same id — they touch disjoint fields, so this is not a duplicate to collapse', () => {
    const decisions: CurationDecision[] = [
      { op: 'update', id: 'mem-1', body: 'revised body', reason: 'correction' },
      { op: 'expire', id: 'mem-1', reason: 'no longer true' },
    ]
    const plan = planCurationApply(decisions, new Set(['mem-1']))

    expect(plan.toUpdate).toEqual([{ id: 'mem-1', body: 'revised body', reason: 'correction' }])
    expect(plan.toExpire).toEqual([{ id: 'mem-1', reason: 'no longer true' }])
  })
})

describe('runCurationSteps', () => {
  it('runs every step in order and returns null when all succeed', async () => {
    const order: number[] = []
    const result = await runCurationSteps([
      async () => { order.push(1) },
      async () => { order.push(2) },
      async () => { order.push(3) },
    ])

    expect(result).toBeNull()
    expect(order).toEqual([1, 2, 3])
  })

  it('stops at the first failing step and never invokes the ones after it (§5.3 steps 8-10 ordering)', async () => {
    const stampNotes = vi.fn(async () => {})
    const insertRunRow = vi.fn(async () => {})
    const boom = new Error('memory write failed')

    const result = await runCurationSteps([
      async () => { throw boom },
      stampNotes,
      insertRunRow,
    ])

    expect(result).toEqual({ completed: 0, error: boom })
    expect(stampNotes).not.toHaveBeenCalled()
    expect(insertRunRow).not.toHaveBeenCalled()
  })

  it('reports the correct completed count when a later step fails — earlier steps still ran, later ones did not', async () => {
    const applyMemory = vi.fn(async () => {})
    const stampNotes = vi.fn(async () => {})
    const insertRunRow = vi.fn(async () => {
      throw new Error('run row insert failed')
    })

    const result = await runCurationSteps([applyMemory, stampNotes, insertRunRow])

    expect(applyMemory).toHaveBeenCalledTimes(1)
    expect(stampNotes).toHaveBeenCalledTimes(1)
    expect(result?.completed).toBe(2)
    expect((result?.error as Error).message).toBe('run row insert failed')
  })
})
