import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserSettings } from '../../types'

// Migration 042 (TASKS-1.2 chunk 36) adds v2_user_settings.stage_volume_rule
// and log_in_order. Chunk 36 only READ them: fetchSettings maps them with the
// "absent until applied" fallback to the column defaults. Chunk 49 (042 is
// live on staging) WRITES them: upsertSettings names both in its full row, and
// no longer names week_start (SPEC [1.2] removes the "new week starts"
// setting, so a stored value stays as it is).
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

describe('fetchSettings — week_start is read-only since chunk 49', () => {
  // Plan's highlighting (weekDiff.ts, through the settings store) and v2_plan_week
  // (041) still act on the stored value until chunks 54b and 53 replace them, so
  // dropping the read here would change what an account that stored 'empty' sees.
  it('a stored week_start still maps (the setting is gone from Settings, not from the row)', async () => {
    fromMock.mockReturnValue(selectChain(baseRow({ week_start: 'empty' })))
    expect((await fetchSettings('u1'))?.weekStart).toBe('empty')
  })

  it('a row without the key maps to the column default', async () => {
    fromMock.mockReturnValue(selectChain(baseRow()))
    expect((await fetchSettings('u1'))?.weekStart).toBe('copy')
  })
})

describe('DEFAULT_SETTINGS — what a user without a settings row gets', () => {
  it('counts a drop as one half and keeps the log lock on (SPEC [1.2] Settings defaults)', () => {
    expect(DEFAULT_SETTINGS.stageVolumeRule).toBe('half')
    expect(DEFAULT_SETTINGS.logInOrder).toBe(true)
  })
})

describe('upsertSettings — the full row (chunk 49)', () => {
  // Non-default values for every field, so a payload built from the defaults (the
  // wrong source) tells itself apart from one built from these settings.
  const settings: UserSettings = {
    theme: 'light',
    accentColour: '#3B82F6',
    restTimerEnabled: false,
    buzzOnRestComplete: false,
    targetRestSeconds: 150,
    weightUnit: 'lbs',
    autoFinishMinutes: 20,
    measureSetTime: true,
    weekStart: 'empty',
    warmupDisplay: 'tick',
    deloadRules: { reps: { delta: -2 } },
    stageVolumeRule: 'whole',
    logInOrder: false,
  }

  async function payloadFor(s: UserSettings) {
    const chain = upsertChain()
    fromMock.mockReturnValue(chain)
    await upsertSettings('u1', s)
    expect(fromMock).toHaveBeenCalledWith('v2_user_settings')
    const [payload, options] = chain.upsert.mock.calls[0] as unknown as [Record<string, unknown>, unknown]
    return { payload, options }
  }

  it('writes stage_volume_rule and log_in_order with the settings\' own values, not the defaults', async () => {
    const { payload } = await payloadFor(settings)

    expect(payload.stage_volume_rule).toBe('whole')
    expect(payload.log_in_order).toBe(false)
    // …and the defaults are what a wrong source would have sent:
    expect(DEFAULT_SETTINGS.stageVolumeRule).not.toBe('whole')
    expect(DEFAULT_SETTINGS.logInOrder).not.toBe(false)
  })

  it('every value of the check, and both lock positions, reach the payload unchanged', async () => {
    for (const rule of ['whole', 'each', 'half'] as const) {
      for (const logInOrder of [true, false]) {
        const { payload } = await payloadFor({ ...settings, stageVolumeRule: rule, logInOrder })
        expect(payload.stage_volume_rule).toBe(rule)
        expect(payload.log_in_order).toBe(logInOrder)
      }
    }
  })

  it('the payload is the whole row: exactly these columns with exactly these values', async () => {
    const { payload, options } = await payloadFor(settings)

    expect(payload).toEqual({
      user_id: 'u1',
      theme: 'light',
      accent_colour: '#3B82F6',
      rest_timer_enabled: false,
      buzz_on_rest_complete: false,
      target_rest_seconds: 150,
      weight_unit: 'lbs',
      auto_finish_minutes: 20,
      measure_set_time: true,
      warmup_display: 'tick',
      deload_rules: { reps: { delta: -2 } },
      stage_volume_rule: 'whole',
      log_in_order: false,
    })
    expect(options).toEqual({ onConflict: 'user_id' })
  })

  it('the payload has no week_start key, whatever the settings hold (absence: the stored value stays)', async () => {
    for (const weekStart of ['empty', 'copy'] as const) {
      const { payload } = await payloadFor({ ...settings, weekStart })
      expect(payload).not.toHaveProperty('week_start')
      expect(Object.keys(payload)).not.toContain('week_start')
    }
  })

  it('a throw from the database surfaces (the full-row write is not swallowed)', async () => {
    fromMock.mockReturnValue({ upsert: vi.fn(() => Promise.resolve({ error: new Error('boom') })) })
    await expect(upsertSettings('u1', settings)).rejects.toThrow('boom')
  })
})
