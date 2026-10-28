// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MuscleGroup, Mesocycle } from '../../types'
import type { StoredMark } from '../../lib/priorityMarks'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags'
import type { MuscleSubgroupTag } from '../../lib/exerciseTags'
import { PRIORITY_TREE } from '../../lib/priorityTags'
import { captureRender } from '../../testing/captureRender'

// Chunk 28 (SPEC.md Programs and runs [P1.1]: "Priorities are a property of
// the program. They're set in the planner when the program is built, and
// copied to a run when it starts. They can't be changed during a run. Plan
// shows them view-only."; Plan screen [P1.1]: "Priorities are shown
// view-only"). PrioritiesEditor is the screen behind Plan's PRIORITIES link,
// on the active run's own program copy: it must show the marks that are set
// as read-only labels and offer no way to change them.
//
// Every rule here is proven at the screen (the real component rendered over
// mocked data hooks), and the "must be absent" ones assert the absence on a
// run where the thing WOULD otherwise appear (Checks that lied #32): marks
// stored at group level, at subgroup level under a marked group, and at
// subgroup level under an unmarked group.
//
// Also kept from chunk 10's review fix: the 375px proof. jsdom computes no
// real CSS layout (no scrollWidth to assert against), so that one is
// mechanical — every element's own inline style, not a rendered pixel
// measurement — see the last test below.

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: '2026-01-01', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

// What the run's program copy has stored (v2_program_priorities rows). Read
// by the mocked hook at render time, so each test sets it before rendering.
let rows: StoredMark[] = []
// Every programId the screen asked priorities for.
const readProgramIds: Array<string | null> = []
// The two reads' states (chunk 65: board 12's PRIORITIES frames): what the run list and the marks answer, set per test.
type Read = { data: unknown; isLoading: boolean; isError: boolean; error?: unknown }
const reads: { mesos: Read | null; rows: Read | null } = { mesos: null, rows: null }

const mutateMock = vi.fn()
const useSetPriorityMarkMock = vi.fn(() => ({ mutate: mutateMock, isPending: false }))

vi.mock('../programs/useMesos', () => ({
  useMesos: () => reads.mesos ?? { data: [activeMeso], isLoading: false, isError: false },
}))

vi.mock('./useProgramPriorities', () => ({
  useProgramPriorities: (programId: string | null) => {
    readProgramIds.push(programId)
    return reads.rows ?? { data: rows, isLoading: false, isError: false }
  },
  // The write hook the screen must NOT use any more (chunk 28). Spied so the
  // test sees a call to the hook itself, not only to its mutate function.
  useSetPriorityMark: () => useSetPriorityMarkMock(),
}))

const { default: PrioritiesEditor } = await import('./PrioritiesEditor')

afterEach(() => {
  cleanup()
  rows = []
  reads.mesos = null
  reads.rows = null
  readProgramIds.length = 0
  mutateMock.mockReset()
  useSetPriorityMarkMock.mockClear()
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/plan/priorities']}>
      <PrioritiesEditor />
    </MemoryRouter>,
  )
}

function stored(tagType: StoredMark['tagType'], tagValue: string, mark: StoredMark['mark']): StoredMark {
  return { tagType, tagValue, mark, updatedAt: '2026-01-01T00:00:00Z' }
}

// Chest is FOCUS but its upper chest is DON'T CARE (the SPEC example, "chest
// without upper chest"); back is DON'T CARE; shoulders has no mark of its own
// but its side delt is FOCUS. Four marks in all. Every other group and
// subgroup (and mid/lower chest, which merely inherit chest's FOCUS) has none.
const MARKED_RUN: StoredMark[] = [
  stored('muscle_group', 'chest', 'focus'),
  stored('muscle_subgroup', 'upper_chest', 'dont_care'),
  stored('muscle_group', 'back', 'dont_care'),
  stored('muscle_subgroup', 'side_delt', 'focus'),
]

// The page's 12 group toggles, in screen order (the first button is the back
// arrow). They are the only interactive things on a view-only screen.
function groupToggles(): HTMLElement[] {
  return screen.getAllByRole('button').slice(1)
}

