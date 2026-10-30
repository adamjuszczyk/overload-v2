// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import { DEFAULT_SETTINGS, useSettingsStore } from './settingsStore'
import { captureRender } from '../../testing/captureRender'
import { DEFAULT_DELOAD_SETS_RULE } from '../../lib/plannerVocabulary.js'

// TASKS-1.2 chunk 49 — Settings' two new rows ("Drops and stages count as",
// "Log sets in order") and the removal of "New week starts" (SPEC [1.2] Screens
// → Settings), proven where the screen uses them: the REAL SettingsPage over
// the REAL useSettings / useUpdateSettings / settingsService, with only the
// Supabase client replaced by a stateful fake of v2_user_settings. That puts
// the assertions at the database boundary:
//   - what the page SHOWS comes from the stored row (the fixtures store
//     non-default values, so a page that rendered the defaults tells itself apart),
//   - what a tap WRITES is the whole row with the one changed value (a stored row
//     with a non-default value in every column, so a payload built from the
//     defaults tells itself apart),
//   - week_start is never in the payload, so a value stored behind the client's
//     back is still there afterwards.
// The fake writes the way PostgREST's merge-duplicates upsert does: the columns
// the payload names are written and every other column keeps what is stored (a
// first insert takes the column defaults for the rest).

type Row = Record<string, unknown>
const db: { row: Row | null; reads: number; upserts: Array<{ payload: Row; options: unknown }> } = {
  row: null,
  reads: 0,
  upserts: [],
}

// What a first insert gets from the table's defaults for a column its payload
// leaves out (027: week_start default 'copy'). The page's own writes never name it.
const COLUMN_DEFAULTS: Row = { week_start: 'copy' }

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'v2_user_settings') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              db.reads += 1
              return Promise.resolve({ data: db.row, error: null })
            },
          }),
        }),
        upsert: (payload: Row, options: unknown) => {
          db.upserts.push({ payload: structuredClone(payload), options })
          db.row = { ...(db.row ?? COLUMN_DEFAULTS), ...payload }
          return Promise.resolve({ error: null })
        },
      }
    },
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, signOut: vi.fn() }) }))

// SettingsPage's WHAT'S NEW section reads these vite `define` globals, which
// vitest.config.ts doesn't define (the same stub SettingsPage.deloadRules.test uses).
vi.stubGlobal('__BUILD_HASH__', 'test')
vi.stubGlobal('__BUILD_TIME__', '2026-01-01T00:00:00.000Z')
vi.stubGlobal('__APP_VERSION__', '1.2.1')

const { default: SettingsPage } = await import('./SettingsPage')

// A stored row with a NON-default value in every column.
const STORED: Row = {
  user_id: 'u1',
  theme: 'light',
  accent_colour: '#3B82F6',
  rest_timer_enabled: false,
  buzz_on_rest_complete: false,
  target_rest_seconds: 150,
  weight_unit: 'lbs',
  auto_finish_minutes: 20,
  measure_set_time: true,
  week_start: 'empty',
  warmup_display: 'tick',
  deload_rules: { reps: { delta: -2 } },
  stage_volume_rule: 'each',
  log_in_order: false,
}

// What a tap must send for STORED, written out here and not derived from the
// code under test: every column but week_start, the changed value in its place.
function fullRow(changes: Row): Row {
  return {
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
    stage_volume_rule: 'each',
    log_in_order: false,
    ...changes,
  }
}

const LABEL_OF_RULE = { whole: 'WHOLE SET = 1', each: 'EACH DROP = 1', half: 'EACH DROP = ½' } as const
type Rule = keyof typeof LABEL_OF_RULE
const ALL_LABELS = Object.values(LABEL_OF_RULE)

