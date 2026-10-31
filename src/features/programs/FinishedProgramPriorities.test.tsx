// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags'
import { PRIORITY_TREE } from '../../lib/priorityTags'
import { captureRender } from '../../testing/captureRender'
import type { Mesocycle } from '../../types'

// Chunk 76 (SPEC 1.2.1 Screens → Finished program · PRIORITIES, read-only [1]; prototype states Marks (1.1 and later), Old marks (pre-1.1), None set):
// a finished program's priorities, READ-ONLY, replacing chunk 66's editor. The hooks are the real ones (`useProgramPriorities`, Coach's
// `usePriorityContext`, through `fetchProgramPriorities` and `fetchPriorityContext`) over a recording stand-in for the database client, so what is
// asserted is what the screen asks of the tables (the run copy's program id, never the saved program's; the old table only when the copy holds no
// marks, for this run and this user) and that nothing is ever written. The rows are the shape PostgREST returns (snake_case). Each capture is
// written before its assertions (`CAPTURE_RENDER=1` writes `__fixtures__/finished-program-priorities-<state>.html`; `npm run shot` makes the 390 px
// PNG and the text dump under design/1.2.1/built).

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  mesos: [] as unknown[],
  mesosLoading: false,
  mesosError: null as unknown,
  // v2_program_priorities by the program id asked for, v2_coach_meso_tag_priorities by the run id asked for
  own: {} as Record<string, unknown[]>,
  old: {} as Record<string, unknown[]>,
  // tables whose read answers an error; tables whose read never answers
  failing: [] as string[],
  holding: [] as string[],
  reads: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  writes: [] as Array<{ table: string; method: string }>,
}))

vi.mock('./useMesos', () => ({
  useMesos: () => (state.mesosLoading ? { data: undefined, isLoading: true } : state.mesosError ? { data: undefined, isError: true, error: state.mesosError } : { data: state.mesos }),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../lib/supabase', () => {
  // `from` takes spread arguments: `verify-rls-tables.test.mjs` refuses a stand-in that names its table argument
  const from = (...args: unknown[]) => {
    const table = String(args[0])
    const filters: Record<string, unknown> = {}
    const answer = () => {
      state.reads.push({ table, filters: { ...filters } })
      if (state.holding.includes(table)) return new Promise(() => {})
      if (state.failing.includes(table)) return Promise.resolve({ data: null, error: new Error(`${table} unreadable`) })
      const key = String(table === 'v2_program_priorities' ? filters.program_id : filters.mesocycle_id)
      return Promise.resolve({ data: (table === 'v2_program_priorities' ? state.own : state.old)[key] ?? [], error: null })
    }
    const query: Record<string, unknown> = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return query
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => answer().then(resolve, reject),
    }
    for (const method of ['insert', 'upsert', 'update', 'delete']) {
      query[method] = () => {
        state.writes.push({ table, method })
        return query
      }
    }
    return query
  }
  return { supabase: { from } }
})

const { default: FinishedProgramPriorities } = await import('./FinishedProgramPriorities')

