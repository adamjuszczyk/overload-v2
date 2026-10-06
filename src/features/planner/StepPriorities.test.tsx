// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags'
import { PRIORITY_TREE } from '../../lib/priorityTags'

// Chunk 11 step 1 — reuses chunk 10's own editor machinery (same hooks, same
// MarkSelector, same buildGroupMarkEntries), parameterised by `programId`
// instead of PrioritiesEditor.tsx's hardcoded "active run" lookup. Same
// mocking precedent and the same 375px proof as PrioritiesEditor.test.tsx.

const mutateMock = vi.fn()
const showToastMock = vi.fn()
let programPrioritiesCallArg: string | null = null

vi.mock('../plan/useProgramPriorities', () => ({
  useProgramPriorities: (programId: string | null) => {
    programPrioritiesCallArg = programId
    return { data: [], isLoading: false, isError: false }
  },
  useSetPriorityMark: () => ({ mutate: mutateMock, isPending: false }),
}))

vi.mock('../notifications/toastStore', () => ({
  useToastStore: (selector: (s: { show: typeof showToastMock }) => unknown) => selector({ show: showToastMock }),
}))

const { default: StepPriorities } = await import('./StepPriorities')

afterEach(() => {
  cleanup()
  mutateMock.mockReset()
  showToastMock.mockReset()
  programPrioritiesCallArg = null
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

describe('StepPriorities — parameterised by this step\'s own programId (not the active run)', () => {
  it('reads priorities for the program it was given, whatever id that is', () => {
    render(<StepPriorities programId="saved-program-77" />)
    expect(programPrioritiesCallArg).toBe('saved-program-77')
  })

  it('renders every one of the 12 muscle groups', () => {
    render(<StepPriorities programId="prog-1" />)
    for (const label of Object.values(MUSCLE_GROUP_LABELS)) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('is skippable — nothing here is required, no blocking state of its own', () => {
    render(<StepPriorities programId="prog-1" />)
    expect(screen.getByText('OPTIONAL — SKIP IF YOU DON\'T NEED IT')).toBeTruthy()
  })

  it('expanding a group reveals its own subgroups', () => {
    render(<StepPriorities programId="prog-1" />)
    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.chest))
    for (const subgroup of PRIORITY_TREE.chest) {
      expect(screen.getByText(MUSCLE_SUBGROUP_LABELS[subgroup])).toBeTruthy()
    }
  })

  it('tapping a mark calls useSetPriorityMark with this tag', () => {
    render(<StepPriorities programId="prog-1" />)
    fireEvent.click(screen.getAllByText('FOCUS')[0])
    expect(mutateMock).toHaveBeenCalledWith(
      { tagType: 'muscle_group', tagValue: 'chest', mark: 'focus' },
      expect.anything(),
    )
  })

  it('no rendered element carries a fixed pixel width wider than 375px', () => {
    const { container } = render(<StepPriorities programId="prog-1" />)
    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.chest))
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