function renderPage() {
  return render(
    // The app's own client: useUpdateSettings reads and writes it directly.
    <QueryClientProvider client={queryClient}>
      {/* WHAT'S NEW's rows navigate (chunk 71), so the page sits in a router. */}
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// The page draws the defaults until the query answers; the tests that read what
// it shows wait for the value they expect, and a stored value that differs from
// the default (STORED's) can only come from the answer.
async function renderWith(row: Row | null) {
  db.row = row
  const rendered = renderPage()
  await waitFor(() => expect(db.reads).toBeGreaterThan(0))
  return rendered
}

const chip = (label: string) => screen.getByRole('button', { name: label })
// The page's only signal of a selected chip: the accent fill.
const selectedChips = () => ALL_LABELS.filter((l) => chip(l).style.backgroundColor === 'var(--accent)')
const lockToggle = () => screen.getByRole('button', { name: 'Log sets in order' })
// The toggle's knob sits at left 24 px when on, 4 px when off.
const lockIsOn = () => (lockToggle().querySelectorAll('span')[1] as HTMLElement).style.left === '24px'
const section = (title: string) => screen.getByText(title).closest('section') as HTMLElement

afterEach(() => {
  cleanup()
  queryClient.clear()
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
  db.row = null
  db.reads = 0
  db.upserts = []
})

describe('the fixtures tell the right source from the wrong one', () => {
  it('STORED differs from the defaults in the two new columns (a page or a payload built from the defaults cannot pass)', () => {
    expect(STORED.stage_volume_rule).not.toBe(DEFAULT_SETTINGS.stageVolumeRule)
    expect(STORED.log_in_order).not.toBe(DEFAULT_SETTINGS.logInOrder)
  })
})

describe('Settings → "Drops and stages count as" shows the stored rule (D)', () => {
  it.each(Object.entries(LABEL_OF_RULE))('a stored %s reads as the %s chip alone', async (rule, label) => {
    await renderWith({ ...STORED, stage_volume_rule: rule })
    await waitFor(() => expect(selectedChips()).toEqual([label]))
  })

  it('the stored rule wins over the default: stored "each" is not shown as the default "half"', async () => {
    await renderWith(STORED)
    await waitFor(() => expect(selectedChips()).toEqual(['EACH DROP = 1']))
  })

  it('with no settings row yet it shows the default, each drop = ½', async () => {
    await renderWith(null)
    expect(selectedChips()).toEqual(['EACH DROP = ½'])
  })
})

describe('Settings → "Log sets in order" shows the stored lock (D)', () => {
  it.each([true, false])('a stored log_in_order of %s draws the toggle that way', async (stored) => {
    await renderWith({ ...STORED, log_in_order: stored })
    await waitFor(() => expect(lockIsOn()).toBe(stored))
  })

  it('the stored lock wins over the default: stored off is not shown as the default on', async () => {
    await renderWith(STORED)
    await waitFor(() => expect(lockIsOn()).toBe(false))
  })

  it('with no settings row yet it shows the default, on', async () => {
    await renderWith(null)
    expect(lockIsOn()).toBe(true)
  })
})

describe('Settings → where the rows are and what they say (D)', () => {
  it('"Drops and stages count as" is in PLANNING with its three chips and the VOLUME-only line (G51)', async () => {
    await renderWith(null)
    const planning = section('PLANNING')
    expect(planning.textContent).toContain('DROPS AND STAGES COUNT AS')
    for (const label of ALL_LABELS) expect(planning.contains(chip(label))).toBe(true)
    expect(planning.textContent).toContain("For Plan's VOLUME sheet. History and Progress count as before.")
  })

  it('"Log sets in order" is a toggle in its own WORKOUT section right after REST TIMER, with its one-line explanation', async () => {
    await renderWith(null)
    const workout = section('WORKOUT')
    expect(workout.contains(lockToggle())).toBe(true)
    expect(workout.textContent).toContain('Off: LOG never asks.')
    expect(workout.previousElementSibling).toBe(section('REST TIMER'))
    expect(workout.nextElementSibling).toBe(section('SET TIMING'))
  })

  it('"New week starts" is gone: no heading, no COPY / EMPTY chips (absence), also for an account that stored "empty"', async () => {
    await renderWith(STORED) // week_start 'empty'
    await waitFor(() => expect(selectedChips()).toEqual(['EACH DROP = 1'])) // the stored row has been drawn
    expect(screen.queryByText(/new week starts/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'COPY' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'EMPTY' })).toBeNull()
  })
})

describe('Settings → changing a row writes the whole row with the new column (W)', () => {
  // Each starts from a stored rule other than the one tapped.
  it.each([
    ['whole', 'each'],
    ['each', 'half'],
    ['half', 'whole'],
  ] as Array<[Rule, Rule]>)('tapping the %s chip (stored: %s) writes that rule and nothing else changes', async (target, stored) => {
    await renderWith({ ...STORED, stage_volume_rule: stored })
    await waitFor(() => expect(selectedChips()).toEqual([LABEL_OF_RULE[stored]]))

    fireEvent.click(chip(LABEL_OF_RULE[target]))

    await waitFor(() => expect(db.upserts).toHaveLength(1))
    expect(db.upserts[0].payload).toEqual(fullRow({ stage_volume_rule: target }))
    expect(db.upserts[0].options).toEqual({ onConflict: 'user_id' })
    await waitFor(() => expect(selectedChips()).toEqual([LABEL_OF_RULE[target]]))
  })

  it.each([
    [false, true],
    [true, false],
  ])('flipping the lock from %s writes log_in_order %s and nothing else changes', async (stored, written) => {
    await renderWith({ ...STORED, log_in_order: stored })
    await waitFor(() => expect(lockIsOn()).toBe(stored))

    fireEvent.click(lockToggle())

    await waitFor(() => expect(db.upserts).toHaveLength(1))
    expect(db.upserts[0].payload).toEqual(fullRow({ log_in_order: written }))
    await waitFor(() => expect(lockIsOn()).toBe(written))
  })

  it('both values persist: after a reload the page reads what was written', async () => {
    // Stored: each drop = 1, lock on. Written: whole set = 1, lock off: neither is the default,
    // so after a reload the page can show them only if the database holds them.
    await renderWith({ ...STORED, stage_volume_rule: 'each', log_in_order: true })
    await waitFor(() => expect(selectedChips()).toEqual(['EACH DROP = 1']))

    fireEvent.click(chip('WHOLE SET = 1'))
    await waitFor(() => expect(db.upserts).toHaveLength(1))
    fireEvent.click(lockToggle())
    await waitFor(() => expect(db.upserts).toHaveLength(2))
    // The second write carries the first one's value: it merges onto the settings the page holds.
    expect(db.upserts[1].payload).toEqual(fullRow({ stage_volume_rule: 'whole', log_in_order: false }))
    expect(db.row).toMatchObject({ stage_volume_rule: 'whole', log_in_order: false })

    // "Reload": nothing cached, nothing in the store, a new render against the same database.
    cleanup()
    queryClient.clear()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS })
    renderPage()
    await waitFor(() => expect(selectedChips()).toEqual(['WHOLE SET = 1']))
    await waitFor(() => expect(lockIsOn()).toBe(false))
  })

  it('the first save, with no row yet, writes the defaults for everything else and the one change', async () => {
    await renderWith(null)

    fireEvent.click(lockToggle())

    await waitFor(() => expect(db.upserts).toHaveLength(1))
    expect(db.upserts[0].payload).toEqual({
      user_id: 'u1',
      theme: 'dark',
      accent_colour: '#FF8C42',
      rest_timer_enabled: true,
      buzz_on_rest_complete: true,
      target_rest_seconds: 120,
      weight_unit: 'kg',
      auto_finish_minutes: 5,
      measure_set_time: false,
      warmup_display: 'rows',
      deload_rules: null,
      stage_volume_rule: 'half',
      log_in_order: false,
    })
  })
})