const ownRow = (tagType: string, tagValue: string, mark: 'focus' | 'dont_care'): Row => ({ tag_type: tagType, tag_value: tagValue, mark, updated_at: '2026-07-06T09:00:00Z' })
const oldRow = (tagType: string, tagValue: string, priority: 'low' | 'normal' | 'high' | 'top'): Row => ({ tag_type: tagType, tag_value: tagValue, priority, updated_at: '2026-03-02T09:00:00Z' })
const finished = (over: Partial<Mesocycle> & Pick<Mesocycle, 'id' | 'name' | 'programId'>): Mesocycle => ({
  userId: 'user-1',
  status: 'completed',
  startDate: '2026-07-06',
  endDate: '2026-09-13',
  createdAt: '',
  sourceProgramId: 'prog-saved-ppl',
  ...over,
})
// The prototype's three finished programs: Cut PPL (marks on its copy), Strength Block (a run finished before 1.1: old marks only), Push Pull Legs (none)
const CUT = finished({ id: 'meso-cut', name: 'Cut PPL', programId: 'prog-run-cut' })
const OLD = finished({ id: 'meso-old', name: 'Strength Block', programId: 'prog-run-old', startDate: '2026-04-06', endDate: '2026-06-14' })
const BARE = finished({ id: 'meso-bare', name: 'Push Pull Legs', programId: 'prog-run-bare', startDate: '2026-10-05', endDate: '2026-10-11' })
const ACTIVE = finished({ id: 'meso-active', name: 'Running Now', programId: 'prog-run-active', status: 'active', endDate: null })

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
  state.mesos = [CUT, OLD, BARE, ACTIVE]
  state.mesosLoading = false
  state.mesosError = null
  state.own = {
    'prog-run-cut': [ownRow('muscle_group', 'chest', 'focus'), ownRow('muscle_group', 'back', 'focus'), ownRow('muscle_group', 'calves', 'dont_care')],
    // the saved program's marks, which the planner may have changed since the run started: a screen that reads them says quads
    'prog-saved-ppl': [ownRow('muscle_group', 'quads', 'focus')],
  }
  state.old = {
    // four levels: quads top and calves low are marks, chest high is not
    'meso-old': [oldRow('muscle_group', 'quads', 'top'), oldRow('muscle_group', 'chest', 'high'), oldRow('muscle_group', 'calves', 'low')],
  }
  state.failing = []
  state.holding = []
  state.reads = []
  state.writes = []
})
afterEach(() => cleanup())

