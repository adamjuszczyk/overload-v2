// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags'
import { PRIORITY_TREE } from '../../lib/priorityTags'

// Chunk 11 step 1 — reuses chunk 10's own editor machinery (same hooks, same
// MarkSelector, same buildGroupMarkEntries), parameterised by `programId`
// instead of PrioritiesEditor.tsx's hardcoded "active run" lookup. Same
// mocking precedent and the same 375px proof as PrioritiesEditor.test.tsx.

const mutateMock = vi.fn()
let programPrioritiesCallArg: string | null = null
// What the read answers (chunk 68: boards PP1, PP5 and PP5b draw its loading, its failure and a mark that didn't save).
const read: { rows: Array<{ tagType: string; tagValue: string; mark: string; updatedAt: string }>; isLoading: boolean; isError: boolean; error: unknown } = {
  rows: [],
  isLoading: false,
  isError: false,
  error: undefined,
}
let setMarkPending = false

vi.mock('../plan/useProgramPriorities', () => ({
  useProgramPriorities: (programId: string | null) => {
    programPrioritiesCallArg = programId
    return { data: read.rows, isLoading: read.isLoading, isError: read.isError, error: read.error }
  },
  useSetPriorityMark: () => ({ mutate: mutateMock, isPending: setMarkPending }),
}))

const { default: StepPriorities } = await import('./StepPriorities')

