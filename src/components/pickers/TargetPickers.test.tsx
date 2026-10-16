// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import RepTargetPicker from './RepTargetPicker'
import type { RepTargetPickerProps } from './RepTargetPicker'
import RirTargetPicker from './RirTargetPicker'
import type { RirTargetPickerProps } from './RirTargetPicker'
import { RIR_BOUNDS, rirRange, type TargetableSet } from './pickerLogic'
import type { RepTarget } from '../../lib/plannerVocabulary'
import { captureRender } from '../../testing/captureRender'
import { textOnAccent } from '../../testing/textOnAccent'

// TASKS-1.2 chunk 39: the rep target picker (boards 6, PP3d) and the RIR target picker (board 7). They
// write nothing: the footer button returns a target and whether "Use for all" was ticked. The renders
// in "draws board ..." are the fixtures for the 390 px screenshots in design/1.2/built/.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const noop = () => {}

const heads = (count: number, warmups = 0): TargetableSet[] =>
  Array.from({ length: count }, (_, i) => ({ id: `set-${i + 1}`, isWarmup: i < warmups }))

function repProps(over: Partial<RepTargetPickerProps> = {}): RepTargetPickerProps {
  return {
    exerciseName: 'Lat Pulldown',
    setNumber: 1,
    weekNumber: 2,
    value: { type: 'range', min: 8, max: 10 },
    sets: heads(3),
    onSubmit: noop,
    onClose: noop,
    ...over,
  }
}

function rirProps(over: Partial<RirTargetPickerProps> = {}): RirTargetPickerProps {
  return {
    exerciseName: 'Seated Cable Row',
    setNumber: 1,
    weekNumber: 2,
    value: rirRange(1, 2),
    sets: heads(3),
    onSubmit: noop,
    onClose: noop,
    ...over,
  }
}

/** What the page behind boards 6, 7 and PP3d shows, under the scrim. */
function PageBehind({ title }: { title: string }) {
  const card = { borderRadius: 12, background: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' } as const
  return (
    <div aria-hidden="true" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, color: 'var(--text-primary)' }}>{title}</span>
      <div style={{ ...card, height: 56 }} />
      <div style={{ ...card, height: 220 }} />
    </div>
  )
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const segment = (name: string) => button(name)
const pressedSegments = () =>
  screen
    .getByRole('group', { name: 'Kind of target' })
    .querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')
const boxEl = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const box = (name: string) => boxEl(name).value
const useForAll = () => screen.queryByRole('checkbox', { name: /^Use for all/ })
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

function tap(name: string | RegExp, times: number) {
  for (let i = 0; i < times; i++) fireEvent.click(button(name))
}