// A group's whole card: its toggle button's parent.
function groupCard(group: MuscleGroup): HTMLElement {
  const toggle = screen.getByText(MUSCLE_GROUP_LABELS[group]).closest('button')
  expect(toggle).not.toBeNull()
  return toggle!.parentElement as HTMLElement
}

// A subgroup's row: the element its name sits in (only rendered while its
// group is unfolded). Used only for subgroups whose label differs from every
// group's label, so the name finds exactly one element.
function subgroupRow(subgroup: MuscleSubgroupTag): HTMLElement {
  return screen.getByText(MUSCLE_SUBGROUP_LABELS[subgroup]).parentElement as HTMLElement
}

function unfoldAll() {
  for (const toggle of groupToggles()) fireEvent.click(toggle)
}

const MARK_TEXT = /^(FOCUS|DON'T CARE)$/

describe('PrioritiesEditor — view-only in Plan (chunk 28)', () => {
  it("reads the marks of the active run's own program copy", () => {
    rows = MARKED_RUN
    renderEditor()
    expect(readProgramIds.length).toBeGreaterThan(0)
    expect(new Set(readProgramIds)).toEqual(new Set([activeMeso.programId]))
  })

  it("shows a group's mark as a read-only label on the group's row", () => {
    rows = MARKED_RUN
    renderEditor()
    expect(within(groupCard('chest')).getByText('FOCUS')).toBeTruthy()
    expect(within(groupCard('back')).getByText("DON'T CARE")).toBeTruthy()
  })

  it("shows a subgroup's own mark on its row once its group is unfolded (under a marked group and under an unmarked one)", () => {
    rows = MARKED_RUN
    renderEditor()
    // Folded: no subgroup row, so no subgroup label yet.
    expect(screen.queryByText(MUSCLE_SUBGROUP_LABELS.upper_chest)).toBeNull()
    expect(screen.queryByText(MUSCLE_SUBGROUP_LABELS.side_delt)).toBeNull()

    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.chest))
    expect(within(subgroupRow('upper_chest')).getByText("DON'T CARE")).toBeTruthy()

    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.shoulders))
    expect(within(subgroupRow('side_delt')).getByText('FOCUS')).toBeTruthy()
  })

  it('shows each mark that is set exactly once, and nothing else is labelled (4 marks stored, 4 labels, with every group unfolded)', () => {
    rows = MARKED_RUN
    renderEditor()
    unfoldAll()
    const labels = screen.getAllByText(MARK_TEXT).map((el) => el.textContent)
    expect([...labels].sort()).toEqual(["DON'T CARE", "DON'T CARE", 'FOCUS', 'FOCUS'])
  })

  it('a group or subgroup with no mark shows its name and nothing else: no label, chip or placeholder (absence)', () => {
    rows = MARKED_RUN
    renderEditor()
    // Unmarked groups, folded.
    expect(groupCard('triceps').textContent).toBe(MUSCLE_GROUP_LABELS.triceps)
    expect(groupCard('quads').textContent).toBe(MUSCLE_GROUP_LABELS.quads)
    // A group with only a subgroup mark has none of its own, and no summary.
    expect(groupCard('shoulders').textContent).toBe(MUSCLE_GROUP_LABELS.shoulders)

    unfoldAll()
    // Subgroups of a FOCUS group that carry no mark of their own: they inherit
    // it (SPEC), but nothing is stored on them, so nothing is shown on them.
    expect(subgroupRow('mid_chest').textContent).toBe(MUSCLE_SUBGROUP_LABELS.mid_chest)
    expect(subgroupRow('lower_chest').textContent).toBe(MUSCLE_SUBGROUP_LABELS.lower_chest)
    // Under a DON'T CARE group, all four.
    for (const sub of PRIORITY_TREE.back) {
      expect(subgroupRow(sub).textContent).toBe(MUSCLE_SUBGROUP_LABELS[sub])
    }
    // Under the group that has none of its own, beside the marked side delt.
    expect(subgroupRow('front_delt').textContent).toBe(MUSCLE_SUBGROUP_LABELS.front_delt)
    expect(subgroupRow('rear_delt').textContent).toBe(MUSCLE_SUBGROUP_LABELS.rear_delt)
    // No "inherited" caption anywhere (it was the old editor's).
    expect(screen.queryByText(/INHERITED/i)).toBeNull()
  })

  it('a run with no marks at all shows only the names (not a single label, chip or placeholder), even with every group unfolded', () => {
    rows = []
    const { container } = renderEditor()
    unfoldAll()
    expect(screen.queryAllByText(MARK_TEXT)).toEqual([])
    // The whole list's text is exactly the 12 group names, each followed by
    // its subgroups' names — nothing else (no "NORMAL", "NONE", "—", "NOT SET").
    const list = container.querySelector('.hide-scrollbar') as HTMLElement
    const names = MUSCLE_GROUPS.map(
      (g) => MUSCLE_GROUP_LABELS[g] + PRIORITY_TREE[g].map((s) => MUSCLE_SUBGROUP_LABELS[s]).join(''),
    ).join('')
    expect(list.textContent).toBe(names)
  })

  it('still shows the "X without Y" summary under a group whose subgroup differs from it', () => {
    rows = MARKED_RUN
    renderEditor()
    expect(within(groupCard('chest')).getByText('CHEST WITHOUT UPPER CHEST')).toBeTruthy()
    // Not repeated for a group with no exception.
    expect(within(groupCard('back')).queryByText(/WITHOUT/)).toBeNull()
  })

  it('tapping a group unfolds it to its subgroups, and tapping it again folds it', () => {
    rows = MARKED_RUN
    renderEditor()
    expect(screen.queryByText(MUSCLE_SUBGROUP_LABELS.mid_chest)).toBeNull()

    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.chest))
    for (const subgroup of PRIORITY_TREE.chest) {
      expect(screen.getByText(MUSCLE_SUBGROUP_LABELS[subgroup])).toBeTruthy()
    }
    // Other groups stay folded.
    expect(screen.queryByText(MUSCLE_SUBGROUP_LABELS.lats)).toBeNull()

    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.chest))
    expect(screen.queryByText(MUSCLE_SUBGROUP_LABELS.mid_chest)).toBeNull()
  })

  it('has no FOCUS / DON\'T CARE control anywhere, folded or unfolded: the only buttons are the back arrow and the 12 group toggles (absence)', () => {
    rows = MARKED_RUN
    const { container } = renderEditor()

    const assertNoMarkControl = () => {
      expect(screen.queryAllByRole('button', { name: 'FOCUS' })).toEqual([])
      expect(screen.queryAllByRole('button', { name: "DON'T CARE" })).toEqual([])
      expect(screen.getAllByRole('button')).toHaveLength(1 + MUSCLE_GROUPS.length)
      expect(container.querySelectorAll('input, select, textarea, [role="switch"], [role="checkbox"], [role="radio"]')).toHaveLength(0)
    }

    assertNoMarkControl()
    unfoldAll()
    assertNoMarkControl()
  })

  it('never writes a mark: the write hook is not used, and tapping every label and group changes nothing stored', () => {
    rows = MARKED_RUN
    renderEditor()
    unfoldAll()
    // Tap every subgroup name of one group, then every mark label (the group
    // ones sit inside the group's row, which just folds and unfolds).
    for (const sub of PRIORITY_TREE.chest) fireEvent.click(screen.getByText(MUSCLE_SUBGROUP_LABELS[sub]))
    for (const label of screen.getAllByText(MARK_TEXT)) fireEvent.click(label)
    unfoldAll()

    expect(useSetPriorityMarkMock).not.toHaveBeenCalled()
    expect(mutateMock).not.toHaveBeenCalled()
  })

  // Static companion to the tests above: the screen doesn't even import
  // the pieces that write a mark (the write hook, the chip row, the service
  // behind them), so a write can't be wired back in without this failing —
  // whether or not a render ever reaches it. Reads the import statements
  // only (comments may name these freely); the positive control proves the
  // scan really sees this file's imports.
  it('does not import the mark-writing hook, the chip row or the write service (static)', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PrioritiesEditor.tsx'), 'utf8')
    const importStatements = (source.match(/^import[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []).join('\n')
    expect(importStatements).toMatch(/useProgramPriorities/)
    expect(importStatements).not.toMatch(/useSetPriorityMark|MarkSelector|programPrioritiesService/)
  })
})

