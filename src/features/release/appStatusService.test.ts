import { beforeEach, describe, expect, it, vi } from 'vitest'

// Chunk 72 (TASKS.md "Data model (1.2.1)", `v2_app_status`): the one read of the release state. The call is `select *` with `.single()` on the
// table, and the row is mapped to the shape the app uses; a read that fails throws, so the gate has no answer and the app works as usual.
const calls = vi.hoisted(() => ({ from: [] as string[], select: [] as string[], single: 0 }))
const answer = vi.hoisted(() => ({ value: { data: null, error: null } as { data: unknown; error: unknown } }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: string[]) => {
      calls.from.push(args[0])
      return {
        select: (columns: string) => {
          calls.select.push(columns)
          return {
            single: async () => {
              calls.single += 1
              return answer.value
            },
          }
        },
      }
    },
  },
}))

const { fetchAppStatus } = await import('./appStatusService')

beforeEach(() => {
  calls.from.length = 0
  calls.select.length = 0
  calls.single = 0
})

describe('fetchAppStatus', () => {
  it('reads v2_app_status with select * and .single(), and maps the row (maintenance, min_version, exempt_user_ids, updated_at)', async () => {
    answer.value = {
      data: { id: true, maintenance: true, min_version: '1.2.1', exempt_user_ids: ['u-adam', 'u-test'], updated_at: '2026-10-30T20:00:00Z' },
      error: null,
    }
    const status = await fetchAppStatus()
    expect(calls.from).toEqual(['v2_app_status'])
    expect(calls.select).toEqual(['*'])
    expect(calls.single).toBe(1)
    expect(status).toEqual({ maintenance: true, minVersion: '1.2.1', exemptUserIds: ['u-adam', 'u-test'], updatedAt: '2026-10-30T20:00:00Z' })
  })

  it('the seeded row (048): maintenance off, min_version 1.2.1, nobody exempt', async () => {
    answer.value = { data: { id: true, maintenance: false, min_version: '1.2.1', exempt_user_ids: [], updated_at: '2026-10-30T18:00:00Z' }, error: null }
    expect(await fetchAppStatus()).toEqual({ maintenance: false, minVersion: '1.2.1', exemptUserIds: [], updatedAt: '2026-10-30T18:00:00Z' })
  })

  it('only a real true is maintenance, and an exempt list that is not a list is nobody (a row that reads wrongly never locks anyone out)', async () => {
    answer.value = { data: { id: true, maintenance: 'true', min_version: '1.2.1', exempt_user_ids: null, updated_at: 'x' }, error: null }
    const status = await fetchAppStatus()
    expect(status.maintenance).toBe(false)
    expect(status.exemptUserIds).toEqual([])
  })

  it('a refused or failed read throws what it was given, so the caller has no status', async () => {
    const refusal = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
    answer.value = { data: null, error: refusal }
    await expect(fetchAppStatus()).rejects.toBe(refusal)
  })
})