describe('RepTargetPicker: the frame', () => {
  it('draws board 6: the eyebrow, the title, the four segments with RANGE picked, FROM 8 and TO 10, Use for all ticked, the footer button', () => {
    render(
      <>
        <PageBehind title="PLAN" />
        <RepTargetPicker {...repProps()} />
      </>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Rep target' })
    const segments = Array.from(screen.getByRole('group', { name: 'Kind of target' }).querySelectorAll('button')).map((b) => b.textContent)
    expect(segments).toEqual(['NONE', 'NUMBER', 'RANGE', 'AMRAP'])
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['RANGE'])
    expect(box('From')).toBe('8')
    expect(box('To')).toBe('10')
    expect((useForAll() as HTMLElement).getAttribute('aria-checked')).toBe('true')
    const parts = [
      within(dialog).getByText('Lat Pulldown · SET 01 · WEEK 2'),
      within(dialog).getByRole('heading', { level: 2, name: 'Rep target' }),
      segment('NONE'),
      within(dialog).getByText('FROM'),
      screen.getByRole('textbox', { name: 'From' }),
      button('From: fewer'),
      within(dialog).getByText('TO'),
      screen.getByRole('textbox', { name: 'To' }),
      screen.getByRole('checkbox', { name: 'Use for all 3 sets of Lat Pulldown' }),
      button('SET 8–10 REPS'),
    ]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    captureRender('picker-6', document.body)
  })

  it("draws PP3d: the stepped planner's rep picker, no week, four sets", () => {
    render(
      <>
        <PageBehind title="BULK" />
        <RepTargetPicker {...repProps({ exerciseName: 'Incline Dumbbell Press', setNumber: 2, weekNumber: undefined, sets: heads(4) })} />
      </>,
    )
    expect(screen.getByText('Incline Dumbbell Press · SET 02')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Use for all 4 sets of Incline Dumbbell Press' })).toBeTruthy()
    expect(button('SET 8–10 REPS')).toBeTruthy()
    captureRender('picker-pp3d', document.body)
  })

  it('says CYCLE N on a sequence program', () => {
    render(<RepTargetPicker {...repProps({ isCycle: true })} />)
    expect(screen.getByText('Lat Pulldown · SET 01 · CYCLE 2')).toBeTruthy()
  })

  it('× , a tap on the scrim and Escape ask to close and send nothing; the footer button does not close it', () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onClose, onSubmit })} />)
    fireEvent.click(button('Close'))
    fireEvent.click(document.querySelector('[data-bottom-sheet-scrim]') as HTMLElement)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(button('SET 8–10 REPS'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('RepTargetPicker: the segments', () => {
  it('opens on the segment the set\'s target is, with its numbers', () => {
    const cases: [RepTarget, string, string][] = [
      [{ type: 'none' }, 'NONE', 'CLEAR TARGET'],
      [{ type: 'number', value: 12 }, 'NUMBER', 'SET 12 REPS'],
      [{ type: 'range', min: 6, max: 9 }, 'RANGE', 'SET 6–9 REPS'],
      [{ type: 'amrap' }, 'AMRAP', 'SET AMRAP'],
    ]
    for (const [value, segmentName, footer] of cases) {
      const { unmount } = render(<RepTargetPicker {...repProps({ value })} />)
      expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual([segmentName])
      expect(button(footer)).toBeTruthy()
      unmount()
    }
  })

  it('the footer button follows the choice', () => {
    render(<RepTargetPicker {...repProps()} />)
    fireEvent.click(segment('NUMBER'))
    expect(button('SET 8 REPS')).toBeTruthy()
    fireEvent.click(segment('AMRAP'))
    expect(button('SET AMRAP')).toBeTruthy()
    fireEvent.click(segment('NONE'))
    expect(button('CLEAR TARGET')).toBeTruthy()
    fireEvent.click(segment('RANGE'))
    expect(button('SET 8–10 REPS')).toBeTruthy()
  })

  it('NUMBER shows REPS with one box; RANGE shows FROM and TO; NONE and AMRAP show their panels and no box', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    expect(screen.getByText('REPS')).toBeTruthy()
    expect(box('REPS')).toBe('12')
    expect(screen.queryByRole('textbox', { name: 'From' })).toBeNull()
    fireEvent.click(segment('RANGE'))
    expect(screen.queryByText('REPS')).toBeNull()
    expect(box('From')).toBe('12')
    expect(box('To')).toBe('14')
    fireEvent.click(segment('NONE'))
    expect(screen.getByText('No rep target')).toBeTruthy()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    fireEvent.click(segment('AMRAP'))
    expect(screen.getByText('As many reps as possible. An empty RIR becomes 0.')).toBeTruthy()
    expect(screen.queryByText('No rep target')).toBeNull()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('RANGE grows from the number as it was stepped to, not as the set opened', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    tap('More reps', 3)
    fireEvent.click(segment('RANGE'))
    expect(box('From')).toBe('15')
    expect(box('To')).toBe('17')
    expect(button('SET 15–17 REPS')).toBeTruthy()
  })

  it('has no range helper line: that is the RIR picker\'s', () => {
    render(<RepTargetPicker {...repProps()} />)
    expect(screen.queryByText('Either number is on plan. Pick on the day.')).toBeNull()
  })
})

describe('RepTargetPicker: what the footer button returns', () => {
  it('NONE: clears the target', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onSubmit })} />)
    fireEvent.click(segment('NONE'))
    fireEvent.click(button('CLEAR TARGET'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'none' }, applyToAll: true })
  })

  it('NUMBER: the number', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 }, onSubmit })} />)
    tap('More reps', 3)
    tap('Fewer reps', 1)
    expect(box('REPS')).toBe('14')
    fireEvent.click(button('SET 14 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'number', value: 14 }, applyToAll: true })
  })

  it('RANGE: the two numbers', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onSubmit })} />)
    tap('From: fewer', 2)
    tap('To: more', 2)
    expect(button('SET 6–12 REPS')).toBeTruthy()
    fireEvent.click(button('SET 6–12 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'range', min: 6, max: 12 }, applyToAll: true })
  })

  it('AMRAP: AMRAP', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onSubmit })} />)
    fireEvent.click(segment('AMRAP'))
    fireEvent.click(button('SET AMRAP'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'amrap' }, applyToAll: true })
  })

  it('a range whose ends meet is a number', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onSubmit })} />)
    tap('From: more', 2)
    expect(box('From')).toBe('10')
    expect(button('SET 10 REPS')).toBeTruthy()
    fireEvent.click(button('SET 10 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'number', value: 10 }, applyToAll: true })
  })

  it('a segment tapped away and back finds its numbers where they were', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onSubmit })} />)
    tap('To: more', 3)
    fireEvent.click(segment('AMRAP'))
    fireEvent.click(segment('RANGE'))
    fireEvent.click(button('SET 8–13 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'range', min: 8, max: 13 }, applyToAll: true })
  })
})

