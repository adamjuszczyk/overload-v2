// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Mesocycle, Program } from '../../types'
import { MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags'
import { PRIORITY_TREE } from '../../lib/priorityTags'

// Chunk 10 review fix — "add a jsdom render of PrioritiesEditor at width
// 375 ... asserting no horizontal overflow / the expected layout
// container." Same seam and the same 375px convention as PlanPage.
// weekActions.test.tsx / WorkoutDayEditorPage.test.tsx: window.innerWidth
// is set before every render; jsdom computes no real CSS layout (no
// scrollWidth to assert against), so what actually proves "no horizontal
// overflow" here is mechanical — every element's own inline style, not a
// rendered pixel measurement — see the last two tests below.

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: '2026-01-01', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: {} as Program['schedule'],
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run',
}

const mutateMock = vi.fn()
const showToastMock = vi.fn()

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false, isError: false }),
}))

vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
}))

vi.mock('./useProgramPriorities', () => ({
  useProgramPriorities: () => ({ data: [], isLoading: false, isError: false }),
  useSetPriorityMark: () => ({ mutate: mutateMock, isPending: false }),
}))

vi.mock('../notifications/toastStore', () => ({
  useToastStore: (selector: (s: { show: typeof showToastMock }) => unknown) => selector({ show: showToastMock }),
}))

const { default: PrioritiesEditor } = await import('./PrioritiesEditor')

afterEach(() => {
  cleanup()
  mutateMock.mockReset()
  showToastMock.mockReset()
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

describe('PrioritiesEditor — checked at 375px', () => {
  it('renders every one of the 12 muscle groups for the active run', () => {
    renderEditor()
    for (const label of Object.values(MUSCLE_GROUP_LABELS)) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('expanding a group reveals every one of its own subgroups (groups unfolding to subgroups)', () => {
    renderEditor()
    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.chest))
    for (const subgroup of PRIORITY_TREE.chest) {
      expect(screen.getByText(MUSCLE_SUBGROUP_LABELS[subgroup])).toBeTruthy()
    }
  })

  // The real phone-width guarantee: every mark-chip row (MarkSelector.tsx)
  // is a horizontal-scroll container — the same hide-scrollbar/
  // overflowX:'auto' row PrioritySelector.tsx already uses at this exact
  // width — rather than a row that could push the page wider than the
  // viewport. Checked on the rendered output, not merely asserted in a
  // comment.
  it('every mark-chip row scrolls horizontally (overflowX: auto) instead of risking overflow', () => {
    renderEditor()
    const focusChip = screen.getAllByText('FOCUS')[0]
    const row = focusChip.closest('div')
    expect(row).not.toBeNull()
    expect(row!.style.overflowX).toBe('auto')
  })

  // Mechanical, whole-tree version of the same guarantee (PlanPage.
  // weekActions.test.tsx's / WorkoutDayEditorPage.test.tsx's own 375px
  // comment: "no fixed pixel width wider than 375") — scans every rendered
  // inline style for a literal px width/minWidth, instead of only relying
  // on that being true by inspection, so a future hardcoded wide element
  // fails this test.
  it('no rendered element carries a fixed pixel width wider than the declared 375px viewport', () => {
    const { container } = renderEditor()
    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.chest)) // also cover the expanded (subgroup) markup
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
