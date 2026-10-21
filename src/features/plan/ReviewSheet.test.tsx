// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { USER, makeWorld, plan, planId, setId, type World } from './reviewWorld.testutil'

// Chunk 56 (TASKS-1.2 "REVIEW", Verification, screen tests): the line and the sheet over the seed-shaped week, through the real hooks, the
// real service, the fake PostgREST and a stand-in for 043's `v2_apply_ops` (`reviewWorld.testutil.ts`). The service's own requests are
// `reviewService.test.ts`'s; here: what the screen lists, what each button sends, what happens to the item, pending, error, and the line.

const h = vi.hoisted(() => ({ client: null as unknown as World['client'] }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => (h.client.from as (...a: unknown[]) => unknown)(...args), rpc: (...args: unknown[]) => (h.client.rpc as (...a: unknown[]) => unknown)(...args) },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-test' } }) }))

const { queryClient } = await import('../../lib/queryClient')
const { default: ReviewSheet } = await import('./ReviewSheet')
const { default: ReviewLine } = await import('./ReviewLine')

const PROGRAM = { mesoId: 'meso', programId: 'prog', planningType: 'week_dependent', scheduleType: 'weekday', currentWeek: 3 } as const
const WORKOUTS = [{ id: 'wd-ua', name: 'Upper A' }, { id: 'wd-la', name: 'Lower A' }, { id: 'wd-ub', name: 'Upper B' }]
const lastWeek = () => [plan('ua', 2), plan('la', 2), plan('ub', 2)]
const thisWeek = () => [plan('ua', 3), plan('la', 3), plan('ub', 3)]
const base = () => ({ weekNumber: 3, thisWeek: thisWeek(), lastWeek: lastWeek(), workouts: WORKOUTS })

let world: World
const wrap = (ui: ReactElement) => <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
const openSheet = (over: Partial<Parameters<typeof ReviewSheet>[0]> = {}) =>
  render(wrap(<ReviewSheet unit="week" fromWeek={3} program={PROGRAM} onClose={() => {}} {...base()} {...over} />))
const item = (key: string) => document.querySelector(`[data-review-item="${key}"]`) as HTMLElement
const KEYS = {
  bench2: `num:s-ua:${setId(2, 'pe-bench', 2)}`,
  bench3: `num:s-ua:${setId(2, 'pe-bench', 3)}`,
  row3: `skipped:s-ua:${setId(2, 'pe-row', 3)}`,
  lat1: `type:s-ua:${setId(2, 'pe-lat', 1)}`,
  push: 'added-set:s-ua:e-push:3',
}
const press = (key: string, name: RegExp | string) => fireEvent.click(within(item(key)).getByRole('button', { name }))
const eyebrow = () => screen.getByRole('dialog').textContent ?? ''
const sets = (planKey: string, pe: string) => world.tables.v2_week_plan_sets.filter((s) => s.week_plan_id === planKey && s.program_exercise_id === pe)

beforeEach(() => {
  world = makeWorld()
  h.client = world.client
  queryClient.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } })
})
afterEach(() => {
  cleanup()
  queryClient.clear()
  onlineManager.setOnline(true)
})