afterEach(() => {
  cleanup()
  mutateMock.mockReset()
  programPrioritiesCallArg = null
  read.rows = []
  read.isLoading = false
  read.isError = false
  read.error = undefined
  setMarkPending = false
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

  it('chunk 66: a finished program\'s editor leaves the planner\'s "skip" line out and keeps everything else (the planner passes nothing and keeps it)', () => {
    render(<StepPriorities programId="prog-1" showOptionalNote={false} />)
    expect(screen.queryByText('OPTIONAL — SKIP IF YOU DON\'T NEED IT')).toBeNull()
    for (const label of Object.values(MUSCLE_GROUP_LABELS)) expect(screen.getByText(label)).toBeTruthy()
    cleanup()
    render(<StepPriorities programId="prog-1" showOptionalNote />)
    expect(screen.getByText('OPTIONAL — SKIP IF YOU DON\'T NEED IT')).toBeTruthy()
  })

  it('expanding a group reveals its own subgroups', () => {
    render(<StepPriorities programId="prog-1" />)
    fireEvent.click(screen.getByText(MUSCLE_GROUP_LABELS.chest))
    // as PP1 words them: "Upper chest", where the app's own label is the capitals
    for (const subgroup of PRIORITY_TREE.chest) {
      const label = MUSCLE_SUBGROUP_LABELS[subgroup]
      expect(screen.getByText(label.charAt(0) + label.slice(1).toLowerCase())).toBeTruthy()
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

// ─── Chunk 68 (boards PP1, PP5, PP5b): every write as it was, drawn as the boards draw it ───────────────────────────────────────────────────

const row = (tagType: 'muscle_group' | 'muscle_subgroup', tagValue: string, mark: 'focus' | 'dont_care') => ({ tagType, tagValue, mark, updatedAt: '2026-10-01T00:00:00Z' })
const marks = (name: string) => within(screen.getByRole('group', { name }))

describe('StepPriorities — the writes (W: the same hook, the same arguments)', () => {
  it('a group\'s FOCUS and DON\'T CARE write that group\'s mark; the mark that is on, tapped, writes null (left normal)', () => {
    read.rows = [row('muscle_group', 'back', 'focus')]
    render(<StepPriorities programId="prog-1" />)

    fireEvent.click(marks('Priority for CHEST').getByText("DON'T CARE"))
    expect(mutateMock).toHaveBeenLastCalledWith({ tagType: 'muscle_group', tagValue: 'chest', mark: 'dont_care' }, expect.anything())
    fireEvent.click(marks('Priority for CHEST').getByText('FOCUS'))
    expect(mutateMock).toHaveBeenLastCalledWith({ tagType: 'muscle_group', tagValue: 'chest', mark: 'focus' }, expect.anything())
    fireEvent.click(marks('Priority for BACK').getByText('FOCUS'))
    expect(mutateMock).toHaveBeenLastCalledWith({ tagType: 'muscle_group', tagValue: 'back', mark: null }, expect.anything())
    expect(mutateMock).toHaveBeenCalledTimes(3)
  })

  it('a subgroup writes its own tag as a muscle_subgroup', () => {
    render(<StepPriorities programId="prog-1" />)
    fireEvent.click(screen.getByLabelText('Expand CHEST'))

    fireEvent.click(marks('Priority for Lower chest').getByText("DON'T CARE"))
    expect(mutateMock).toHaveBeenLastCalledWith({ tagType: 'muscle_subgroup', tagValue: 'lower_chest', mark: 'dont_care' }, expect.anything())
    fireEvent.click(marks('Priority for Upper chest').getByText('FOCUS'))
    expect(mutateMock).toHaveBeenLastCalledWith({ tagType: 'muscle_subgroup', tagValue: 'upper_chest', mark: 'focus' }, expect.anything())
  })

  // Chunk 68's review (R4): PP1 draws an inherited mark as words ("INHERITED: FOCUS"), not as a pressed button, so a tap on FOCUS there is a mark of its own
  // and not the group's mark turned off.
  it('a subgroup that inherits its group\'s mark shows no mark of its own, and tapping that mark writes it, never null (break: the segment shows the inherited mark)', () => {
    read.rows = [row('muscle_group', 'chest', 'focus')]
    render(<StepPriorities programId="prog-1" />)
    fireEvent.click(screen.getByLabelText('Expand CHEST'))

    expect(screen.getAllByText('INHERITED: FOCUS').length).toBeGreaterThan(0)
    expect(marks('Priority for Upper chest').getByText('FOCUS').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(marks('Priority for Upper chest').getByText('FOCUS'))
    expect(mutateMock).toHaveBeenLastCalledWith({ tagType: 'muscle_subgroup', tagValue: 'upper_chest', mark: 'focus' }, expect.anything())
  })

  it('the marks are off while one is being written (a second tap in that time is not sent)', () => {
    setMarkPending = true
    render(<StepPriorities programId="prog-1" />)
    expect((marks('Priority for CHEST').getByText('FOCUS') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(marks('Priority for CHEST').getByText('FOCUS'))
    expect(mutateMock).not.toHaveBeenCalled()
  })
})

describe('StepPriorities — PP1\'s rows', () => {
  it('the mark that is on is pressed; the summary names the exception; a subgroup with no mark of its own says what it takes from its group', () => {
    read.rows = [row('muscle_group', 'chest', 'focus'), row('muscle_subgroup', 'lower_chest', 'dont_care')]
    render(<StepPriorities programId="prog-1" />)

    expect(marks('Priority for CHEST').getByText('FOCUS').getAttribute('aria-pressed')).toBe('true')
    expect(marks('Priority for CHEST').getByText("DON'T CARE").getAttribute('aria-pressed')).toBe('false')
    expect(marks('Priority for BACK').getByText('FOCUS').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(/^chest without lower chest$/i)).toBeTruthy()
    expect(screen.queryByText(/^INHERITED/)).toBeNull() // shut: no subgroup rows yet

    fireEvent.click(screen.getByLabelText('Expand CHEST'))
    expect(screen.getAllByText('INHERITED: FOCUS')).toHaveLength(2) // Upper chest and Mid chest
    expect(screen.queryByText("INHERITED: DON'T CARE")).toBeNull() // Lower chest has a mark of its own: it inherits nothing
    expect(marks('Priority for Lower chest').getByText("DON'T CARE").getAttribute('aria-pressed')).toBe('true')
  })

  it('a marked group none of whose subgroups differs has no summary line (the plain name says it all)', () => {
    read.rows = [row('muscle_group', 'chest', 'focus')]
    render(<StepPriorities programId="prog-1" />)
    expect(screen.getAllByText(/^chest$/i)).toHaveLength(1) // the name, and no "chest" under it
    expect(screen.queryByText(/without/i)).toBeNull()
  })

  it('a group with no mark has no summary; the chevron names what it will do and says whether the group is unfolded', () => {
    read.rows = [row('muscle_subgroup', 'lower_chest', 'dont_care')]
    render(<StepPriorities programId="prog-1" />)
    expect(screen.queryByText(/without/i)).toBeNull()
    const toggle = screen.getByLabelText('Expand CHEST')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByLabelText('Collapse CHEST').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByLabelText('Collapse CHEST'))
    expect(screen.queryByText('Lower chest')).toBeNull()
  })
})

describe('StepPriorities — a failure says why (PP5, PP5b; SPEC Errors (15))', () => {
  it('a mark that did not save: "Couldn\'t update priorities." with the server\'s own message over the list, until the next tap', () => {
    mutateMock.mockImplementation((_vars: unknown, options: { onError: (error: unknown) => void }) => options.onError({ message: 'permission denied for table v2_program_priorities' }))
    render(<StepPriorities programId="prog-1" />)

    fireEvent.click(marks('Priority for BICEPS').getByText('FOCUS'))
    expect(screen.getByText("Couldn't update priorities.")).toBeTruthy()
    expect(screen.getByText('permission denied for table v2_program_priorities')).toBeTruthy()

    mutateMock.mockImplementation(() => {})
    fireEvent.click(marks('Priority for BICEPS').getByText('FOCUS'))
    expect(screen.queryByText("Couldn't update priorities.")).toBeNull()
  })

  it('an error with no message says "Something went wrong.", and "You may be offline." only when the phone is', () => {
    mutateMock.mockImplementation((_vars: unknown, options: { onError: (error: unknown) => void }) => options.onError({}))
    render(<StepPriorities programId="prog-1" />)
    fireEvent.click(marks('Priority for BICEPS').getByText('FOCUS'))
    expect(screen.getByText('Something went wrong.')).toBeTruthy()

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      fireEvent.click(marks('Priority for BICEPS').getByText('FOCUS'))
      expect(screen.getByText('You may be offline.')).toBeTruthy()
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    }
  })

  it('a read that fails says "Couldn\'t load priorities" and the real reason; one still out is a spinner', () => {
    read.isError = true
    read.error = { message: 'JWT expired' }
    const { unmount } = render(<StepPriorities programId="prog-1" />)
    expect(screen.getByText("Couldn't load priorities")).toBeTruthy()
    expect(screen.getByText('JWT expired')).toBeTruthy()
    expect(screen.queryByText('Check your connection and try again.')).toBeNull()
    unmount()

    read.isError = false
    read.isLoading = true
    render(<StepPriorities programId="prog-1" />)
    expect(screen.getByLabelText('Loading priorities')).toBeTruthy()
    expect(screen.queryByText('CHEST')).toBeNull()
  })
})