describe('RepTargetPicker: the steppers', () => {
  it('a rep target is at least 1: - on 1 does nothing and says so', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 2 } })} />)
    tap('Fewer reps', 1)
    expect(box('REPS')).toBe('1')
    expect(button('Fewer reps').disabled).toBe(true)
    fireEvent.click(button('Fewer reps'))
    expect(box('REPS')).toBe('1')
    expect(button('SET 1 REP')).toBeTruthy()
  })

  it('stops at 100', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 99 } })} />)
    tap('More reps', 3)
    expect(box('REPS')).toBe('100')
    expect(button('More reps').disabled).toBe(true)
  })

  it('FROM never passes TO and TO never goes below FROM', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'range', min: 9, max: 10 } })} />)
    tap('From: more', 3)
    expect(box('From')).toBe('10')
    expect(button('From: more').disabled).toBe(true)
    expect(button('To: fewer').disabled).toBe(true)
    tap('To: more', 1)
    expect(box('To')).toBe('11')
    expect(button('To: fewer').disabled).toBe(false)
  })
})

describe('RepTargetPicker: Use for all N sets', () => {
  it('starts ticked, and unticking it is what the button returns', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onSubmit })} />)
    const checkbox = screen.getByRole('checkbox', { name: 'Use for all 3 sets of Lat Pulldown' })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(checkbox)
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(button('SET 8–10 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'range', min: 8, max: 10 }, applyToAll: false })
    fireEvent.click(checkbox)
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
  })

  it("counts every head, a warmup too: a rep target goes to all of them", () => {
    render(<RepTargetPicker {...repProps({ sets: heads(4, 1) })} />)
    expect(screen.getByRole('checkbox', { name: 'Use for all 4 sets of Lat Pulldown' })).toBeTruthy()
  })

  it('is not drawn when there is only one set to apply it to, and the button then says it was not applied', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ sets: heads(1), onSubmit })} />)
    expect(useForAll()).toBeNull()
    fireEvent.click(button('SET 8–10 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'range', min: 8, max: 10 }, applyToAll: false })
  })
})

describe('RirTargetPicker: the frame', () => {
  it('draws board 7: the eyebrow, the title, the three segments with RANGE picked, FROM 1 and TO 2, the helper line, Use for all ticked, SET RIR 1–2', () => {
    render(
      <>
        <PageBehind title="PLAN" />
        <RirTargetPicker {...rirProps()} />
      </>,
    )
    const dialog = screen.getByRole('dialog', { name: 'RIR target' })
    const segments = Array.from(screen.getByRole('group', { name: 'Kind of target' }).querySelectorAll('button')).map((b) => b.textContent)
    expect(segments).toEqual(['NONE', 'NUMBER', 'RANGE'])
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['RANGE'])
    expect(box('From')).toBe('1')
    expect(box('To')).toBe('2')
    const parts = [
      within(dialog).getByText('Seated Cable Row · SET 01 · WEEK 2'),
      within(dialog).getByRole('heading', { level: 2, name: 'RIR target' }),
      segment('NONE'),
      within(dialog).getByText('FROM'),
      screen.getByRole('textbox', { name: 'From' }),
      within(dialog).getByText('TO'),
      screen.getByRole('textbox', { name: 'To' }),
      within(dialog).getByText('Either number is on plan. Pick on the day.'),
      screen.getByRole('checkbox', { name: 'Use for all 3 sets of Seated Cable Row' }),
      button('SET RIR 1–2'),
    ]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    expect((useForAll() as HTMLElement).getAttribute('aria-checked')).toBe('true')
    captureRender('picker-7', document.body)
  })
})

describe('RirTargetPicker: closing', () => {
  it('× , a tap on the scrim and Escape ask to close and send nothing; the footer button does not close it', () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ onClose, onSubmit })} />)
    fireEvent.click(button('Close'))
    fireEvent.click(document.querySelector('[data-bottom-sheet-scrim]') as HTMLElement)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(button('SET RIR 1–2'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('says CYCLE N on a sequence program', () => {
    render(<RirTargetPicker {...rirProps({ isCycle: true })} />)
    expect(screen.getByText('Seated Cable Row · SET 01 · CYCLE 2')).toBeTruthy()
  })
})