describe('the sheet (board 4)', () => {
  it('lists the five differences of the seed week under MON · UPPER A, in the board’s words, and nothing from Wednesday or the skipped Friday (G52)', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    expect(eyebrow()).toContain('LAST WEEK · 5 THINGS')
    expect(screen.getByText('What went differently')).toBeTruthy()
    expect(screen.getByText('Where last week went differently from its plan. Take it over or leave it.')).toBeTruthy()
    expect(document.querySelectorAll('[data-review-group]')).toHaveLength(1)
    expect([...document.querySelectorAll('[data-review-item]')].map((n) => n.getAttribute('data-review-item'))).toEqual(Object.values(KEYS))
    const bench = within(item(KEYS.bench2))
    expect(bench.getByText('BARBELL BENCH PRESS · SET 02')).toBeTruthy()
    expect(bench.getByText('Did 82.5 kg × 7')).toBeTruthy()
    expect(bench.getByText('planned 80 kg × 6–8 · RIR 2')).toBeTruthy()
    expect(bench.getByRole('button', { name: 'USE 82.5 × 7' })).toBeTruthy()
    expect(within(item(KEYS.bench3)).getByRole('button', { name: 'USE 80 × 9' })).toBeTruthy()
    expect(within(item(KEYS.row3)).getByText('Skipped')).toBeTruthy()
    expect(within(item(KEYS.row3)).getByRole('button', { name: 'REMOVE THIS SET' })).toBeTruthy()
    expect(within(item(KEYS.lat1)).getByText('You made set 01 a dropset')).toBeTruthy()
    expect(within(item(KEYS.push)).getByRole('button', { name: 'ADD THIS SET' })).toBeTruthy()
    for (const key of Object.values(KEYS)) expect(within(item(key)).getByRole('button', { name: 'IGNORE' })).toBeTruthy()
  })

  it('a last week that is still running lists only its done sessions: Upper A in progress gives nothing, Lower A and Upper B none either', async () => {
    world = makeWorld({ ua: 'in_progress' })
    h.client = world.client
    openSheet()
    await screen.findByText('Nothing left to decide.')
    expect(document.querySelectorAll('[data-review-item]')).toHaveLength(0)
    expect(eyebrow()).toContain('LAST WEEK · 0 THINGS')
  })

  it('a sequence run says cycle', async () => {
    openSheet({ unit: 'cycle' })
    await screen.findByText('MON · UPPER A')
    expect(eyebrow()).toContain('LAST CYCLE · 5 THINGS')
    expect(screen.getByText('Where last cycle went differently from its plan. Take it over or leave it.')).toBeTruthy()
  })

  it('shows the page’s spinner while the reads are out and the real reason when one failed', async () => {
    world.fake.failWith('v2_sessions', 'permission denied for table v2_sessions')
    openSheet()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't load last week.")
    expect(alert.textContent).toContain('permission denied for table v2_sessions')
    cleanup()
    queryClient.clear()
    world = makeWorld()
    h.client = world.client
    openSheet()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    await screen.findByText('MON · UPPER A')
  })
})

describe('W: each button writes what the board says and the item is gone for good', () => {
  it('USE on the bench weight item: this week’s set 2 takes 82.5 × 7, one request holds the decision, the line counts 4', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    press(KEYS.bench2, 'USE 82.5 × 7')
    await waitFor(() => expect(item(KEYS.bench2)).toBeNull())
    expect(world.sent).toHaveLength(1)
    expect(world.sent[0].map((o) => `${o.op}:${o.table}`)).toEqual(['update:v2_week_plan_sets', 'insert:v2_week_review_decisions'])
    const set = world.tables.v2_week_plan_sets.find((s) => s.id === setId(3, 'pe-bench', 2))!
    expect([set.target_weight, set.rep_min, set.rep_max]).toEqual([82.5, 7, 7])
    expect(world.tables.v2_week_review_decisions).toMatchObject([{ week_plan_id: planId('ua', 3), item_key: KEYS.bench2, decision: 'used', user_id: USER }])
    expect(eyebrow()).toContain('LAST WEEK · 4 THINGS')
    expect(document.querySelectorAll('[data-review-item]')).toHaveLength(4)
  })

  it('IGNORE on the reps item sends the decision alone (ignored) and the plan is as it was', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    const before = structuredClone(world.tables.v2_week_plan_sets)
    press(KEYS.bench3, 'IGNORE')
    await waitFor(() => expect(item(KEYS.bench3)).toBeNull())
    expect(world.sent[0].map((o) => `${o.op}:${o.table}`)).toEqual(['insert:v2_week_review_decisions'])
    expect(world.tables.v2_week_review_decisions).toMatchObject([{ item_key: KEYS.bench3, decision: 'ignored' }])
    expect(world.tables.v2_week_plan_sets).toEqual(before)
    expect(eyebrow()).toContain('LAST WEEK · 4 THINGS')
  })

  it('ADD THIS SET appends a third pushdown set with 20 kg × 15 to this week’s Upper A', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    press(KEYS.push, 'ADD THIS SET')
    await waitFor(() => expect(item(KEYS.push)).toBeNull())
    const mine = sets(planId('ua', 3), 'pe-push').sort((a, b) => Number(a.set_number) - Number(b.set_number))
    expect(mine.map((s) => [s.set_number, s.target_weight, s.rep_min])).toEqual([[1, 30, 10], [2, 30, 10], [3, 20, 15]])
    expect(sets(planId('ua', 2), 'pe-push')).toHaveLength(2)
  })

  it('"You made set 01 a dropset" USE makes this week’s lateral raise set 1 a dropset with one drop', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    press(KEYS.lat1, 'USE')
    await waitFor(() => expect(item(KEYS.lat1)).toBeNull())
    const head = world.tables.v2_week_plan_sets.find((s) => s.id === setId(3, 'pe-lat', 1))!
    expect(head.stage_kind).toBe('dropset')
    expect(world.tables.v2_week_plan_sets.filter((s) => s.parent_week_plan_set_id === head.id)).toHaveLength(1)
    expect(sets(planId('ua', 2), 'pe-lat').filter((s) => s.stage_kind !== null)).toHaveLength(0)
  })

  it('"Skipped" REMOVE THIS SET removes this week’s set 3 of the row; its IGNORE keeps it', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    press(KEYS.row3, 'REMOVE THIS SET')
    await waitFor(() => expect(item(KEYS.row3)).toBeNull())
    expect(sets(planId('ua', 3), 'pe-row').map((s) => s.set_number)).toEqual([1, 2])
    cleanup()
    queryClient.clear()
    world = makeWorld()
    h.client = world.client
    openSheet()
    await screen.findByText('MON · UPPER A')
    press(KEYS.row3, 'IGNORE')
    await waitFor(() => expect(item(KEYS.row3)).toBeNull())
    expect(sets(planId('ua', 3), 'pe-row')).toHaveLength(3)
  })

  it('with every item decided the sheet says so, and a decided item does not come back when the sheet is opened again', async () => {
    const { unmount } = openSheet()
    await screen.findByText('MON · UPPER A')
    for (const key of Object.values(KEYS)) {
      press(key, 'IGNORE')
      await waitFor(() => expect(item(key)).toBeNull())
    }
    await screen.findByText('Nothing left to decide.')
    expect(world.tables.v2_week_review_decisions).toHaveLength(5)
    unmount()
    queryClient.clear()
    openSheet()
    await screen.findByText('Nothing left to decide.')
    expect(document.querySelectorAll('[data-review-item]')).toHaveLength(0)
  })
})