// Chunk 65 (TASKS-1.2 "The PROGRAMS tab": boards PR5 and 12's PRIORITIES states; SPEC Errors (15)). The header the boards draw, and the three
// states board 12 draws for this screen: a spinner while it loads, "COULDN'T LOAD PRIORITIES" with the real reason under it (the board's
// "Check your connection and try again." is for every error, and the Errors rule replaces it), and "No current program".
describe('PrioritiesEditor — the header and board 12\'s three states (chunk 65)', () => {
  it('the header: a back arrow named "Back to Programs", the run\'s name in capitals over PRIORITIES', () => {
    rows = MARKED_RUN
    renderEditor()

    const back = screen.getByRole('button', { name: 'Back to Programs' })
    const caption = screen.getByText('TEST MESO')
    const title = screen.getByRole('heading', { name: 'PRIORITIES' })
    expect(back.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(caption.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // the 44 px square the boards draw (a 36 px one was the old header's)
    expect(back.style.width).toBe('44px')
    expect(back.style.height).toBe('44px')
  })

  it('loading: the spinner (its ring written one side at a time), no groups, no error and no "no program" line', () => {
    reads.mesos = { data: undefined, isLoading: true, isError: false }
    const { container } = renderEditor()

    const spinner = screen.getByRole('status', { name: 'Loading' })
    expect(spinner.style.borderTopColor).toBe('var(--accent)')
    expect(spinner.style.borderLeftColor).toBe('var(--border-strong)')
    expect(screen.queryByText(MUSCLE_GROUP_LABELS.chest)).toBeNull()
    expect(screen.queryByText("COULDN'T LOAD PRIORITIES")).toBeNull()
    expect(screen.queryByText('No current program')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('the marks still loading is loading too', () => {
    reads.rows = { data: undefined, isLoading: true, isError: false }
    renderEditor()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(screen.queryByText(MUSCLE_GROUP_LABELS.chest)).toBeNull()
  })

  it.each([
    ['the run list', () => { reads.mesos = { data: undefined, isLoading: false, isError: true, error: { message: 'JWT expired' } } }, 'JWT expired'],
    ['the marks', () => { reads.rows = { data: undefined, isLoading: false, isError: true, error: { message: 'permission denied for table v2_program_priorities' } } }, 'permission denied for table v2_program_priorities'],
    ['either, with an Error object', () => { reads.rows = { data: undefined, isLoading: false, isError: true, error: new Error('Failed to fetch') } }, 'Failed to fetch'],
  ])('%s failed: "COULDN\'T LOAD PRIORITIES" and the REAL reason under it, never the fixed "Check your connection" line', (_name, fail, reason) => {
    fail()
    renderEditor()

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText("COULDN'T LOAD PRIORITIES")).toBeTruthy()
    expect(within(alert).getByText(reason)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Check your connection')
    expect(screen.queryByRole('status')).toBeNull() // not an endless spinner
    expect(screen.queryByText(MUSCLE_GROUP_LABELS.chest)).toBeNull()
    // a read that failed is not "no program running": an empty answer and a failed one differ
    expect(screen.queryByText('No current program')).toBeNull()
  })

  it('an error with no message says "Something went wrong." (P1.2-5), and "You may be offline." only when the phone is', () => {
    reads.rows = { data: undefined, isLoading: false, isError: true, error: {} }
    renderEditor()
    expect(within(screen.getByRole('alert')).getByText('Something went wrong.')).toBeTruthy()
    cleanup()

    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    reads.rows = { data: undefined, isLoading: false, isError: true, error: {} }
    renderEditor()
    expect(within(screen.getByRole('alert')).getByText('You may be offline.')).toBeTruthy()
    online.mockRestore()
  })

  it('no program running: "No current program" under a header of the title alone (no run name over it), and no groups', () => {
    reads.mesos = { data: [], isLoading: false, isError: false }
    reads.rows = { data: undefined, isLoading: false, isError: false }
    renderEditor()

    expect(screen.getByText('No current program')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'PRIORITIES' })).toBeTruthy()
    expect(screen.queryByText('TEST MESO')).toBeNull()
    expect(screen.queryByText(MUSCLE_GROUP_LABELS.chest)).toBeNull()
    expect(screen.queryByText(/NO ACTIVE MESOCYCLE/i)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // the marks of a run that isn't there are never asked for
    expect(new Set(readProgramIds)).toEqual(new Set([null]))
  })

  it('the back arrow goes to PROGRAMS (/program: Plan opened on that tab), whether or not there is history to pop, and does not keep this screen in the history', () => {
    rows = MARKED_RUN
    render(
      <MemoryRouter initialEntries={['/plan', '/plan/priorities']} initialIndex={1}>
        <PrioritiesEditor />
        <Where />
        <GoBack />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back to Programs' }))
    expect(screen.getByTestId('where').textContent).toBe('/program')
    // it replaced this screen's entry: one step back in the history is where it came from, not this screen again
    fireEvent.click(screen.getByRole('button', { name: 'history back' }))
    expect(screen.getByTestId('where').textContent).toBe('/plan')
    cleanup()

    // opened directly (a reload at /plan/priorities): the same
    render(
      <MemoryRouter initialEntries={['/plan/priorities']}>
        <PrioritiesEditor />
        <Where />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back to Programs' }))
    expect(screen.getByTestId('where').textContent).toBe('/program')
  })
})

function Where() {
  const location = useLocation()
  return <div data-testid="where">{location.pathname}</div>
}

function GoBack() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(-1)}>
      history back
    </button>
  )
}

describe('PrioritiesEditor — checked at 375px', () => {
  it('renders every one of the 12 muscle groups for the active run', () => {
    renderEditor()
    for (const label of Object.values(MUSCLE_GROUP_LABELS)) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  // Mechanical, whole-tree guarantee (PlanPage.weekActions.test.tsx's /
  // WorkoutDayEditorPage.test.tsx's own 375px comment: "no fixed pixel width
  // wider than 375") — scans every rendered inline style for a literal px
  // width/minWidth, instead of only relying on that being true by
  // inspection, so a future hardcoded wide element fails this test. Run with
  // marks set and every group unfolded, so the label markup is covered too.
  it('no rendered element carries a fixed pixel width wider than the declared 375px viewport', () => {
    rows = MARKED_RUN
    const { container } = renderEditor()
    unfoldAll()
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// Board 12's three PRIORITIES frames, rendered for the 390 px pictures (`CAPTURE_RENDER=1` writes `__fixtures__/priorities-<state>.html`; the pictures
// are design/1.2/built/12-priorities-<state>.png + .txt). Each test captures first, then asserts the one thing that says the capture is that frame.
// The frame's reason line reads "Check your connection and try again."; SPEC Errors (15) has the real reason there instead, so the capture shows one.
describe('PrioritiesEditor: board 12\'s PRIORITIES frames (captured)', () => {
  it('PRIORITIES · LOADING: the title and a spinner', () => {
    reads.mesos = { data: undefined, isLoading: true, isError: false }
    const { container } = renderEditor()
    captureRender('priorities-loading', container)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
  })

  it('PRIORITIES · COULDN\'T LOAD: the title, COULDN\'T LOAD PRIORITIES and the reason', () => {
    reads.rows = { data: undefined, isLoading: false, isError: true, error: new Error('Failed to fetch') }
    const { container } = renderEditor()
    captureRender('priorities-error', container)
    expect(within(screen.getByRole('alert')).getByText('Failed to fetch')).toBeTruthy()
  })

  it('PRIORITIES · NO CURRENT PROGRAM: the title and "No current program"', () => {
    reads.mesos = { data: [], isLoading: false, isError: false }
    reads.rows = { data: undefined, isLoading: false, isError: false }
    const { container } = renderEditor()
    captureRender('priorities-no-program', container)
    expect(screen.getByText('No current program')).toBeTruthy()
  })
})