describe('RirTargetPicker: the segments', () => {
  it('has NONE, NUMBER and RANGE and no AMRAP', () => {
    render(<RirTargetPicker {...rirProps()} />)
    expect(screen.queryByRole('button', { name: 'AMRAP' })).toBeNull()
  })

  it("opens on the segment the set's target is", () => {
    const cases = [
      [{ kind: 'none' }, 'NONE', 'CLEAR TARGET'],
      [{ kind: 'number', value: 3 }, 'NUMBER', 'SET RIR 3'],
      [rirRange(0, 1), 'RANGE', 'SET RIR 0–1'],
    ] as const
    for (const [value, segmentName, footer] of cases) {
      const { unmount } = render(<RirTargetPicker {...rirProps({ value })} />)
      expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual([segmentName])
      expect(button(footer)).toBeTruthy()
      unmount()
    }
  })

  it('NUMBER reads REPS IN RESERVE; the helper line is drawn under a range and nowhere else', () => {
    render(<RirTargetPicker {...rirProps()} />)
    const helper = 'Either number is on plan. Pick on the day.'
    expect(screen.getByText(helper)).toBeTruthy()
    fireEvent.click(segment('NUMBER'))
    expect(screen.getByText('REPS IN RESERVE')).toBeTruthy()
    expect(box('REPS IN RESERVE')).toBe('1')
    expect(screen.queryByText(helper)).toBeNull()
    fireEvent.click(segment('NONE'))
    expect(screen.getByText('No RIR target')).toBeTruthy()
    expect(screen.queryByText(helper)).toBeNull()
    fireEvent.click(segment('RANGE'))
    expect(screen.getByText(helper)).toBeTruthy()
  })

  it('RANGE grows from the number as it was stepped to, not as the set opened', () => {
    render(<RirTargetPicker {...rirProps({ value: { kind: 'number', value: 2 } })} />)
    tap('More RIR', 1)
    fireEvent.click(segment('RANGE'))
    expect(box('From')).toBe('3')
    expect(box('To')).toBe('4')
    expect(button('SET RIR 3–4')).toBeTruthy()
  })

  it('the footer button follows the choice', () => {
    render(<RirTargetPicker {...rirProps()} />)
    fireEvent.click(segment('NUMBER'))
    expect(button('SET RIR 1')).toBeTruthy()
    fireEvent.click(segment('NONE'))
    expect(button('CLEAR TARGET')).toBeTruthy()
    fireEvent.click(segment('RANGE'))
    expect(button('SET RIR 1–2')).toBeTruthy()
  })
})

describe('RirTargetPicker: what the footer button returns', () => {
  it('NONE: clears the target', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ onSubmit })} />)
    fireEvent.click(segment('NONE'))
    fireEvent.click(button('CLEAR TARGET'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'none' }, applyToAll: true })
  })

  it('NUMBER: the number', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ value: { kind: 'number', value: 2 }, onSubmit })} />)
    tap('More RIR', 1)
    fireEvent.click(button('SET RIR 3'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'number', value: 3 }, applyToAll: true })
  })

  it('RANGE: the two numbers, as a range', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ onSubmit })} />)
    fireEvent.click(button('SET RIR 1–2'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'range', min: 1, max: 2 }, applyToAll: true })
  })

  it('a range whose ends meet is a number', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ onSubmit })} />)
    tap('From: more', 1)
    expect(button('SET RIR 2')).toBeTruthy()
    fireEvent.click(button('SET RIR 2'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'number', value: 2 }, applyToAll: true })
  })
})

describe('RirTargetPicker: the steppers', () => {
  it('RIR 0 is a target: the floor is 0, not 1', () => {
    render(<RirTargetPicker {...rirProps({ value: { kind: 'number', value: 1 } })} />)
    tap('Less RIR', 1)
    expect(box('REPS IN RESERVE')).toBe('0')
    expect(button('Less RIR').disabled).toBe(true)
    expect(button('SET RIR 0')).toBeTruthy()
  })

  it('values go well beyond 5: 12 is reachable, and the top is 20', () => {
    render(<RirTargetPicker {...rirProps({ value: { kind: 'number', value: 2 } })} />)
    tap('More RIR', 10)
    expect(box('REPS IN RESERVE')).toBe('12')
    expect(button('SET RIR 12')).toBeTruthy()
    tap('More RIR', 20)
    expect(box('REPS IN RESERVE')).toBe(String(RIR_BOUNDS.max))
    expect(button('More RIR').disabled).toBe(true)
  })

  it('a range can end at 12', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ onSubmit })} />)
    tap('To: more', 10)
    fireEvent.click(button('SET RIR 1–12'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'range', min: 1, max: 12 }, applyToAll: true })
  })
})