describe('W: pending and error, per item', () => {
  it('while a request is out the pressed button says what it is doing, every button is off, and a second press sends nothing', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    const release = world.holdNext()
    const useButton = within(item(KEYS.bench2)).getByRole('button', { name: 'USE 82.5 × 7' })
    await act(async () => {
      fireEvent.click(useButton)
      fireEvent.click(useButton)
      fireEvent.click(within(item(KEYS.push)).getByRole('button', { name: 'ADD THIS SET' }))
    })
    expect(world.sent).toHaveLength(1)
    expect(within(item(KEYS.bench2)).getByRole('button', { name: 'USING…' })).toBeTruthy()
    for (const b of screen.getAllByRole('button').filter((n) => ['IGNORE', 'ADD THIS SET', 'REMOVE THIS SET', 'USE', 'USING…'].some((t) => n.textContent === t || n.textContent?.startsWith('USE ')))) {
      expect((b as HTMLButtonElement).disabled).toBe(true)
    }
    release()
    await waitFor(() => expect(item(KEYS.bench2)).toBeNull())
    expect(world.sent).toHaveLength(1)
    expect(within(item(KEYS.push)).getByRole('button', { name: 'ADD THIS SET' })).toBeTruthy()
    expect((within(item(KEYS.push)).getByRole('button', { name: 'ADD THIS SET' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('the pending words follow the action: IGNORING…, ADDING…, REMOVING…', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    for (const [key, name, pending] of [[KEYS.bench3, 'IGNORE', 'IGNORING…'], [KEYS.push, 'ADD THIS SET', 'ADDING…'], [KEYS.row3, 'REMOVE THIS SET', 'REMOVING…']] as const) {
      const release = world.holdNext()
      press(key, name)
      await waitFor(() => expect(within(item(key)).getByRole('button', { name: pending })).toBeTruthy())
      release()
      await waitFor(() => expect(item(key)).toBeNull())
    }
  })

  it('a refused request keeps its item, says so with the real reason under it, and the next press goes through', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    world.refuseNext({ code: '23514', message: 'new row for relation "v2_week_plan_sets" violates check constraint "v2_week_plan_sets_rep_min_check"' })
    press(KEYS.bench2, 'USE 82.5 × 7')
    const alert = await within(item(KEYS.bench2)).findByRole('alert')
    expect(alert.textContent).toContain("Couldn't take this over.")
    expect(alert.textContent).toContain('violates check constraint "v2_week_plan_sets_rep_min_check"')
    expect(item(KEYS.bench2)).not.toBeNull()
    expect(world.tables.v2_week_review_decisions).toEqual([])
    expect(world.tables.v2_week_plan_sets.find((s) => s.id === setId(3, 'pe-bench', 2))!.target_weight).toBe(80)
    expect((within(item(KEYS.bench2)).getByRole('button', { name: 'USE 82.5 × 7' }) as HTMLButtonElement).disabled).toBe(false)
    const release = world.holdNext()
    press(KEYS.bench2, 'USE 82.5 × 7')
    await waitFor(() => expect(within(item(KEYS.bench2)).getByRole('button', { name: 'USING…' })).toBeTruthy())
    expect(within(item(KEYS.bench2)).queryByRole('alert')).toBeNull() // the old error is gone while it is sent again
    release()
    await waitFor(() => expect(item(KEYS.bench2)).toBeNull())
  })

  it('a write goes out while the phone is offline too (networkMode always): it fails with the network’s own words instead of waiting for a connection that may not come', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    onlineManager.setOnline(false)
    world.refuseNext({ code: '', message: 'Failed to fetch' })
    press(KEYS.bench3, 'IGNORE')
    const alert = await within(item(KEYS.bench3)).findByRole('alert')
    expect(alert.textContent).toContain('Failed to fetch')
    expect(world.sent).toHaveLength(1)
  })

  it('a refused IGNORE has its own headline, and the other items show no error', async () => {
    openSheet()
    await screen.findByText('MON · UPPER A')
    world.refuseNext({ code: '08006', message: 'connection lost' })
    press(KEYS.bench3, 'IGNORE')
    const alert = await within(item(KEYS.bench3)).findByRole('alert')
    expect(alert.textContent).toContain("Couldn't ignore this.")
    expect(alert.textContent).toContain('connection lost')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('the line (board 1)', () => {
  const line = (over: Partial<Parameters<typeof ReviewLine>[0]> = {}) => render(wrap(<ReviewLine unit="week" onOpen={() => {}} {...base()} {...over} />))
  const lineText = () => (document.querySelector('[data-review-line]') as HTMLElement | null)?.textContent ?? null

  it('says "LAST WEEK · 5 things went differently · REVIEW →" for the seed week, and opens the sheet when pressed', async () => {
    const onOpen = vi.fn()
    line({ onOpen })
    expect(lineText()).toBeNull() // while the reads are out there is no line
    await waitFor(() => expect(lineText()).toBe('LAST WEEK5 things went differentlyREVIEW →'))
    fireEvent.click(document.querySelector('[data-review-line]')!)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('P1.2-3: exactly one thing left reads "1 thing went differently"; with none left there is no line', async () => {
    for (const key of Object.values(KEYS).slice(0, 4)) world.tables.v2_week_review_decisions.push({ id: `d-${key}`, user_id: USER, week_plan_id: planId('ua', 3), item_key: key, decision: 'ignored', created_at: '' })
    const { unmount } = line()
    await waitFor(() => expect(lineText()).toContain('1 thing went differently'))
    expect(lineText()).not.toContain('1 things')
    unmount()
    queryClient.clear()
    world.tables.v2_week_review_decisions.push({ id: 'd-last', user_id: USER, week_plan_id: planId('ua', 3), item_key: KEYS.push, decision: 'used', created_at: '' })
    line()
    await waitFor(() => expect(world.fake.to('v2_week_review_decisions').length).toBeGreaterThan(1))
    await act(async () => {})
    expect(lineText()).toBeNull()
  })

  it('is read again whenever the done list is (a finish, a skip, a reopen, a move of a session), since it sits under that key', async () => {
    line()
    await waitFor(() => expect(lineText()).toContain('5 things'))
    const asked = world.fake.to('v2_sessions').length
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2_doneWeekPlanIds'] })
    })
    expect(world.fake.to('v2_sessions').length).toBeGreaterThan(asked)
  })

  it('a sequence run says LAST CYCLE', async () => {
    line({ unit: 'cycle' })
    await waitFor(() => expect(lineText()).toBe('LAST CYCLE5 things went differentlyREVIEW →'))
  })

  it('a done session this week is locked: with its plan row left out of this week’s rows (Plan does that), its items are not offered', async () => {
    line({ thisWeek: [plan('la', 3), plan('ub', 3)] })
    await act(async () => {})
    await waitFor(() => expect(world.fake.to('v2_sessions').length).toBeGreaterThan(0))
    await act(async () => {})
    expect(lineText()).toBeNull()
  })

  it('draws no line, and reads nothing, for a week with no plan rows last week (a missed week, DECISIONS 131)', async () => {
    line({ lastWeek: [] })
    await act(async () => {})
    expect(lineText()).toBeNull()
    expect(world.fake.requests).toHaveLength(0)
  })

  it('draws no line when a read failed (the sheet is where errors are told, per item)', async () => {
    world.fake.failWith('v2_week_review_decisions', 'boom')
    line()
    await waitFor(() => expect(world.fake.to('v2_week_review_decisions').length).toBeGreaterThan(0))
    await act(async () => {})
    expect(lineText()).toBeNull()
  })
})
