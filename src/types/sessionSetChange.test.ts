import { describe, it, expect } from 'vitest'
import type { SessionSetChange, SessionSetChangeType, SessionSetChangeRecord } from './index'

// Migration 042 (TASKS-1.2 chunk 36): v2_session_set_changes refuses a row that
// means nothing (its checks name which key and which fields each kind may
// carry); this union refuses to build the same rows (Adam's data-model review,
// 3a: "so the impossible rows can't be built"). The compile-time half runs in
// `npm run typecheck`, which type-checks test files too: an `@ts-expect-error`
// on a line that compiles is itself an error, so loosening the union fails it.

describe('SessionSetChange — one variant per kind, each with only the fields its row may have', () => {
  it('builds each valid variant, and the stored form adds the row\'s own fields', () => {
    const deleted: SessionSetChange = { kind: 'deleted', weekPlanSetId: 'w1' }
    const toWarmup: SessionSetChange = { kind: 'retyped', weekPlanSetId: 'w1', type: { kind: 'warmup' } }
    const toDropset: SessionSetChange = {
      kind: 'retyped', weekPlanSetId: 'w1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 2 },
    }
    const toNormal: SessionSetChange = { kind: 'retyped', weekPlanSetId: 'w1', type: { kind: 'normal' } }
    const pending: SessionSetChange = { kind: 'pending_stages', setLogId: 'l1', stageKind: 'rest_pause', stageCount: 1 }
    expect([deleted, toWarmup, toDropset, toNormal, pending].map((c) => c.kind)).toEqual([
      'deleted', 'retyped', 'retyped', 'retyped', 'pending_stages',
    ])

    const stored: SessionSetChangeRecord = {
      ...deleted, id: 'c1', userId: 'u1', sessionId: 's1', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
    }
    expect(stored.kind === 'deleted' && stored.weekPlanSetId).toBe('w1')
  })

  it('refuses the impossible rows at compile time', () => {
    // @ts-expect-error a deleted change names a planned set, not a set log
    const a: SessionSetChange = { kind: 'deleted', setLogId: 'l1' }
    // @ts-expect-error a deleted change carries no type
    const b: SessionSetChange = { kind: 'deleted', weekPlanSetId: 'w1', type: { kind: 'warmup' } }
    // @ts-expect-error a pending_stages change names a set log, not a planned set
    const c: SessionSetChange = { kind: 'pending_stages', weekPlanSetId: 'w1', stageKind: 'dropset', stageCount: 1 }
    // @ts-expect-error a pending_stages change needs its stage kind and count
    const d: SessionSetChange = { kind: 'pending_stages', setLogId: 'l1' }
    // @ts-expect-error a warmup is never staged
    const e: SessionSetChangeType = { kind: 'warmup', stageKind: 'dropset', stageCount: 1 }
    // @ts-expect-error a staged type needs its count
    const f: SessionSetChangeType = { kind: 'staged', stageKind: 'dropset' }
    // @ts-expect-error a stage kind outside the check's four
    const g: SessionSetChangeType = { kind: 'staged', stageKind: 'bogus', stageCount: 1 }
    // @ts-expect-error a kind outside the check's three
    const h: SessionSetChange = { kind: 'other', weekPlanSetId: 'w1' }
    expect([a, b, c, d, e, f, g, h]).toHaveLength(8)
  })
})