describe('RirTargetPicker: Use for all N sets (G49: a warmup has no RIR target)', () => {
  it('counts the sets that are not warmups: a RIR target is never written to a warmup', () => {
    render(<RirTargetPicker {...rirProps({ sets: heads(4, 1) })} />)
    expect(screen.getByRole('checkbox', { name: 'Use for all 3 sets of Seated Cable Row' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Use for all 4 sets of Seated Cable Row' })).toBeNull()
  })

  it('starts ticked, and unticking it is what the button returns', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ onSubmit })} />)
    const checkbox = screen.getByRole('checkbox', { name: 'Use for all 3 sets of Seated Cable Row' })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(checkbox)
    fireEvent.click(button('SET RIR 1–2'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'range', min: 1, max: 2 }, applyToAll: false })
  })

  it('is not drawn when fewer than two sets would take it (one working set after the warmups)', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ sets: heads(3, 2), onSubmit })} />)
    expect(useForAll()).toBeNull()
    fireEvent.click(button('SET RIR 1–2'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'range', min: 1, max: 2 }, applyToAll: false })
  })
})

// ─── The number boxes are inputs (DECISIONS 128, Adam 2026-10-15) ──────────────────────────────────────────────

/** A whole new value typed into a box, as the browser reports it (the keystroke replaced the selected text). */
function typeInto(name: string, value: string) {
  fireEvent.change(boxEl(name), { target: { value } })
}

/** The box takes focus, then loses it: what tapping into it and then tapping elsewhere does. */
function enterAndLeave(name: string) {
  const el = boxEl(name)
  act(() => el.focus())
  fireEvent.blur(el)
}