function Where() {
  return <div data-testid="where">AT {useLocation().pathname}</div>
}
function renderAt(id: string, extra?: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/program/finished/${id}`, `/program/finished/${id}/priorities`]} initialIndex={1}>
        <Routes>
          <Route path="/program/finished/:mesocycleId/priorities" element={<><FinishedProgramPriorities />{extra}</>} />
          <Route path="*" element={<><Where />{extra}</>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const group = (name: string) => document.querySelector<HTMLElement>(`[data-group="${name}"]`)!
// a group's subgroup row (drawn only while the group is unfolded)
const sub = (groupName: string, subgroup: string) => group(groupName).querySelector<HTMLElement>(`[data-subgroup="${subgroup}"]`)
const toggle = (groupName: string) => within(group(groupName)).getAllByRole('button')[0]
const labelsOf = (name: string) => Array.from(group(name).querySelectorAll('span')).map((s) => s.textContent).filter((t) => t === 'FOCUS' || t === "DON'T CARE")
const markedGroups = () => MUSCLE_GROUPS.filter((g) => labelsOf(g).length > 0).map((g) => `${g}:${labelsOf(g)}`)
const settled = () => screen.findByRole('heading', { level: 1 })
const listed = async () => {
  await waitFor(() => expect(document.querySelectorAll('[data-group]').length).toBeGreaterThan(0))
}

describe('Marks (1.1 and later): a finished program whose copy holds marks', () => {
  it('PRIORITIES under the program\'s name, the back arrow, and all twelve groups with the mark each one carries; an unmarked group shows just its name', async () => {
    const { container } = renderAt('meso-cut')
    await listed()
    captureRender('finished-program-priorities-marks', container)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PRIORITIES')
    expect(screen.getByText('CUT PPL')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to the finished program' })).toBeTruthy()
    expect(Array.from(document.querySelectorAll('[data-group]')).map((el) => el.getAttribute('data-group'))).toEqual([...MUSCLE_GROUPS])
    for (const g of MUSCLE_GROUPS) expect(within(group(g)).getByText(MUSCLE_GROUP_LABELS[g])).toBeTruthy()
    expect(markedGroups()).toEqual(['chest:FOCUS', 'back:FOCUS', "calves:DON'T CARE"])
    expect(screen.queryByText('No priorities were set for this program.')).toBeNull()
  })

  it('a tap on a group unfolds its subgroups and a second tap folds them; a subgroup shows a mark only for one of its own, and the group says what it is without', async () => {
    state.own['prog-run-cut'] = [ownRow('muscle_group', 'chest', 'focus'), ownRow('muscle_subgroup', 'upper_chest', 'dont_care'), ownRow('muscle_subgroup', 'lats', 'focus')]
    renderAt('meso-cut')
    await listed()
    const subRows = (g: string) => Array.from(group(g).querySelectorAll('[data-subgroup]')).map((el) => el.getAttribute('data-subgroup'))
    expect(subRows('chest')).toEqual([]) // folded: no subgroup is listed
    expect(toggle('chest').getAttribute('aria-expanded')).toBe('false')
    expect(within(group('chest')).getByText('CHEST WITHOUT UPPER CHEST')).toBeTruthy() // the group's own summary, folded or not

    fireEvent.click(toggle('chest'))
    fireEvent.click(toggle('back'))
    // ours: the state the prototype's DEMO doesn't draw until a tap (two groups unfolded, a subgroup with a mark of its own in each), for the picture
    captureRender('finished-program-priorities-unfolded', document.body)
    fireEvent.click(toggle('back'))
    expect(toggle('chest').getAttribute('aria-expanded')).toBe('true')
    expect(subRows('chest')).toEqual([...PRIORITY_TREE.chest]) // every subgroup of the group, in the planner's order
    expect(sub('chest', 'upper_chest')!.textContent).toBe(`${MUSCLE_SUBGROUP_LABELS.upper_chest}DON'T CARE`) // its own mark
    expect(sub('chest', 'mid_chest')!.textContent).toBe(MUSCLE_SUBGROUP_LABELS.mid_chest) // inherits the group's FOCUS and shows nothing
    expect(subRows('back')).toEqual([]) // another group stays folded

    fireEvent.click(toggle('back'))
    expect(sub('back', 'lats')!.textContent).toBe(`${MUSCLE_SUBGROUP_LABELS.lats}FOCUS`)
    fireEvent.click(toggle('chest'))
    expect(toggle('chest').getAttribute('aria-expanded')).toBe('false')
    expect(subRows('chest')).toEqual([])
  })

  it('it reads the marks of the run\'s own copy, never the saved program\'s (which says quads here), and does not ask the old table when the copy has marks', async () => {
    renderAt('meso-cut')
    await listed()
    expect(state.reads.filter((r) => r.table === 'v2_program_priorities').map((r) => r.filters)).toEqual([{ program_id: 'prog-run-cut' }])
    expect(state.reads.some((r) => r.table === 'v2_coach_meso_tag_priorities')).toBe(false)
    expect(group('quads').textContent).not.toMatch(/FOCUS/)
  })

  it('marks in both tables: the copy\'s own are shown, not the old table\'s', async () => {
    state.old['meso-cut'] = [oldRow('muscle_group', 'hamstrings', 'top')]
    renderAt('meso-cut')
    await listed()
    expect(markedGroups()).toEqual(['chest:FOCUS', 'back:FOCUS', "calves:DON'T CARE"])
  })
})

