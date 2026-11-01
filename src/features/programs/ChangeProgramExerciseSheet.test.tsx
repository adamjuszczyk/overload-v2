// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { captureRender } from '../../testing/captureRender'
import type { WeightUnit } from '../../types'
import { pickTempo } from '../../components/pickers/tempoPicker.testutil'
import ChangeProgramExerciseSheet, { type ChangeProgramExerciseSheetProps } from './ChangeProgramExerciseSheet'

// Chunk 51a: the sheet behind an exercise's ⋯ (boards PL2 and PL3; PL9's rest states). It writes nothing: each control asks
// its callback for the next value, which is what the tests read. The rest rule is chunk 39's `stepRest` (15 s a step, 10:00 at most,
// "−" at 0:15 back to not set), and what the sheet adds is the states: GLOBAL / NONE when not set and the end stop at 10:00.
// Since 1.2.1 (chunk 79, SPEC Tempo picker [3]) the TEMPO row opens the tempo picker over the sheet in place of a text box and PL9's
// refusal for a half-typed tempo: the picker's own rules (four boxes, `normaliseTempo`'s text) are proven in TempoPicker.test.tsx, and
// here what the row asks its callback for.

afterEach(() => cleanup())

function props(over: Partial<ChangeProgramExerciseSheetProps> = {}): ChangeProgramExerciseSheetProps {
  return {
    workoutName: 'Pull 1',
    exerciseName: 'Lat Pulldown',
    unitWord: 'week',
    startWeek: 2,
    restSeconds: null,
    restAfterSeconds: null,
    tempo: null,
    weightUnit: null,
    onRestChange: vi.fn(),
    onRestAfterChange: vi.fn(),
    onTempoChange: vi.fn(),
    onUnitChange: vi.fn(),
    canMoveUp: true,
    canMoveDown: true,
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
}

const MEMBER = {
  blockLetter: 'A',
  otherNames: ['Seated Cable Row'],
  withinRoundSeconds: null,
  afterRoundSeconds: 90,
  onWithinRoundChange: vi.fn(),
  onAfterRoundChange: vi.fn(),
}

const sheet = () => screen.getByRole('dialog')

describe('PL2: an exercise’s sheet', () => {
  it('names the workout and the exercise, and says when the changes start', () => {
    render(<ChangeProgramExerciseSheet {...props()} />)
    expect(within(sheet()).getByText('PULL 1')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Lat Pulldown' })).toBeTruthy()
    expect(screen.getByText('Changes start in week 2. Swap, superset and remove are on the exercise card.')).toBeTruthy()
  })

  it('has REST, REST AFTER, TEMPO and UNIT in that order, and no round rests', () => {
    render(<ChangeProgramExerciseSheet {...props()} />)
    const labels = ['REST', 'REST AFTER', 'TEMPO', 'UNIT'].map((l) => screen.getByText(l))
    labels.slice(1).forEach((el, i) => expect(labels[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy())
    expect(screen.queryByText('WITHIN ROUND')).toBeNull()
    expect(screen.queryByText('AFTER ROUND')).toBeNull()
  })

  it('REST not set reads GLOBAL, REST AFTER not set reads NONE, and "−" has nowhere to go', () => {
    render(<ChangeProgramExerciseSheet {...props()} />)
    expect(screen.getByText('GLOBAL')).toBeTruthy()
    expect(screen.getByText('NONE')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Rest: less' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Rest after: less' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('"+" from not set asks for 0:15; "−" at 0:15 asks for not set; each step is 15 seconds', () => {
    const p = props({ restSeconds: null, restAfterSeconds: 15 })
    render(<ChangeProgramExerciseSheet {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rest: more' }))
    expect(p.onRestChange).toHaveBeenCalledWith(15)
    fireEvent.click(screen.getByRole('button', { name: 'Rest after: less' }))
    expect(p.onRestAfterChange).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Rest after: more' }))
    expect(p.onRestAfterChange).toHaveBeenCalledWith(30)
  })

  it('a rest that is set reads m:ss, and at 10:00 "+" is disabled', () => {
    render(<ChangeProgramExerciseSheet {...props({ restSeconds: 45, restAfterSeconds: 600 })} />)
    expect(screen.getByText('0:45')).toBeTruthy()
    expect(screen.getByText('10:00')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Rest: more' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Rest after: more' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('TEMPO: the row says the tempo set on the exercise, or —, and no text box is left in the sheet', () => {
    render(<ChangeProgramExerciseSheet {...props()} />)
    expect(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }).textContent).toBe('—')
    expect(screen.queryByRole('textbox')).toBeNull()
    cleanup()
    render(<ChangeProgramExerciseSheet {...props({ tempo: '3-1-1-0' })} />)
    expect(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }).textContent).toBe('3-1-1-0')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('TEMPO: a tap opens the tempo picker over the sheet, named for the exercise, on the tempo the exercise has', () => {
    render(<ChangeProgramExerciseSheet {...props({ tempo: '3-1-1-0' })} />)
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }))
    const picker = screen.getByRole('dialog', { name: 'Tempo' })
    expect(within(picker).getByText('Lat Pulldown')).toBeTruthy()
    expect((within(picker).getByRole('textbox', { name: 'Down seconds' }) as HTMLInputElement).value).toBe('3')
    expect(within(picker).getByRole('button', { name: 'SET TEMPO 3-1-1-0' })).toBeTruthy()
    // the exercise's sheet is still there under it
    expect(screen.getByRole('dialog', { name: 'Lat Pulldown' })).toBeTruthy()
  })

  it.each([
    ['SET on an exercise with no tempo: the start tempo', null, '3-0-1-0', '3-0-1-0'],
    ['a tempo changed in one box', '3-1-1-0', '3-1-X-0', '3-1-X-0'],
    ['NONE on an exercise that has one: null', '3-1-1-0', '', null],
  ] as const)('TEMPO: %s is asked of the callback once, and the picker closes', (_name, from, pick, asked) => {
    const p = props({ tempo: from })
    render(<ChangeProgramExerciseSheet {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }))
    pickTempo(screen.getByRole('dialog', { name: 'Tempo' }), pick)
    expect(p.onTempoChange).toHaveBeenCalledTimes(1)
    expect(p.onTempoChange).toHaveBeenCalledWith(asked)
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Lat Pulldown' })).toBeTruthy()
  })

  it('TEMPO: a valid pick is never asked as null (a tempo of four fields reaches the draft whole)', () => {
    const p = props({ tempo: null })
    render(<ChangeProgramExerciseSheet {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }))
    pickTempo(screen.getByRole('dialog', { name: 'Tempo' }), '2-0-X-1')
    expect(p.onTempoChange).not.toHaveBeenCalledWith(null)
    expect(p.onTempoChange).toHaveBeenCalledWith('2-0-X-1')
  })

  it('TEMPO: a pick that is the tempo already there asks for nothing, and the picker closes', () => {
    const p = props({ tempo: '3-1-1-0' })
    render(<ChangeProgramExerciseSheet {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Tempo' })).getByRole('button', { name: 'SET TEMPO 3-1-1-0' }))
    expect(p.onTempoChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
  })

  it('TEMPO: closing the picker (×, Escape) asks for nothing and leaves the exercise’s sheet open; Escape then closes the sheet', () => {
    const p = props({ tempo: '3-1-1-0' })
    render(<ChangeProgramExerciseSheet {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Tempo' })).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
    expect(p.onClose).not.toHaveBeenCalled() // Escape belonged to the picker, the sheet on top
    expect(p.onTempoChange).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it.each<[string, WeightUnit | null]>([
    ['DEFAULT', null],
    ['KG', 'kg'],
    ['LBS', 'lbs'],
  ])('UNIT: %s asks for %s, and the one that is set is the one pressed', (label, value) => {
    const p = props({ weightUnit: 'kg' })
    render(<ChangeProgramExerciseSheet {...p} />)
    expect(screen.getByRole('button', { name: 'KG' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'LBS' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'DEFAULT' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(p.onUnitChange).toHaveBeenCalledWith(value)
  })

  it('MOVE UP and MOVE DOWN are the fallback for dragging, disabled at the ends', () => {
    const p = props({ canMoveUp: false })
    render(<ChangeProgramExerciseSheet {...p} />)
    expect((screen.getByRole('button', { name: 'MOVE UP' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'MOVE DOWN' }))
    expect(p.onMoveDown).toHaveBeenCalledTimes(1)
    expect(p.onMoveUp).not.toHaveBeenCalled()
  })

  it('a sequence run says cycle', () => {
    render(<ChangeProgramExerciseSheet {...props({ unitWord: 'cycle', startWeek: 3 })} />)
    expect(screen.getByText('Changes start in cycle 3. Swap, superset and remove are on the exercise card.')).toBeTruthy()
  })

  it('the close button asks to close', () => {
    const p = props()
    render(<ChangeProgramExerciseSheet {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PL3: a superset member’s sheet', () => {
  it('adds WITHIN ROUND and AFTER ROUND below the member’s own four rows, and says whose they are', () => {
    render(<ChangeProgramExerciseSheet {...props({ exerciseName: 'Face Pull', member: MEMBER })} />)
    expect(within(sheet()).getByText('PULL 1 · SUPERSET A')).toBeTruthy()
    const order = ['REST', 'REST AFTER', 'TEMPO', 'UNIT', 'WITHIN ROUND', 'AFTER ROUND'].map((l) => screen.getByText(l))
    order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy())
    expect(screen.getByText('The two rests belong to superset A, so they change it for Seated Cable Row too. Changes start in week 2.')).toBeTruthy()
  })

  it('NO TIMER within a round and the exercise’s own rest after a round when not set; the block’s value reads m:ss', () => {
    render(<ChangeProgramExerciseSheet {...props({ member: { ...MEMBER, afterRoundSeconds: null } })} />)
    expect(screen.getByText('NO TIMER')).toBeTruthy()
    expect(screen.getByText('PER EXERCISE')).toBeTruthy()
    cleanup()
    render(<ChangeProgramExerciseSheet {...props({ member: MEMBER })} />)
    expect(screen.getByText('1:30')).toBeTruthy()
  })

  it('the round rests ask their own callbacks, not the exercise’s', () => {
    const member = { ...MEMBER, onWithinRoundChange: vi.fn(), onAfterRoundChange: vi.fn() }
    const p = props({ member })
    render(<ChangeProgramExerciseSheet {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Within round: more' }))
    fireEvent.click(screen.getByRole('button', { name: 'After round: less' }))
    expect(member.onWithinRoundChange).toHaveBeenCalledWith(15)
    expect(member.onAfterRoundChange).toHaveBeenCalledWith(75)
    expect(p.onRestChange).not.toHaveBeenCalled()
    expect(p.onRestAfterChange).not.toHaveBeenCalled()
  })

  it('three members: the note lists the others', () => {
    render(<ChangeProgramExerciseSheet {...props({ member: { ...MEMBER, otherNames: ['Seated Cable Row', 'Plank'] } })} />)
    expect(screen.getByText(/so they change it for Seated Cable Row and Plank too\./)).toBeTruthy()
  })
})

describe('draws PL9’s rest states, and the tempo picker over the sheet', () => {
  it('a rest that is set, one at 10:00, and a tempo that is set (PL9’s refusal for a half-typed tempo went with the text box)', () => {
    function Harness() {
      const [rest, setRest] = useState<number | null>(45)
      return <ChangeProgramExerciseSheet {...props({ restSeconds: rest, restAfterSeconds: 600, tempo: '3-0-1-0', onRestChange: setRest })} />
    }
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }).textContent).toBe('3-0-1-0')
    captureRender('change-program-rest-tempo-states', document.body)
  })

  it('the tempo picker over the exercise’s sheet (CHANGE THE PROGRAM; not drawn in the prototype)', () => {
    render(<ChangeProgramExerciseSheet {...props({ tempo: '3-1-1-0' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tempo for Lat Pulldown' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    captureRender('change-program-tempo-picker', document.body)
  })
})