describe('RepTargetPicker: the number boxes are inputs you can type into (choose a segment, then type)', () => {
  it('NUMBER, FROM and TO are text boxes with the number in them, and a phone shows its number pad', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    const reps = boxEl('REPS')
    expect(reps.tagName).toBe('INPUT')
    expect(reps.value).toBe('12')
    expect(reps.getAttribute('inputmode')).toBe('numeric')
    // 16 px is the size below which iOS zooms the page when a field takes focus
    expect(Number.parseInt(reps.style.fontSize, 10)).toBeGreaterThanOrEqual(16)
    fireEvent.click(segment('RANGE'))
    expect(boxEl('From').value).toBe('12')
    expect(boxEl('To').value).toBe('14')
    expect(boxEl('From').getAttribute('inputmode')).toBe('numeric')
    expect(boxEl('To').getAttribute('inputmode')).toBe('numeric')
  })

  it('a typed number is what the footer button says and returns', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 }, onSubmit })} />)
    typeInto('REPS', '14')
    expect(box('REPS')).toBe('14')
    expect(button('SET 14 REPS')).toBeTruthy()
    fireEvent.click(button('SET 14 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'number', value: 14 }, applyToAll: true })
  })

  it('typing 12 as 1 and then 12 works: nothing is clamped on the way, so the first digit is not turned into something else', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 8 }, onSubmit })} />)
    typeInto('REPS', '1')
    expect(button('SET 1 REP')).toBeTruthy()
    typeInto('REPS', '12')
    fireEvent.click(button('SET 12 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'number', value: 12 }, applyToAll: true })
  })

  it('typed text is held to the bounds: 150 is 100 and 0 is 1, in the box once it is left and in the button at once', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 }, onSubmit })} />)
    typeInto('REPS', '150')
    expect(box('REPS')).toBe('150') // still being typed
    expect(button('SET 100 REPS')).toBeTruthy() // what tapping the button would set
    enterAndLeave('REPS')
    expect(box('REPS')).toBe('100')
    typeInto('REPS', '0')
    expect(button('SET 1 REP')).toBeTruthy()
    enterAndLeave('REPS')
    expect(box('REPS')).toBe('1')
    fireEvent.click(button('SET 1 REP'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'number', value: 1 }, applyToAll: true })
  })

  it('the footer button sets what the box will hold even when it is tapped before the box was left', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 }, onSubmit })} />)
    typeInto('REPS', '150')
    fireEvent.click(button('SET 100 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'number', value: 100 }, applyToAll: true })
  })

  it('a box emptied and left goes back to the number it had; the button never says anything else', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 }, onSubmit })} />)
    typeInto('REPS', '')
    expect(box('REPS')).toBe('')
    expect(button('SET 12 REPS')).toBeTruthy()
    enterAndLeave('REPS')
    expect(box('REPS')).toBe('12')
    typeInto('REPS', '')
    fireEvent.click(button('SET 12 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'number', value: 12 }, applyToAll: true })
  })

  it('only digits go in: letters change nothing, and a paste keeps its digits', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    typeInto('REPS', 'abc')
    expect(box('REPS')).toBe('12')
    typeInto('REPS', '1a5')
    expect(box('REPS')).toBe('15')
    typeInto('REPS', '0012')
    expect(box('REPS')).toBe('12')
    typeInto('REPS', '9999')
    expect(box('REPS')).toBe('999') // three digits; settled to 100 when the box is left
    expect(button('SET 100 REPS')).toBeTruthy()
  })

  it('Enter leaves the box, and leaving it settles what was typed', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    const reps = boxEl('REPS')
    act(() => reps.focus())
    typeInto('REPS', '150')
    fireEvent.keyDown(reps, { key: 'Enter' })
    expect(document.activeElement).not.toBe(reps)
    expect(box('REPS')).toBe('100')
  })

  it('a box takes focus with its number selected, so typing replaces it', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    const reps = boxEl('REPS')
    act(() => reps.focus())
    expect(reps.selectionStart).toBe(0)
    expect(reps.selectionEnd).toBe(2)
  })

  it('the box with focus has the accent outline, and TO has it only then', () => {
    render(<RepTargetPicker {...repProps()} />)
    const to = boxEl('To')
    expect(to.style.borderColor).toBe('var(--border-strong)')
    expect(boxEl('From').style.borderColor).toBe('var(--accent)')
    act(() => to.focus())
    expect(to.style.borderColor).toBe('var(--accent)')
    fireEvent.blur(to)
    expect(to.style.borderColor).toBe('var(--border-strong)')
  })

  it('a stepper goes on from the typed number, and typing goes on from a stepped one', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    typeInto('REPS', '20')
    fireEvent.click(button('More reps'))
    expect(box('REPS')).toBe('21')
    fireEvent.click(button('Fewer reps'))
    expect(box('REPS')).toBe('20')
    typeInto('REPS', '35')
    enterAndLeave('REPS')
    fireEvent.click(button('Fewer reps'))
    expect(box('REPS')).toBe('34')
  })

  it('a stepper tapped with a number outside the range typed goes on from the number the box will be held to (100), not from the last one the draft took (12)', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    typeInto('REPS', '150')
    fireEvent.click(button('Fewer reps'))
    expect(box('REPS')).toBe('99')
  })

  it('and the RIR picker\'s: 21 is held to 20, so a tap on - makes 19', () => {
    render(<RirTargetPicker {...rirProps({ value: { kind: 'number', value: 3 } })} />)
    typeInto('REPS IN RESERVE', '21')
    fireEvent.click(button('Less RIR'))
    expect(box('REPS IN RESERVE')).toBe('19')
  })

  it('a stepper past what was typed stops at the bound, and says so', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    typeInto('REPS', '150')
    expect(button('More reps').disabled).toBe(true) // the text will be held to 100, where + stops
    typeInto('REPS', '0')
    expect(button('Fewer reps').disabled).toBe(true) // held to 1, where - stops
  })

  it('a segment tapped after typing starts from the typed number: RANGE grows from it', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    typeInto('REPS', '20')
    fireEvent.click(segment('RANGE'))
    expect(box('From')).toBe('20')
    expect(box('To')).toBe('22')
    fireEvent.click(segment('NUMBER'))
    expect(box('REPS')).toBe('20')
  })

  it('a segment tapped with a number outside the range typed starts from the number the box will be held to (1), not from the last one the draft took (12)', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    typeInto('REPS', '0')
    fireEvent.click(segment('RANGE'))
    expect(box('From')).toBe('1')
    expect(box('To')).toBe('3')
    expect(button('SET 1–3 REPS')).toBeTruthy()
  })

  it('RANGE: typing TO and FROM sets the two ends', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onSubmit })} />)
    typeInto('To', '15')
    typeInto('From', '6')
    expect(button('SET 6–15 REPS')).toBeTruthy()
    fireEvent.click(button('SET 6–15 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'range', min: 6, max: 15 }, applyToAll: true })
  })

  it('RANGE: FROM typed past TO is held at TO, and ends that meet are a number', () => {
    const onSubmit = vi.fn()
    render(<RepTargetPicker {...repProps({ onSubmit })} />)
    typeInto('From', '12')
    expect(button('SET 10 REPS')).toBeTruthy()
    enterAndLeave('From')
    expect(box('From')).toBe('10')
    expect(box('To')).toBe('10')
    fireEvent.click(button('SET 10 REPS'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { type: 'number', value: 10 }, applyToAll: true })
  })

  it('RANGE: TO typed below FROM is held at FROM', () => {
    render(<RepTargetPicker {...repProps()} />)
    typeInto('To', '5')
    enterAndLeave('To')
    expect(box('To')).toBe('8')
    expect(box('From')).toBe('8')
    expect(button('SET 8 REPS')).toBeTruthy()
  })

  it('RANGE: a number typed in one end moves the other end\'s bound with it', () => {
    render(<RepTargetPicker {...repProps()} />)
    typeInto('To', '20')
    typeInto('From', '15') // inside 1..20 only because TO is 20 now
    expect(button('SET 15–20 REPS')).toBeTruthy()
  })

  it('the pick-and-type flow ends in the footer button: AMRAP has no box to type into', () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    fireEvent.click(segment('AMRAP'))
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    fireEvent.click(segment('NUMBER'))
    expect(box('REPS')).toBe('12')
  })
})