describe('Old marks (pre-1.1): a run finished before 1.1 shows its old marks through migration 033\'s mapping', () => {
  it('top is FOCUS, low is DON\'T CARE, high shows nothing: the same screen as any other finished program', async () => {
    const { container } = renderAt('meso-old')
    await listed()
    captureRender('finished-program-priorities-old-marks', container)

    expect(screen.getByText('STRENGTH BLOCK')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PRIORITIES')
    expect(markedGroups()).toEqual(['quads:FOCUS', "calves:DON'T CARE"])
    expect(labelsOf('chest')).toEqual([]) // the "high" level
    expect(screen.queryByText('No priorities were set for this program.')).toBeNull()
  })

  it('it asks the old table about this run, for this user, once the copy has answered with no marks, and the copy\'s own id first', async () => {
    renderAt('meso-old')
    await listed()
    expect(state.reads.map((r) => `${r.table} ${JSON.stringify(r.filters)}`)).toEqual([
      'v2_program_priorities {"program_id":"prog-run-old"}',
      'v2_coach_meso_tag_priorities {"user_id":"user-1","mesocycle_id":"meso-old"}',
    ])
  })

  it('each level on its own, on a group and on a subgroup: top → FOCUS, low → DON\'T CARE, high and normal → nothing', async () => {
    const shown = async (rows: Row[]) => {
      state.old['meso-old'] = rows
      const view = renderAt('meso-old')
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
      const text = document.body.textContent ?? ''
      const out = { empty: text.includes('No priorities were set for this program.'), marks: document.querySelector('[data-group]') ? markedGroups() : [] }
      view.unmount()
      return out
    }
    expect(await shown([oldRow('muscle_group', 'back', 'top')])).toEqual({ empty: false, marks: ['back:FOCUS'] })
    expect(await shown([oldRow('muscle_group', 'back', 'low')])).toEqual({ empty: false, marks: ["back:DON'T CARE"] })
    expect(await shown([oldRow('muscle_group', 'back', 'high')])).toEqual({ empty: true, marks: [] })
    expect(await shown([oldRow('muscle_group', 'back', 'normal')])).toEqual({ empty: true, marks: [] })

    state.old['meso-old'] = [oldRow('muscle_subgroup', 'lats', 'top'), oldRow('muscle_subgroup', 'traps', 'low'), oldRow('muscle_subgroup', 'mid_back', 'high')]
    renderAt('meso-old')
    await listed()
    fireEvent.click(toggle('back'))
    expect(sub('back', 'lats')!.textContent).toBe(`${MUSCLE_SUBGROUP_LABELS.lats}FOCUS`)
    expect(sub('back', 'traps')!.textContent).toBe(`${MUSCLE_SUBGROUP_LABELS.traps}DON'T CARE`)
    expect(sub('back', 'mid_back')!.textContent).toBe(MUSCLE_SUBGROUP_LABELS.mid_back)
  })

  it('six names are both a group and a subgroup: each keeps its own type (quads the group top, quads the subgroup low)', async () => {
    state.old['meso-old'] = [oldRow('muscle_group', 'quads', 'top'), oldRow('muscle_subgroup', 'quads', 'low')]
    renderAt('meso-old')
    await listed()
    expect(markedGroups()).toEqual(['quads:FOCUS'])
    fireEvent.click(toggle('quads'))
    expect(sub('quads', 'quads')!.textContent).toBe(`${MUSCLE_SUBGROUP_LABELS.quads}DON'T CARE`)
  })
})

describe('None set: a finished program with no priorities', () => {
  it('"No priorities were set for this program." under the same header, and no group', async () => {
    const { container } = renderAt('meso-bare')
    await screen.findByText('No priorities were set for this program.')
    captureRender('finished-program-priorities-none-set', container)

    expect(screen.getByText('PUSH PULL LEGS')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PRIORITIES')
    expect(document.querySelectorAll('[data-group]')).toHaveLength(0)
    // both tables were asked: the copy's, then the old one, which holds nothing either
    expect(state.reads.map((r) => r.table)).toEqual(['v2_program_priorities', 'v2_coach_meso_tag_priorities'])
  })

  it('old marks that are all high or normal map to nothing: the same empty text', async () => {
    state.old['meso-old'] = [oldRow('muscle_group', 'chest', 'high'), oldRow('muscle_group', 'back', 'normal'), oldRow('muscle_subgroup', 'lats', 'high')]
    renderAt('meso-old')
    await screen.findByText('No priorities were set for this program.')
    expect(document.querySelectorAll('[data-group]')).toHaveLength(0)
  })
})

describe('the back arrow and the states', () => {
  function Back() {
    const navigate = useNavigate()
    return <button onClick={() => navigate(-1)}>HISTORY BACK</button>
  }

  it('the back arrow opens the finished program in place of this screen: going back after it does not return here', async () => {
    renderAt('meso-cut', <Back />)
    await listed()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the finished program' }))
    expect(screen.getByTestId('where').textContent).toBe('AT /program/finished/meso-cut')
    fireEvent.click(screen.getByText('HISTORY BACK'))
    expect(screen.getByTestId('where').textContent).toBe('AT /program/finished/meso-cut') // replaced: the entry under it is the finished program's own
  })

  it('a spinner while the marks are read, the old table\'s answer is waited for, and no group, no empty text and no error meanwhile', async () => {
    state.holding = ['v2_program_priorities']
    renderAt('meso-cut')
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(document.querySelectorAll('[data-group]')).toHaveLength(0)
    expect(screen.queryByText('No priorities were set for this program.')).toBeNull()
    cleanup()

    state.holding = ['v2_coach_meso_tag_priorities']
    renderAt('meso-old')
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeTruthy()
    await waitFor(() => expect(state.reads.some((r) => r.table === 'v2_coach_meso_tag_priorities')).toBe(true))
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(screen.queryByText('No priorities were set for this program.')).toBeNull()
  })

  it('a spinner while the programs are read', () => {
    state.mesosLoading = true
    renderAt('meso-cut')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(state.reads).toEqual([])
  })

  it('COULDN\'T LOAD PRIORITIES with the real reason, for each read that fails (the programs, the copy\'s marks, the old table\'s), and nothing else drawn', async () => {
    state.mesosError = new Error('JWT expired')
    renderAt('meso-cut')
    expect(screen.getByText("COULDN'T LOAD PRIORITIES")).toBeTruthy()
    expect(screen.getByText('JWT expired')).toBeTruthy()
    cleanup()

    state.mesosError = null
    state.failing = ['v2_program_priorities']
    renderAt('meso-cut')
    await screen.findByText("COULDN'T LOAD PRIORITIES")
    expect(screen.getByText('v2_program_priorities unreadable')).toBeTruthy()
    expect(document.querySelectorAll('[data-group]')).toHaveLength(0)
    cleanup()

    state.failing = ['v2_coach_meso_tag_priorities']
    renderAt('meso-old')
    await screen.findByText("COULDN'T LOAD PRIORITIES")
    expect(screen.getByText('v2_coach_meso_tag_priorities unreadable')).toBeTruthy()
    expect(screen.queryByText('No priorities were set for this program.')).toBeNull()
    cleanup()

    // the old table is not asked when the copy has marks, so its failing can't show here
    renderAt('meso-cut')
    await listed()
    expect(screen.queryByText("COULDN'T LOAD PRIORITIES")).toBeNull()
  })

  it('a running program, and an id that is no program, are no finished program: "No finished program here", and nothing is read for them', async () => {
    for (const id of ['meso-active', 'meso-nothing']) {
      cleanup()
      state.reads = []
      renderAt(id)
      expect(await screen.findByText('No finished program here')).toBeTruthy()
      expect(screen.queryByText('FOCUS')).toBeNull()
      expect(state.reads).toEqual([])
    }
  })
})

describe('nothing on it writes (SPEC 1.2.1 Rules 7: a LIGHT chunk writes nothing new)', () => {
  // jsdom's `import.meta.url` is not a file URL: the files are found from the running test's own path
  const here = () => dirname(expect.getState().testPath ?? '')
  const screenFile = () => join(here(), 'FinishedProgramPriorities.tsx')
  const plannerStep = () => join(here(), '../planner/StepPriorities.tsx')

  // Every import of a file, as { module, names }, from its syntax tree
  function importsOf(path: string): Array<{ module: string; names: string[] }> {
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX)
    const found: Array<{ module: string; names: string[] }> = []
    file.forEachChild((node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return
      const bindings = node.importClause?.namedBindings
      const names = [node.importClause?.name?.text, ...(bindings && ts.isNamedImports(bindings) ? bindings.elements.map((e) => (e.propertyName ?? e.name).text) : bindings ? [bindings.name.text] : [])]
      found.push({ module: node.moduleSpecifier.text, names: names.filter((n): n is string => n !== undefined) })
    })
    return found
  }
  // What a writer looks like from here: a module that writes, or a name that does
  const WRITING_MODULE = /StepPriorities|priorityService|programPrioritiesService|@tanstack\/react-query|lib\/supabase/
  const WRITING_NAME = /^use(Set|Update|Delete|Remove|Add|Copy|Save|Apply|Create|Mutation)|^(set|update|delete|remove|copy|save|apply|add|create)[A-Z]/
  const writersIn = (path: string) => importsOf(path).flatMap((i) => [...(WRITING_MODULE.test(i.module) ? [`from ${i.module}`] : []), ...i.names.filter((n) => WRITING_NAME.test(n))])

  it('it imports no mutation hook, no writing service and not the planner\'s step; the two reads it makes are the two read hooks and nothing else of theirs', () => {
    expect(writersIn(screenFile())).toEqual([])
    const imports = importsOf(screenFile())
    expect(imports.find((i) => i.module === '../plan/useProgramPriorities')?.names).toEqual(['useProgramPriorities'])
    expect(imports.find((i) => i.module === '../coach/usePriorityContext')?.names).toEqual(['usePriorityContext'])
  })

  it('control: the same scan finds the old editor\'s component (the planner\'s step) writing, so a clean answer above is not a scan that sees nothing', () => {
    const found = writersIn(plannerStep())
    expect(found).toContain('useSetPriorityMark')
  })

  it('no "Priority for …" control and no control with a mark on it is drawn: every button is the back arrow or a group\'s unfold row', async () => {
    renderAt('meso-cut')
    await listed()
    expect(screen.queryAllByLabelText(/^Priority for/)).toEqual([])
    expect(screen.queryAllByRole('group')).toEqual([])
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names).toHaveLength(1 + MUSCLE_GROUPS.length)
    expect(names[0]).toBe('Back to the finished program')
    for (const button of screen.getAllByRole('button').slice(1)) expect(button.hasAttribute('aria-expanded')).toBe(true)
    expect(screen.queryAllByRole('button', { name: /^(FOCUS|DON'T CARE)$/ })).toEqual([])
  })

  it('every tap it takes (each group unfolded and folded, the back arrow) reads and writes nothing more: no insert, upsert, update or delete reaches a table', async () => {
    renderAt('meso-cut')
    await listed()
    const reads = state.reads.length
    for (const g of MUSCLE_GROUPS) {
      fireEvent.click(toggle(g))
      fireEvent.click(toggle(g))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Back to the finished program' }))
    // a write a tap starts lands a few ticks after it (a module imported on demand, a request behind a promise): settle before looking (RULES)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(state.writes).toEqual([])
    expect(state.reads).toHaveLength(reads)
  })
})

describe('375 px, and the words', () => {
  it('an 80-letter program name wraps in the header', async () => {
    const LONG = 'X'.repeat(80)
    state.mesos = [{ ...CUT, name: LONG }]
    const { container } = renderAt('meso-cut')
    await listed()
    captureRender('finished-program-priorities-long-name', container)
    expect(screen.getByText(LONG).style.overflowWrap).toBe('anywhere')
  })

  it('the words meso, mesocycle and run are nowhere on it, in any of its states (C12: "program" everywhere)', async () => {
    for (const id of ['meso-cut', 'meso-old', 'meso-bare', 'meso-active']) {
      cleanup()
      const { container } = renderAt(id)
      await settled()
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
      expect(container.textContent).not.toMatch(/\bmeso(cycle)?s?\b|\brun\b/i)
    }
  })
})