describe('Settings → the page\'s other writer, the deload rules, sends the whole row too (W)', () => {
  // useUpdateDeloadRules shares upsertSettings, so since chunk 49 its payload carries the two new columns:
  // they must come from the settings the page holds, or a deload rules change would reset them.
  it('a deload rules change carries stage_volume_rule and log_in_order from the stored row, not the defaults', async () => {
    await renderWith(STORED)
    await waitFor(() => expect(selectedChips()).toEqual(['EACH DROP = 1']))

    fireEvent.click(screen.getByLabelText('Sets'))

    await waitFor(() => expect(db.upserts).toHaveLength(1))
    expect(db.upserts[0].payload).toEqual(
      fullRow({ deload_rules: { reps: { delta: -2 }, sets: { ...DEFAULT_DELOAD_SETS_RULE } } }),
    )
  })
})

describe('Settings → week_start is never written (W, absence)', () => {
  it('a value stored behind the client\'s back survives a Settings change', async () => {
    await renderWith({ ...STORED, week_start: 'copy' })
    // Neither stored value is a default: once both are drawn, the page holds the stored row.
    await waitFor(() => expect(selectedChips()).toEqual(['EACH DROP = 1']))
    await waitFor(() => expect(lockIsOn()).toBe(false))

    // Another device stores 'empty' after this page loaded its settings with 'copy'.
    db.row = { ...(db.row as Row), week_start: 'empty' }
    fireEvent.click(chip('WHOLE SET = 1'))

    await waitFor(() => expect(db.upserts).toHaveLength(1))
    expect(db.upserts[0].payload).not.toHaveProperty('week_start')
    // A write that sent the page's own 'copy' would have put it back.
    expect(db.row).toMatchObject({ week_start: 'empty', stage_volume_rule: 'whole' })
  })

  it('a first save leaves week_start to the column default', async () => {
    await renderWith(null)
    fireEvent.click(chip('EACH DROP = 1'))
    await waitFor(() => expect(db.upserts).toHaveLength(1))
    expect(db.upserts[0].payload).not.toHaveProperty('week_start')
    expect(db.row).toMatchObject({ week_start: 'copy' })
  })
})

describe('Settings → 375 px (D)', () => {
  it('no rendered element declares a pixel width wider than 375 with the new rows on screen (declared widths only: jsdom lays nothing out)', async () => {
    const { container } = await renderWith(null)
    // The fixture the real-browser overflow check runs on (`npm run shot -- <fixture> <scratch.png> --width 375`);
    // written only under CAPTURE_RENDER=1.
    captureRender('settings-page', container)

    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(el.style[prop])
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${el.style[prop]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
