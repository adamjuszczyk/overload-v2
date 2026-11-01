// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import TempoPicker, { TEMPO_TEXT, type TempoPickerProps } from './TempoPicker'
import { textOnAccent } from '../../testing/textOnAccent'

// 1.2.1 chunk 79 (SPEC "Tempo picker [3]"): the sheet that sets an exercise's tempo, in the planner and in CHANGE THE PROGRAM. It writes nothing: the
// footer hands the caller the tempo in `normaliseTempo`'s form (four fields, X allowed) or null, which is what every test here reads. The sheet is the
// rep and RIR pickers' (their tests are in TargetPickers.test.tsx), so what is proven here is what tempo adds: four boxes of 0-20 or X, a − below 0 that
// gives X and a + from X that gives 0, and the text still in a box settled for the footer, a stepper and a segment before a blur comes.

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

function props(over: Partial<TempoPickerProps> = {}): TempoPickerProps {
  return { exerciseName: 'Seated Cable Row', value: null, onSubmit: vi.fn(), onClose: vi.fn(), ...over }
}

function open(over: Partial<TempoPickerProps> = {}) {
  const p = props(over)
  render(<TempoPicker {...p} />)
  return p
}

// DOWN · BOTTOM · UP · TOP, as the boxes are named
const PHASES = ['Down', 'Bottom', 'Up', 'Top'] as const
type Phase = (typeof PHASES)[number]

