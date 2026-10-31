// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import type { Mesocycle } from '../../types'
import { fakePostgrest, type FakePostgrest, type Row } from './fakePostgrest.testutil'

// Chunk 74 — DELETE on YOUR PROGRAMS through the REAL hooks and the REAL service, over a stand-in for the database that behaves as 048 does
// (RULES: "a screen test that must see a write's effect through the real hooks gives QueryClientProvider the app's own queryClient"). The other
// files prove each seam with the next one mocked; this one is the "Done when": a program is deleted through the screen and is gone from YOUR PROGRAMS,
// from START's list, and from the planner's list (the same predicate over the unfiltered read), while the row stays in the table marked
// `deleted_at`; a delete the database refuses leaves the lists as they were.
//
// The stand-in: `from` answers selects and filters as PostgREST does (only the columns a select names; `.is('deleted_at', null)` keeps the unmarked
// rows); `rpc('v2_delete_saved_program', …)` marks the row (`coalesce(deleted_at, now())`), refuses an unknown id `P0002` and a program with an
// active run `OL002`. Only the run list, the hooks of the card and the sheet's schedule check are mocked.

const world = vi.hoisted(() => ({
  fake: null as unknown,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  rpc: vi.fn(),
  // the programs an ACTIVE run in the database started from — what OL002 reads
  activeSources: [] as string[],
  mesos: [] as unknown[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ((world.fake as FakePostgrest).client.from as (t: string) => unknown)(table),
    rpc: (...args: unknown[]) => world.rpc(...args),
  },
}))
vi.mock('../../lib/muscleGroup', () => ({ toMuscleGroup: (v: unknown) => v }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('./useMesos', () => ({
  useMesos: () => ({ data: world.mesos }),
  useStartRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteMeso: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('./useProgramHasSchedule', () => ({ useProgramHasSchedule: () => true }))
vi.mock('../plan/useProgramPriorities', () => ({ useProgramPriorities: () => ({ data: [] }) }))
vi.mock('../plan/useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: null, failed: false, error: null }) }))
vi.mock('../plan/useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('../../hooks/useToday', () => ({ useToday: () => '2026-10-14' }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

const { default: ProgramsTab } = await import('./ProgramsTab')
const { fetchPrograms, isListedSavedProgram } = await import('./programService')

const DELETED_AT = '2026-10-30T20:15:00+00:00'

function programRow(id: string, name: string, over: Row = {}): Row {
  return {
    id,
    user_id: 'user-1',
    name,
    schedule: { monday: 'wd-a', tuesday: null, wednesday: 'wd-b', thursday: null, friday: 'wd-c', saturday: null, sunday: null },
    created_at: `2026-01-0${id.length % 9 + 1}T00:00:00Z`,
    updated_at: '2026-01-01T00:00:00Z',
    kind: 'saved',
    planning_type: 'stable',
    schedule_type: 'weekday',
    deleted_at: null,
    ...over,
  }
}

const ACTIVE: Mesocycle = { id: 'meso-active', userId: 'user-1', name: 'Push Pull Legs', programId: 'prog-run', sourceProgramId: 'prog-ppl', status: 'active', startDate: '2026-10-05', endDate: null, createdAt: '2026-10-05T08:00:00Z' }

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  world.tables = {
    v2_programs: [
      programRow('prog-ppl', 'Push Pull Legs'),
      programRow('prog-ul', 'Upper / Lower'),
      programRow('prog-fb', 'Full Body 3x'),
      programRow('prog-old', 'Old Block', { deleted_at: DELETED_AT }), // deleted before this screen opened
      programRow('prog-run', 'Push Pull Legs', { kind: 'run' }),
    ],
  }
  world.fake = fakePostgrest(world.tables)
  world.activeSources = ['prog-ppl']
  world.mesos = [ACTIVE]
  world.rpc.mockReset()
  world.rpc.mockImplementation(async (name: string, args: { p_program_id: string }) => {
    expect(name).toBe('v2_delete_saved_program')
    const row = world.tables.v2_programs.find((r) => r.id === args.p_program_id)
    if (!row) return { data: null, error: { code: 'P0002', message: `program not found: ${args.p_program_id}` } }
    if (world.activeSources.includes(args.p_program_id)) return { data: null, error: { code: 'OL002', message: 'a program with a running program cannot be deleted: finish it first' } }
    row.deleted_at = row.deleted_at ?? DELETED_AT
    return { data: null, error: null }
  })
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})

const fake = () => world.fake as FakePostgrest
const ui = () => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/plan']}>
      <ProgramsTab onTab={() => undefined} />
    </MemoryRouter>
  </QueryClientProvider>
)
const rowOf = (id: string) => document.querySelector(`[data-program="${id}"]`) as HTMLElement | null
const deleteButtonOf = (id: string) => within(rowOf(id)!).getByText('DELETE').closest('button') as HTMLButtonElement
const panelOf = (title: string) => screen.getByText(title).parentElement as HTMLElement
const confirmButton = (title: string) => within(panelOf(title)).getByRole('button', { name: /^DELET/ }) as HTMLButtonElement

describe('a program deleted through the screen leaves every list, and the row stays marked', () => {
  it('the world is what the tests say it is: YOUR PROGRAMS lists the three programs that are still there, not the deleted one and not the run\'s copy', async () => {
    render(ui())

    await screen.findByText('Upper / Lower')

    expect(Array.from(document.querySelectorAll('[data-program]')).map((el) => el.getAttribute('data-program')).sort()).toEqual(['prog-fb', 'prog-ppl', 'prog-ul'])
    expect(screen.queryByText('Old Block')).toBeNull()
  })

  it('DELETE → the confirm → DELETE: one rpc with that row\'s id; the row leaves YOUR PROGRAMS before the dialog goes; the table still holds it, marked; START and the planner offer it no more', async () => {
    render(ui())
    await screen.findByText('Upper / Lower')

    fireEvent.click(deleteButtonOf('prog-ul'))
    fireEvent.click(confirmButton('Delete Upper / Lower?'))

    await waitFor(() => expect(screen.queryByText('Delete Upper / Lower?')).toBeNull())
    expect(world.rpc).toHaveBeenCalledTimes(1)
    expect(world.rpc).toHaveBeenCalledWith('v2_delete_saved_program', { p_program_id: 'prog-ul' })
    // gone from YOUR PROGRAMS (the lists were read again before the dialog closed)
    expect(rowOf('prog-ul')).toBeNull()
    expect(screen.queryByText('Upper / Lower')).toBeNull()
    expect(rowOf('prog-ppl')).toBeTruthy()
    expect(rowOf('prog-fb')).toBeTruthy()
    // the row stays: marked, never removed
    const stored = world.tables.v2_programs.find((r) => r.id === 'prog-ul')
    expect(stored).toBeTruthy()
    expect(stored?.deleted_at).toBe(DELETED_AT)
    expect(world.tables.v2_programs).toHaveLength(5)

    // START's list on this tab: the sheet gets the list the tab drew
    fireEvent.click(within(rowOf('prog-fb')!).getByText('START'))
    expect(screen.getByRole('radio', { name: 'Full Body 3x' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Upper / Lower' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Old Block' })).toBeNull()

    // the planner's START sheet: the unfiltered read through the same predicate gives the same programs
    const planner = (await fetchPrograms()).filter(isListedSavedProgram).map((p) => p.id).sort()
    expect(planner).toEqual(['prog-fb', 'prog-ppl'])
    // ... while the unfiltered read itself still holds the deleted rows, marked (the planner's route refuses them, CHANGE THE PROGRAM names them)
    const all = await fetchPrograms()
    expect(all.find((p) => p.id === 'prog-ul')?.deletedAt).toBe(DELETED_AT)
    expect(all.find((p) => p.id === 'prog-old')?.deletedAt).toBe(DELETED_AT)
  })

  it('the last saved program, deleted with nothing running and nothing finished, leaves "No programs yet"', async () => {
    world.tables.v2_programs = [programRow('prog-only', 'Only One')]
    world.fake = fakePostgrest(world.tables)
    world.mesos = []
    world.activeSources = []
    render(ui())
    await screen.findByText('Only One')

    fireEvent.click(deleteButtonOf('prog-only'))
    fireEvent.click(confirmButton('Delete Only One?'))

    expect(await screen.findByText('No programs yet')).toBeTruthy()
    expect(world.tables.v2_programs[0].deleted_at).toBe(DELETED_AT)
  })

  it('a delete the database refuses (OL002: a run started from it on another phone) says why inside the confirm; nothing is marked, the row stays and no list is read again', async () => {
    world.activeSources = ['prog-ppl', 'prog-fb'] // the database knows a run this phone's list doesn't
    render(ui())
    await screen.findByText('Full Body 3x')
    const readsBefore = fake().to('v2_programs').length

    fireEvent.click(deleteButtonOf('prog-fb'))
    fireEvent.click(confirmButton('Delete Full Body 3x?'))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Couldn't delete Full Body 3x.")).toBeTruthy()
    expect(within(alert).getByText('a program with a running program cannot be deleted: finish it first')).toBeTruthy()
    expect(screen.getByText('Delete Full Body 3x?')).toBeTruthy()
    expect(rowOf('prog-fb')).toBeTruthy()
    expect(world.tables.v2_programs.find((r) => r.id === 'prog-fb')?.deleted_at).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake().to('v2_programs')).toHaveLength(readsBefore)
  })

  it('deleting the same program twice (two phones) is the database\'s idempotent no-op: the first mark is kept', async () => {
    render(ui())
    await screen.findByText('Upper / Lower')
    world.tables.v2_programs.find((r) => r.id === 'prog-ul')!.deleted_at = '2026-10-29T08:00:00+00:00' // marked by another phone a moment ago

    fireEvent.click(deleteButtonOf('prog-ul'))
    fireEvent.click(confirmButton('Delete Upper / Lower?'))

    await waitFor(() => expect(screen.queryByText('Delete Upper / Lower?')).toBeNull())
    expect(world.tables.v2_programs.find((r) => r.id === 'prog-ul')?.deleted_at).toBe('2026-10-29T08:00:00+00:00')
    expect(rowOf('prog-ul')).toBeNull()
  })
})