describe('RirTargetPicker: the number boxes are inputs you can type into, from 0 to 20', () => {
  it('0 is a number you can type; 21 is held to 20', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ value: { kind: 'number', value: 3 }, onSubmit })} />)
    typeInto('REPS IN RESERVE', '0')
    expect(box('REPS IN RESERVE')).toBe('0')
    expect(button('SET RIR 0')).toBeTruthy()
    typeInto('REPS IN RESERVE', '21')
    expect(button('SET RIR 20')).toBeTruthy()
    enterAndLeave('REPS IN RESERVE')
    expect(box('REPS IN RESERVE')).toBe('20')
    typeInto('REPS IN RESERVE', '12')
    fireEvent.click(button('SET RIR 12'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'number', value: 12 }, applyToAll: true })
  })

  it('RANGE: typing both ends returns a range; ends that meet return a number', () => {
    const onSubmit = vi.fn()
    render(<RirTargetPicker {...rirProps({ onSubmit })} />)
    typeInto('To', '12')
    typeInto('From', '0')
    expect(button('SET RIR 0–12')).toBeTruthy()
    fireEvent.click(button('SET RIR 0–12'))
    expect(onSubmit).toHaveBeenCalledWith({ target: { kind: 'range', min: 0, max: 12 }, applyToAll: true })
    typeInto('From', '15') // past TO (12): held at TO
    expect(button('SET RIR 12')).toBeTruthy()
    fireEvent.click(button('SET RIR 12'))
    expect(onSubmit).toHaveBeenLastCalledWith({ target: { kind: 'number', value: 12 }, applyToAll: true })
  })
})

// ─── A picker opens on the set's current target (DECISIONS 128, Adam 2026-10-15) ────────────────────────────────