const boxEl = (phase: Phase) => screen.getByRole('textbox', { name: `${phase} seconds` }) as HTMLInputElement
const box = (phase: Phase) => boxEl(phase).value
const boxes = () => PHASES.map((phase) => box(phase))
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const footer = () => button(/^SET (TEMPO|NO TEMPO)/)
const typeInto = (phase: Phase, text: string) => fireEvent.change(boxEl(phase), { target: { value: text } })
const leave = (phase: Phase) => fireEvent.blur(boxEl(phase))
const submit = () => fireEvent.click(footer())
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('TempoPicker: the frame', () => {
  it('draws the picker: the exercise as eyebrow, the title Tempo, NONE | SET, four boxes in order each with − and + under it, the line and the footer', () => {
    open({ value: '3-1-1-0' })
    const dialog = screen.getByRole('dialog', { name: 'Tempo' })
    expect(dialog.textContent).toContain('Seated Cable Row')
    expect(screen.getByRole('heading', { level: 2, name: 'Tempo' })).toBeTruthy()
    const segments = Array.from(screen.getByRole('group', { name: 'Kind of tempo' }).querySelectorAll('button'))
    expect(segments.map((b) => b.textContent)).toEqual(['NONE', 'SET'])
    expect(segments.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(boxes()).toEqual(['3', '1', '1', '0'])
    // DOWN · BOTTOM · UP · TOP, each caption over its box, each box over its − and +
    const captions = ['DOWN', 'BOTTOM', 'UP', 'TOP'].map((c) => screen.getByText(c))
    const parts: Node[] = [segments[1]]
    PHASES.forEach((phase, i) => parts.push(captions[i], boxEl(phase), button(`${phase}: less`), button(`${phase}: more`)))
    parts.push(screen.getByText('Seconds per phase. X is as fast as you can.'), footer())
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    expect(footer().textContent).toBe('SET TEMPO 3-1-1-0')
  })

  it('an exercise with no tempo opens on NONE: it says so, draws no boxes, and the footer says SET NO TEMPO', () => {
    open({ value: null })
    expect(screen.getByRole('button', { name: 'NONE' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'SET' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(TEMPO_TEXT.noneNote)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(TEMPO_TEXT.note)).toBeNull()
    expect(footer().textContent).toBe('SET NO TEMPO')
  })

  it('an X in the stored tempo is in its box', () => {
    open({ value: 'X-0-1-X' })
    expect(boxes()).toEqual(['X', '0', '1', 'X'])
    expect(footer().textContent).toBe('SET TEMPO X-0-1-X')
  })

  it('×, a tap on the scrim and Escape ask to close and send nothing; the footer button does not close it', () => {
    const p = open({ value: '3-1-1-0' })
    fireEvent.click(button('Close'))
    fireEvent.click(document.querySelector('[data-bottom-sheet-scrim]') as HTMLElement)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(p.onClose).toHaveBeenCalledTimes(3)
    expect(p.onSubmit).not.toHaveBeenCalled()
    submit()
    expect(p.onSubmit).toHaveBeenCalledTimes(1)
    expect(p.onClose).toHaveBeenCalledTimes(3)
  })
})

describe('TempoPicker: what the footer hands back, path by path', () => {
  it('NONE asks for no tempo: the footer says SET NO TEMPO and the result is null, from a tempo that was set', () => {
    const p = open({ value: '3-1-1-0' })
    fireEvent.click(button('NONE'))
    expect(footer().textContent).toBe('SET NO TEMPO')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith(null)
  })

  it('SET on an exercise with no tempo starts from 3-0-1-0, and hands that back', () => {
    const p = open({ value: null })
    fireEvent.click(button('SET'))
    expect(boxes()).toEqual(['3', '0', '1', '0'])
    expect(footer().textContent).toBe('SET TEMPO 3-0-1-0')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('3-0-1-0')
  })

  it('a tempo that was set and is left as it is comes back as it was', () => {
    const p = open({ value: '2-0-2-0' })
    submit()
    expect(p.onSubmit).toHaveBeenCalledTimes(1)
    expect(p.onSubmit).toHaveBeenCalledWith('2-0-2-0')
  })

  it('− from 0 gives X in the box, the footer and the result', () => {
    const p = open({ value: '3-0-1-0' })
    fireEvent.click(button('Bottom: less'))
    expect(box('Bottom')).toBe('X')
    expect(footer().textContent).toBe('SET TEMPO 3-X-1-0')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('3-X-1-0')
  })

  it('+ from X gives 0 in the box, the footer and the result', () => {
    const p = open({ value: '3-X-1-0' })
    fireEvent.click(button('Bottom: more'))
    expect(box('Bottom')).toBe('0')
    expect(footer().textContent).toBe('SET TEMPO 3-0-1-0')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('3-0-1-0')
  })

  it('a typed x (lowercase) becomes an X in the box, the footer and the result', () => {
    const p = open({ value: '3-0-1-0' })
    typeInto('Up', 'x')
    leave('Up')
    expect(box('Up')).toBe('X')
    expect(footer().textContent).toBe('SET TEMPO 3-0-X-0')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('3-0-X-0')
  })

  it('a typed 25 is held to 20 when the box is left', () => {
    const p = open({ value: '3-0-1-0' })
    typeInto('Down', '25')
    expect(box('Down')).toBe('25') // nothing is clamped while it is typed
    leave('Down')
    expect(box('Down')).toBe('20')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('20-0-1-0')
  })

  it('a typed number inside 0-20 is taken as it is; a leading zero is dropped when the box is left', () => {
    const p = open({ value: '3-0-1-0' })
    typeInto('Top', '7')
    leave('Top')
    typeInto('Up', '05')
    leave('Up')
    expect(boxes()).toEqual(['3', '0', '5', '7'])
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('3-0-5-7')
  })
})

describe('TempoPicker: the four boxes', () => {
  // distinct numbers in the four boxes, so a step that reaches another box shows
  const START = [3, 5, 7, 9]
  const BOXES = PHASES.map((phase, i) => [phase, i] as const)
  const expected = (i: number, delta: number) => START.map((n, j) => (j === i ? n + delta : n)).join('-')

  it.each(BOXES)('%s: + steps that box alone, and the result carries it', (phase, i) => {
    const p = open({ value: START.join('-') })
    fireEvent.click(button(`${phase}: more`))
    expect(footer().textContent).toBe(`SET TEMPO ${expected(i, 1)}`)
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith(expected(i, 1))
  })

  it.each(BOXES)('%s: − steps that box alone, and the result carries it', (phase, i) => {
    const p = open({ value: START.join('-') })
    fireEvent.click(button(`${phase}: less`))
    expect(footer().textContent).toBe(`SET TEMPO ${expected(i, -1)}`)
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith(expected(i, -1))
  })

  it.each(BOXES)('%s: a number typed in that box alone is the one that changes', (phase, i) => {
    const p = open({ value: START.join('-') })
    typeInto(phase, '12')
    leave(phase)
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith(START.map((n, j) => (j === i ? 12 : n)).join('-'))
  })

  it('− at 0 goes to X in every box, one box at a time', () => {
    open({ value: '0-0-0-0' })
    PHASES.forEach((phase, i) => {
      fireEvent.click(button(`${phase}: less`))
      expect(boxes()).toEqual(['X', 'X', 'X', 'X'].map((x, j) => (j <= i ? x : '0')))
    })
  })

  it('the end stops: + is disabled at 20 and − at X, in every box, and a box one short of either still steps', () => {
    open({ value: '20-20-20-20' })
    for (const phase of PHASES) {
      expect(button(`${phase}: more`).disabled).toBe(true)
      expect(button(`${phase}: less`).disabled).toBe(false)
    }
    cleanup()
    open({ value: 'X-X-X-X' })
    for (const phase of PHASES) {
      expect(button(`${phase}: less`).disabled).toBe(true)
      expect(button(`${phase}: more`).disabled).toBe(false)
    }
    cleanup()
    const p = open({ value: '19-1-X-0' })
    expect(button('Down: more').disabled).toBe(false)
    expect(button('Bottom: less').disabled).toBe(false)
    fireEvent.click(button('Down: more'))
    expect(box('Down')).toBe('20')
    expect(button('Down: more').disabled).toBe(true)
    fireEvent.click(button('Bottom: less'))
    expect(box('Bottom')).toBe('0')
    fireEvent.click(button('Bottom: less'))
    expect(box('Bottom')).toBe('X')
    expect(button('Bottom: less').disabled).toBe(true)
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('20-X-X-0')
  })

  it('a tempo stored before 1.2.1 with a number past 20 shows as it is and is handed back as it is, until the box is stepped', () => {
    const p = open({ value: '30-0-1-0' })
    expect(box('Down')).toBe('30')
    expect(footer().textContent).toBe('SET TEMPO 30-0-1-0')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('30-0-1-0')
  })

  it.each(['more', 'less'] as const)('a step (%s) from a number past 20 puts the box to 20, the nearest number it can hold, whichever way it goes', (way) => {
    const p = open({ value: '30-0-1-0' })
    fireEvent.click(button(`Down: ${way}`))
    expect(box('Down')).toBe('20')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('20-0-1-0')
  })
})

describe('TempoPicker: text still in a box is settled for the footer, a stepper and a segment (Safari gives a tapped button no focus, so no blur comes first)', () => {
  it('the footer says and sets the typed number with the box never left', () => {
    const p = open({ value: '3-0-1-0' })
    typeInto('Down', '7')
    expect(footer().textContent).toBe('SET TEMPO 7-0-1-0')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('7-0-1-0')
  })

  it('the footer holds a typed 25 to 20 and reads a typed x as X, the box never left', () => {
    const p = open({ value: '3-0-1-0' })
    typeInto('Down', '25')
    typeInto('Top', 'x')
    expect(footer().textContent).toBe('SET TEMPO 20-0-1-X')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('20-0-1-X')
  })

  it('a stepper steps from the typed number, not from the number the box held before: typed 9, + gives 10', () => {
    open({ value: '3-0-1-0' })
    typeInto('Down', '9')
    fireEvent.click(button('Down: more'))
    expect(box('Down')).toBe('10')
    expect(footer().textContent).toBe('SET TEMPO 10-0-1-0')
  })

  it('a stepper settles the text of every other box too', () => {
    open({ value: '3-0-1-0' })
    typeInto('Top', '8')
    fireEvent.click(button('Down: more'))
    expect(boxes()).toEqual(['4', '0', '1', '8'])
  })

  it('a stepper beside a box with a typed 0 steps it to X', () => {
    open({ value: '3-5-1-0' })
    typeInto('Bottom', '0')
    fireEvent.click(button('Bottom: less'))
    expect(box('Bottom')).toBe('X')
  })

  it('a segment tap settles the text, and then clears it: 25 typed, NONE, SET shows 20, not the 25', () => {
    const p = open({ value: '3-0-1-0' })
    typeInto('Down', '25')
    fireEvent.click(button('NONE'))
    fireEvent.click(button('SET'))
    expect(box('Down')).toBe('20')
    expect(footer().textContent).toBe('SET TEMPO 20-0-1-0')
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith('20-0-1-0')
  })

  it('a segment tap settles the text the footer returns when it ends on NONE', () => {
    const p = open({ value: '3-0-1-0' })
    typeInto('Down', '12')
    fireEvent.click(button('NONE'))
    submit()
    expect(p.onSubmit).toHaveBeenCalledWith(null)
  })

  it('NONE, then SET again, brings back the numbers the exercise had', () => {
    open({ value: '4-0-2-X' })
    fireEvent.click(button('NONE'))
    fireEvent.click(button('SET'))
    expect(boxes()).toEqual(['4', '0', '2', 'X'])
  })

  it('a box left empty, or with text that is no number, goes back to what it held', () => {
    open({ value: '3-6-1-0' })
    typeInto('Bottom', '')
    expect(box('Bottom')).toBe('')
    leave('Bottom')
    expect(box('Bottom')).toBe('6')
    typeInto('Up', 'q')
    expect(box('Up')).toBe('') // letters other than X leave the box empty
    leave('Up')
    expect(box('Up')).toBe('1')
    expect(footer().textContent).toBe('SET TEMPO 3-6-1-0')
  })

  it('a box takes at most two digits, and an X wins over the digits beside it', () => {
    open({ value: '3-0-1-0' })
    typeInto('Down', '150')
    expect(box('Down')).toBe('15')
    typeInto('Down', '1x5')
    expect(box('Down')).toBe('X')
    typeInto('Down', 'X')
    expect(box('Down')).toBe('X')
  })

  it('Enter leaves the box, and leaving it settles what was typed', () => {
    open({ value: '3-0-1-0' })
    const down = boxEl('Down')
    act(() => down.focus())
    typeInto('Down', '25')
    fireEvent.keyDown(down, { key: 'Enter' })
    expect(document.activeElement).not.toBe(down)
    expect(box('Down')).toBe('20')
  })

  it('a box takes focus with its text selected, so typing replaces it, and the box with focus has the accent outline', () => {
    open({ value: '12-0-1-0' })
    const down = boxEl('Down')
    expect(down.style.borderColor).toBe('var(--border-strong)')
    expect(down.style.borderWidth).toBe('1px')
    act(() => down.focus())
    expect(down.selectionStart).toBe(0)
    expect(down.selectionEnd).toBe(2)
    expect(down.style.borderColor).toBe('var(--accent)')
    expect(down.style.borderWidth).toBe('2px')
    expect(boxEl('Bottom').style.borderColor).toBe('var(--border-strong)')
  })
})

describe('TempoPicker draws its text on the accent in --on-accent, never --base', () => {
  it('the picked segment and the footer button', () => {
    open({ value: '3-1-1-0' })
    const onAccent = textOnAccent(document.body)
    expect(onAccent.map((el) => el.textContent)).toEqual(['SET', 'SET TEMPO 3-1-1-0'])
    for (const el of onAccent) expect(el.style.color).toBe('var(--on-accent)')
  })

  it('moves with the choice: NONE picked is the one on the accent', () => {
    open({ value: '3-1-1-0' })
    fireEvent.click(button('NONE'))
    const onAccent = textOnAccent(document.body)
    expect(onAccent.map((el) => el.textContent)).toEqual(['NONE', 'SET NO TEMPO'])
    expect(button('SET').style.color).toBe('var(--text-secondary)')
    for (const el of onAccent) expect(el.style.color).toBe('var(--on-accent)')
  })
})

describe('a name with no break opportunity wraps inside the tempo picker', () => {
  it('the eyebrow carries an 80-letter exercise name and keeps it inside its line', () => {
    open({ exerciseName: 'X'.repeat(80) })
    const eyebrow = screen.getByText('X'.repeat(80))
    expect(eyebrow.style.overflowWrap).toBe('anywhere')
  })
})
