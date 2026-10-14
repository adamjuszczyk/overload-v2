import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserSettings } from '../../types'

// Migration 042 (TASKS-1.2 chunk 36) adds v2_user_settings.stage_volume_rule
// and log_in_order. This chunk only READS them: fetchSettings maps them with
// the "absent until applied" fallback to the column defaults, and
// upsertSettings does not send them (chunk 49 does, after 042 is live on
// staging) — a full-row upsert that named them now would overwrite whatever
// is stored with this build's defaults.
//
// Mocked the same way the other service tests are (the real Supabase client
// throws at import time without env vars): the chain this module builds is
// inspected instead of a round trip.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { fetchSettings, upsertSettings } = await import('./settingsService')
const { DEFAULT_SETTINGS } = await import('./settingsStore')

// A v2_user_settings row as the database returned it before 042: none of the
// columns 003 / 005 / 027 / 042 add may be assumed present.
function baseRow(extra: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    theme: 'dark',
    accent_colour: '#FF8C42',
    rest_timer_enabled: true,
    buzz_on_rest_complete: true,
    target_rest_seconds: 120,
    weight_unit: 'kg',
    auto_finish_minutes: 5,
    ...extra,
  }
}

function selectChain(row: unknown) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })),
  }
  return chain
}

function upsertChain() {
  const upsert = vi.fn(() => Promise.resolve({ error: null }))
  return { upsert }
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('fetchSettings — the two 042 columns', () => {
  it('a row without the new keys (042 not applied yet) maps to the column defaults: each drop = ½, log in order on', async () => {
    fromMock.mockReturnValue(selectChain(baseRow()))

    const settings = await fetchSettings('u1')

    expect(fromMock).toHaveBeenCalledWith('v2_user_settings')
    expect(settings?.stageVolumeRule).toBe('half')
    expect(settings?.logInOrder).toBe(true)
  })

  it('a row that holds non-default values maps them (the stored value wins over the default)', async () => {
    fromMock.mockReturnValue(selectChain(baseRow({ stage_volume_rule: 'each', log_in_order: false })))

    const settings = await fetchSettings('u1')

    expect(settings?.stageVolumeRule).toBe('each')
    expect(settings?.logInOrder).toBe(false)
  })

  it('every value of the check maps through unchanged', async () => {
    for (const rule of ['whole', 'each', 'half'] as const) {
      fromMock.mockReturnValue(selectChain(baseRow({ stage_volume_rule: rule, log_in_order: true })))
      expect((await fetchSettings('u1'))?.stageVolumeRule).toBe(rule)
    }
  })

  it('no row at all is still null (the store falls back to DEFAULT_SETTINGS)', async () => {
    fromMock.mockReturnValue(selectChain(null))
    expect(await fetchSettings('u1')).toBeNull()
  })
})

describe('DEFAULT_SETTINGS — what a user without a settings row gets', () => {
  it('counts a drop as one half and keeps the log lock on (SPEC [1.2] Settings defaults)', () => {
    expect(DEFAULT_SETTINGS.stageVolumeRule).toBe('half')
    expect(DEFAULT_SETTINGS.logInOrder).toBe(true)
  })
})

describe('upsertSettings — does not send the 042 columns yet', () => {
  // Non-default values on purpose: if the payload named the keys at all, this
  // build would write 'whole' / false over the stored values.
  const settings: UserSettings = {
    ...DEFAULT_SETTINGS,
    stageVolumeRule: 'whole',
    logInOrder: false,
  }

  it('the payload carries neither stage_volume_rule nor log_in_order (absence)', async () => {
    const chain = upsertChain()
    fromMock.mockReturnValue(chain)

    await upsertSettings('u1', settings)

    expect(fromMock).toHaveBeenCalledWith('v2_user_settings')
    const [payload, options] = chain.upsert.mock.calls[0] as unknown as [Record<string, unknown>, unknown]
    expect(payload).not.toHaveProperty('stage_volume_rule')
    expect(payload).not.toHaveProperty('log_in_order')
    expect(options).toEqual({ onConflict: 'user_id' })
  })

  it('the payload is exactly the columns it sent before 042 (no key added by this chunk)', async () => {
    const chain = upsertChain()
    fromMock.mockReturnValue(chain)

    await upsertSettings('u1', settings)

    const [payload] = chain.upsert.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(Object.keys(payload).sort()).toEqual(
      [
        'accent_colour',
        'auto_finish_minutes',
        'buzz_on_rest_complete',
        'deload_rules',
        'measure_set_time',
        'rest_timer_enabled',
        'target_rest_seconds',
        'theme',
        'user_id',
        'warmup_display',
        'week_start',
        'weight_unit',
      ],
    )
  })

  it('a throw from the database surfaces (the full-row write is not swallowed)', async () => {
    fromMock.mockReturnValue({ upsert: vi.fn(() => Promise.resolve({ error: new Error('boom') })) })
    await expect(upsertSettings('u1', settings)).rejects.toThrow('boom')
  })
})