describe("a picker opens on the set's current target; the boards' examples start only a segment the set doesn't have", () => {
  // Each target differs from the example it could be mistaken for (reps 8 / 8-10, RIR 2 / 1-2).
  it('reps: a number, a range and AMRAP open as the set has them', () => {
    const { unmount } = render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['NUMBER'])
    expect(box('REPS')).toBe('12')
    expect(button('SET 12 REPS')).toBeTruthy()
    unmount()

    const second = render(<RepTargetPicker {...repProps({ value: { type: 'range', min: 6, max: 9 } })} />)
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['RANGE'])
    expect(box('From')).toBe('6')
    expect(box('To')).toBe('9')
    expect(button('SET 6–9 REPS')).toBeTruthy()
    second.unmount()

    render(<RepTargetPicker {...repProps({ value: { type: 'amrap' } })} />)
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['AMRAP'])
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('RIR: a number and a range open as the set has them', () => {
    const { unmount } = render(<RirTargetPicker {...rirProps({ value: { kind: 'number', value: 4 } })} />)
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['NUMBER'])
    expect(box('REPS IN RESERVE')).toBe('4')
    expect(button('SET RIR 4')).toBeTruthy()
    unmount()

    render(<RirTargetPicker {...rirProps({ value: rirRange(0, 1) })} />)
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['RANGE'])
    expect(box('From')).toBe('0')
    expect(box('To')).toBe('1')
  })

  it('a set with no target opens on NONE with no number anywhere, and nothing is pre-filled until a segment is picked', () => {
    const { unmount } = render(<RepTargetPicker {...repProps({ value: { type: 'none' } })} />)
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['NONE'])
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.getByText('No rep target')).toBeTruthy()
    expect(button('CLEAR TARGET')).toBeTruthy()
    // the examples are only where a segment the set doesn't have starts
    fireEvent.click(segment('NUMBER'))
    expect(box('REPS')).toBe('8')
    fireEvent.click(segment('NONE'))
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    fireEvent.click(segment('RANGE'))
    expect(box('From')).toBe('8')
    expect(box('To')).toBe('10')
    unmount()

    render(<RirTargetPicker {...rirProps({ value: { kind: 'none' } })} />)
    expect(Array.from(pressedSegments()).map((b) => b.textContent)).toEqual(['NONE'])
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.getByText('No RIR target')).toBeTruthy()
    fireEvent.click(segment('NUMBER'))
    expect(box('REPS IN RESERVE')).toBe('2')
    fireEvent.click(segment('NONE'))
    fireEvent.click(segment('RANGE'))
    expect(box('From')).toBe('1')
    expect(box('To')).toBe('2')
  })

  it("a segment the set doesn't have starts from the example, not from a number the set never had: AMRAP then NUMBER or RANGE", () => {
    render(<RepTargetPicker {...repProps({ value: { type: 'amrap' } })} />)
    fireEvent.click(segment('NUMBER'))
    expect(box('REPS')).toBe('8')
    fireEvent.click(segment('RANGE'))
    expect(box('From')).toBe('8')
    expect(box('To')).toBe('10')
  })

  it("a set's own number or range is what its other segment starts from: 12 grows into 12–14, 6–9 gives 6", () => {
    const { unmount } = render(<RepTargetPicker {...repProps({ value: { type: 'number', value: 12 } })} />)
    fireEvent.click(segment('RANGE'))
    expect(box('From')).toBe('12')
    expect(box('To')).toBe('14')
    unmount()

    render(<RepTargetPicker {...repProps({ value: { type: 'range', min: 6, max: 9 } })} />)
    fireEvent.click(segment('NUMBER'))
    expect(box('REPS')).toBe('6')
  })
})

// ─── Text on the accent is --on-accent (DECISIONS 128 (g), Adam 2026-10-15) ─────────────────────────────────────

describe('the target pickers draw their text on the accent in --on-accent, never --base', () => {
  it('the picked segment, the ticked "Use for all" box and the footer button', () => {
    render(<RepTargetPicker {...repProps()} />)
    const onAccent = textOnAccent(document.body)
    // exactly these three: the picked RANGE segment, the tick box (checked: a check mark on the accent), the footer button
    expect(onAccent.map((el) => el.textContent)).toEqual(['RANGE', '', 'SET 8–10 REPS'])
    for (const el of onAccent) expect(el.style.color, el.textContent || 'the tick').toBe('var(--on-accent)')
  })

  it('moves with the choice: the segment tapped is the one drawn on the accent, the one left is not', () => {
    render(<RepTargetPicker {...repProps()} />)
    fireEvent.click(segment('AMRAP'))
    const texts = textOnAccent(document.body).map((el) => el.textContent)
    expect(texts).toEqual(['AMRAP', '', 'SET AMRAP'])
    expect(segment('RANGE').style.color).toBe('var(--text-secondary)')
    expect(segment('AMRAP').style.color).toBe('var(--on-accent)')
  })

  it('an unticked "Use for all" box has no accent behind it, so nothing sits on it', () => {
    render(<RirTargetPicker {...rirProps()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /^Use for all/ }))
    expect(textOnAccent(document.body).map((el) => el.textContent)).toEqual(['RANGE', 'SET RIR 1–2'])
    for (const el of textOnAccent(document.body)) expect(el.style.color).toBe('var(--on-accent)')
  })
})

describe('a name with no break opportunity wraps inside the target pickers', () => {
  it('"Use for all N sets of [exercise]" wraps a long exercise name inside its row', () => {
    render(<RepTargetPicker {...repProps({ exerciseName: 'X'.repeat(80) })} />)
    const label = screen.getByRole('checkbox', { name: /^Use for all/ }).lastElementChild as HTMLElement
    expect(label.style.overflowWrap).toBe('anywhere')
    expect(label.style.minWidth).toBe('0px')
  })
})
