// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import SetTypePicker from './SetTypePicker'
import type { SetTypePickerProps } from './SetTypePicker'
import { STAGE_COUNT_MAX, cuesSummary, type SetType } from './pickerLogic'
import { captureRender } from '../../testing/captureRender'
import { textOnAccent } from '../../testing/textOnAccent'

// TASKS-1.2 chunk 39: the set type picker (boards 5, PP3c, W7a). It writes nothing; these tests assert
// what each variant draws (SPEC "Rest [1.2]", "Set types and staged sets [1.2]", G55) and the value
// each tap asks its caller for. The renders in "draws board ..." are the fixtures for the 390 px
// screenshots in design/1.2/built/.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const noop = () => {}

const staged = (stageKind: Extract<SetType, { kind: 'staged' }>['stageKind'], stageCount = 1, stageRestSeconds: number | null = null): SetType => ({
  kind: 'staged',
  stageKind,
  stageCount,
  stageRestSeconds,
})

function props(over: Partial<SetTypePickerProps> = {}): SetTypePickerProps {
  return {
    context: 'plan-week-dependent',
    exerciseName: 'Lat Pulldown',
    setNumber: 3,
    weekNumber: 2,
    value: { kind: 'normal' },
    onChange: noop,
    onClose: noop,
    ...over,
  }
}

// Every handler a caller can give, so a row that is absent is absent because of the variant, not
// because nothing could be done with it.
function fullProps(over: Partial<SetTypePickerProps> = {}): SetTypePickerProps {
  return props({ canEditRest: true, restAfterSeconds: null, onRestAfterChange: noop, cues: ['push here'], onCues: noop, onRemove: noop, ...over })
}

/** What the page behind board 5 shows, under the scrim. */
function PageBehind({ title }: { title: string }) {
  const card = { borderRadius: 12, background: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' } as const
  return (
    <div aria-hidden="true" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, color: 'var(--text-primary)' }}>{title}</span>
      <div style={{ ...card, height: 52 }} />
      <div style={{ ...card, height: 300 }} />
    </div>
  )
}

const list = () => screen.getByRole('group', { name: 'Set type' })
const optionButtons = () => Array.from(list().querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
const optionName = (button: HTMLElement) => button.lastElementChild?.firstElementChild?.textContent ?? ''
const option = (name: RegExp | string) => screen.getByRole('button', { name })
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

/** The optional rows that are on screen. */
function drawn() {
  return {
    restBetween: screen.queryByText('REST BETWEEN') !== null,
    restAfter: screen.queryByText('Rest after this set') !== null,
    cues: screen.queryByRole('button', { name: /^Cues/ }) !== null,
    remove: screen.queryByRole('button', { name: 'REMOVE THIS SET' }) !== null,
    workoutNote: screen.queryByText(/^Changes this workout only/) !== null,
    stageStepper: screen.queryByRole('button', { name: 'More drops' }) !== null,
  }
}

describe('SetTypePicker: the frame', () => {
  it("draws board 5: the eyebrow, the title, the six types in order, Rest after this set, Cues, REMOVE THIS SET", () => {
    render(
      <>
        <PageBehind title="PLAN" />
        <SetTypePicker {...fullProps({ value: staged('dropset'), cues: ['push here'] })} />
      </>,
    )
    const dialog = screen.getByRole('dialog', { name: 'What is this set?' })
    expect(within(dialog).getByText('Lat Pulldown · SET 03 · WEEK 2')).toBeTruthy()
    expect(optionButtons().map(optionName)).toEqual(['Normal', 'Warmup', 'Dropset', 'Rest-pause', 'Myo-reps', 'Cluster'])
    expect(optionButtons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false'])
    const parts = [
      within(dialog).getByText('Lat Pulldown · SET 03 · WEEK 2'),
      within(dialog).getByRole('heading', { level: 2, name: 'What is this set?' }),
      option(/^Normal/),
      option(/^Dropset/),
      within(dialog).getByText('DROPS'),
      within(dialog).getByText('REST BETWEEN'),
      option(/^Rest-pause/),
      option(/^Cluster/),
      within(dialog).getByText('Rest after this set'),
      within(dialog).getByText('Every week from now on.'),
      option(/^Cues/),
      within(dialog).getByText('Push here'),
      option('REMOVE THIS SET'),
    ]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    expect(within(dialog).getByText('DEFAULT')).toBeTruthy()
    expect(within(dialog).getByText('NO TIMER')).toBeTruthy()
    captureRender('picker-5', document.body)
  })

  it("draws PP3c: the stepped planner's picker, no week, no rest after, no Cues", () => {
    render(
      <>
        <PageBehind title="BULK" />
        <SetTypePicker {...fullProps({ context: 'planner', exerciseName: 'Incline Dumbbell Press', setNumber: 4, weekNumber: undefined, value: staged('dropset') })} />
      </>,
    )
    expect(screen.getByText('Incline Dumbbell Press · SET 04')).toBeTruthy()
    expect(drawn()).toEqual({ restBetween: true, restAfter: false, cues: false, remove: true, workoutNote: false, stageStepper: true })
    captureRender('picker-pp3c', document.body)
  })

  it('draws W7a: the workout\'s picker, the types and the stepper, then the line that says the change is this workout only', () => {
    render(
      <>
        <PageBehind title="PULL 1" />
        <SetTypePicker {...fullProps({ context: 'workout', value: staged('dropset') })} />
      </>,
    )
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Lat Pulldown · SET 03 · THIS WORKOUT')).toBeTruthy()
    expect(drawn()).toEqual({ restBetween: false, restAfter: false, cues: false, remove: false, workoutNote: true, stageStepper: true })
    const note = within(dialog).getByText("Changes this workout only. Next week's plan stays as it is; the change shows up in REVIEW when you plan it.")
    expect(follows(option(/^Cluster/), note)).toBe(true)
    // the line is outside what scrolls, under it (BottomSheet's footer)
    const content = list().parentElement?.parentElement as HTMLElement
    expect(content.contains(note)).toBe(false)
    captureRender('picker-w7a', document.body)
  })

  it('names the eyebrow by variant: WEEK N in Plan, CYCLE N on a sequence program, THIS WORKOUT in the workout, no week elsewhere', () => {
    const eyebrow = (over: Partial<SetTypePickerProps>) => {
      const { unmount } = render(<SetTypePicker {...props(over)} />)
      const text = within(screen.getByRole('dialog')).getByText(/· SET 03/).textContent
      unmount()
      return text
    }
    expect(eyebrow({ context: 'plan-week-dependent' })).toBe('Lat Pulldown · SET 03 · WEEK 2')
    expect(eyebrow({ context: 'plan-stable' })).toBe('Lat Pulldown · SET 03 · WEEK 2')
    expect(eyebrow({ context: 'plan-stable', isCycle: true })).toBe('Lat Pulldown · SET 03 · CYCLE 2')
    expect(eyebrow({ context: 'workout' })).toBe('Lat Pulldown · SET 03 · THIS WORKOUT')
    expect(eyebrow({ context: 'planner' })).toBe('Lat Pulldown · SET 03')
    expect(eyebrow({ context: 'change-program' })).toBe('Lat Pulldown · SET 03')
  })

  it('× , a tap on the scrim and Escape ask to close', () => {
    const onClose = vi.fn()
    render(<SetTypePicker {...props({ onClose })} />)
    fireEvent.click(button('Close'))
    fireEvent.click(document.querySelector('[data-bottom-sheet-scrim]') as HTMLElement)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('SetTypePicker: the row that is picked', () => {
  it('marks exactly the row the value is: Normal, Warmup, or the stage kind', () => {
    const cases: [SetType, string][] = [
      [{ kind: 'normal' }, 'Normal'],
      [{ kind: 'warmup' }, 'Warmup'],
      [staged('dropset'), 'Dropset'],
      [staged('rest_pause'), 'Rest-pause'],
      [staged('myo_reps'), 'Myo-reps'],
      [staged('cluster'), 'Cluster'],
    ]
    for (const [value, name] of cases) {
      const { unmount } = render(<SetTypePicker {...props({ value })} />)
      const pressed = optionButtons().filter((b) => b.getAttribute('aria-pressed') === 'true')
      expect(pressed.map(optionName)).toEqual([name])
      unmount()
    }
  })

  it("shows what is true, not what was tapped: a caller that doesn't take the change leaves the old type drawn", () => {
    const onChange = vi.fn()
    render(<SetTypePicker {...props({ value: { kind: 'normal' }, onChange })} />)
    fireEvent.click(option(/^Warmup/))
    expect(onChange).toHaveBeenCalledWith({ kind: 'warmup' })
    expect(optionButtons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false'])
  })

  it('follows the value the caller passes back', () => {
    function Caller() {
      const [value, setValue] = useState<SetType>({ kind: 'normal' })
      return <SetTypePicker {...props({ value, onChange: setValue })} />
    }
    render(<Caller />)
    fireEvent.click(option(/^Myo-reps/))
    expect(optionButtons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false', 'true', 'false'])
    expect(screen.getByText('MINI-SETS')).toBeTruthy()
  })
})

describe('SetTypePicker: what a tap asks for', () => {
  it('Normal and Warmup from a staged set drop its stages', () => {
    const onChange = vi.fn()
    render(<SetTypePicker {...props({ value: staged('dropset', 2), onChange })} />)
    fireEvent.click(option(/^Warmup/))
    fireEvent.click(option(/^Normal/))
    expect(onChange.mock.calls).toEqual([[{ kind: 'warmup' }], [{ kind: 'normal' }]])
  })

  it('a staged kind from a plain set starts at one stage on the kind\'s own rest', () => {
    for (const [name, stageKind] of [
      [/^Dropset/, 'dropset'],
      [/^Rest-pause/, 'rest_pause'],
      [/^Myo-reps/, 'myo_reps'],
      [/^Cluster/, 'cluster'],
    ] as const) {
      const onChange = vi.fn()
      const { unmount } = render(<SetTypePicker {...props({ onChange })} />)
      fireEvent.click(option(name))
      expect(onChange).toHaveBeenCalledWith({ kind: 'staged', stageKind, stageCount: 1, stageRestSeconds: null })
      unmount()
    }
  })

  it('a staged kind from a warmup starts at one stage too', () => {
    const onChange = vi.fn()
    render(<SetTypePicker {...props({ value: { kind: 'warmup' }, onChange })} />)
    fireEvent.click(option(/^Dropset/))
    expect(onChange).toHaveBeenCalledWith(staged('dropset', 1, null))
  })

  it('Cluster from a dropset with 3 drops keeps the 3', () => {
    const onChange = vi.fn()
    render(<SetTypePicker {...props({ value: staged('dropset', 3), onChange })} />)
    fireEvent.click(option(/^Cluster/))
    expect(onChange).toHaveBeenCalledWith(staged('cluster', 3, null))
  })

  it("keeps a set's own rest between stages when the kind changes", () => {
    const onChange = vi.fn()
    render(<SetTypePicker {...props({ context: 'planner', value: staged('dropset', 2, 45), onChange })} />)
    fireEvent.click(option(/^Myo-reps/))
    expect(onChange).toHaveBeenCalledWith(staged('myo_reps', 2, 45))
  })

  it('a tap on the row already picked asks for nothing', () => {
    const onChange = vi.fn()
    render(<SetTypePicker {...props({ value: staged('dropset', 2), onChange })} />)
    fireEvent.click(option(/^Dropset/))
    expect(onChange).not.toHaveBeenCalled()
    cleanup()
    render(<SetTypePicker {...props({ value: { kind: 'warmup' }, onChange })} />)
    fireEvent.click(option(/^Warmup/))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SetTypePicker: the rows each variant draws', () => {
  it('Plan, week-dependent: the stepper, REST BETWEEN, Rest after this set, Cues and REMOVE THIS SET', () => {
    render(<SetTypePicker {...fullProps({ context: 'plan-week-dependent', value: staged('dropset') })} />)
    expect(drawn()).toEqual({ restBetween: true, restAfter: true, cues: true, remove: true, workoutNote: false, stageStepper: true })
  })

  it('Plan, week-dependent, on a set with no program set of its own exercise: no rest row and no REST BETWEEN', () => {
    render(<SetTypePicker {...fullProps({ context: 'plan-week-dependent', canEditRest: false, value: staged('dropset') })} />)
    expect(drawn()).toEqual({ restBetween: false, restAfter: false, cues: true, remove: true, workoutNote: false, stageStepper: true })
  })

  it('Plan, week-dependent: the caller has to say the set can edit rest; without it there is no rest row and no REST BETWEEN', () => {
    render(<SetTypePicker {...props({ context: 'plan-week-dependent', value: staged('dropset'), restAfterSeconds: null, onRestAfterChange: noop, onCues: noop, onRemove: noop })} />)
    expect(drawn()).toEqual({ restBetween: false, restAfter: false, cues: true, remove: true, workoutNote: false, stageStepper: true })
  })

  it('Plan, stable: the stepper but no REST BETWEEN and no rest row, even when the caller can edit rest', () => {
    render(<SetTypePicker {...fullProps({ context: 'plan-stable', canEditRest: true, value: staged('dropset') })} />)
    expect(drawn()).toEqual({ restBetween: false, restAfter: false, cues: true, remove: true, workoutNote: false, stageStepper: true })
  })

  it('the stepped planner: the stepper, REST BETWEEN and REMOVE THIS SET; no rest after, no Cues', () => {
    render(<SetTypePicker {...fullProps({ context: 'planner', value: staged('dropset') })} />)
    expect(drawn()).toEqual({ restBetween: true, restAfter: false, cues: false, remove: true, workoutNote: false, stageStepper: true })
  })

  it('CHANGE THE PROGRAM: the stepper, REST BETWEEN and REMOVE THIS SET; no rest after, no Cues', () => {
    render(<SetTypePicker {...fullProps({ context: 'change-program', value: staged('dropset') })} />)
    expect(drawn()).toEqual({ restBetween: true, restAfter: false, cues: false, remove: true, workoutNote: false, stageStepper: true })
  })

  it('the workout: the types and the stepper and the one line, nothing else, though every handler was given', () => {
    render(<SetTypePicker {...fullProps({ context: 'workout', value: staged('dropset') })} />)
    expect(drawn()).toEqual({ restBetween: false, restAfter: false, cues: false, remove: false, workoutNote: true, stageStepper: true })
    // the six types are all there
    expect(optionButtons()).toHaveLength(6)
  })

  it('draws a row that needs a handler only when it has one: no dead control', () => {
    render(<SetTypePicker {...props({ context: 'plan-week-dependent', canEditRest: true, value: staged('dropset') })} />)
    expect(drawn()).toEqual({ restBetween: true, restAfter: false, cues: false, remove: false, workoutNote: false, stageStepper: true })
  })

  it('the stage stepper is drawn only under a picked staged kind', () => {
    for (const value of [{ kind: 'normal' }, { kind: 'warmup' }] as SetType[]) {
      const { unmount } = render(<SetTypePicker {...fullProps({ value })} />)
      expect(drawn().stageStepper).toBe(false)
      expect(drawn().restBetween).toBe(false)
      unmount()
    }
    render(<SetTypePicker {...fullProps({ value: staged('cluster') })} />)
    // under Cluster's row, not under Dropset's
    expect(screen.queryByRole('button', { name: 'More drops' })).toBeNull()
    expect(screen.getAllByText('CLUSTERS')).toHaveLength(1)
    expect(option(/^Cluster/).parentElement?.contains(screen.getByText('CLUSTERS'))).toBe(true)
  })
})

describe('SetTypePicker: a warmup row in Plan (G55)', () => {
  it('offers Normal and Warmup only, and still the rest row, Cues and REMOVE THIS SET', () => {
    render(<SetTypePicker {...fullProps({ allowedKinds: ['normal', 'warmup'], value: { kind: 'warmup' } })} />)
    expect(optionButtons().map(optionName)).toEqual(['Normal', 'Warmup'])
    expect(screen.queryByRole('button', { name: /^Dropset/ })).toBeNull()
    expect(drawn()).toEqual({ restBetween: false, restAfter: true, cues: true, remove: true, workoutNote: false, stageStepper: false })
  })

  it('offers all six when nothing restricts it', () => {
    render(<SetTypePicker {...fullProps()} />)
    expect(optionButtons().map(optionName)).toEqual(['Normal', 'Warmup', 'Dropset', 'Rest-pause', 'Myo-reps', 'Cluster'])
  })
})

describe('SetTypePicker: the stage stepper', () => {
  it.each([
    ['dropset', 'Dropset', 'DROPS', 'drops'],
    ['rest_pause', 'Rest-pause', 'PAUSES', 'pauses'],
    ['myo_reps', 'Myo-reps', 'MINI-SETS', 'mini-sets'],
    ['cluster', 'Cluster', 'CLUSTERS', 'clusters'],
  ] as const)('%s counts its stages as %s', (stageKind, rowName, label, word) => {
    const onChange = vi.fn()
    render(<SetTypePicker {...props({ value: staged(stageKind, 2), onChange })} />)
    // under its own row, with the count it has
    const row = option(new RegExp(`^${rowName}`)).parentElement as HTMLElement
    expect(within(row).getByText(label)).toBeTruthy()
    expect(within(row).getByText('2')).toBeTruthy()
    fireEvent.click(button(`More ${word}`))
    fireEvent.click(button(`Fewer ${word}`))
    expect(onChange.mock.calls).toEqual([[staged(stageKind, 3)], [staged(stageKind, 1)]])
  })

  it('keeps the rest between stages when it changes the count', () => {
    const onChange = vi.fn()
    render(<SetTypePicker {...props({ value: staged('cluster', 2, 45), onChange })} />)
    fireEvent.click(button('More clusters'))
    expect(onChange).toHaveBeenCalledWith(staged('cluster', 3, 45))
  })

  it('never goes below one stage and stops at the top', () => {
    const { rerender } = render(<SetTypePicker {...props({ value: staged('dropset', 1) })} />)
    expect(button('Fewer drops').disabled).toBe(true)
    expect(button('More drops').disabled).toBe(false)
    rerender(<SetTypePicker {...props({ value: staged('dropset', STAGE_COUNT_MAX) })} />)
    expect(button('More drops').disabled).toBe(true)
    expect(button('Fewer drops').disabled).toBe(false)
  })
})

describe('SetTypePicker: REST BETWEEN', () => {
  it("reads the kind's own default until the set has one: NO TIMER for a dropset, 0:15 for the others", () => {
    const text = (value: SetType) => {
      const { unmount } = render(<SetTypePicker {...props({ context: 'planner', value })} />)
      const caption = screen.getByText('REST BETWEEN')
      const result = caption.nextElementSibling?.querySelector('span')?.textContent
      unmount()
      return result
    }
    expect(text(staged('dropset'))).toBe('NO TIMER')
    expect(text(staged('rest_pause'))).toBe('0:15')
    expect(text(staged('myo_reps'))).toBe('0:15')
    expect(text(staged('cluster'))).toBe('0:15')
    expect(text(staged('dropset', 1, 45))).toBe('0:45')
    expect(text(staged('cluster', 1, 90))).toBe('1:30')
  })

  it('+ and - ask for the next rest between stages, and - on the default does nothing', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SetTypePicker {...props({ context: 'change-program', value: staged('dropset'), onChange })} />)
    expect(button('Rest between: less').disabled).toBe(true)
    fireEvent.click(button('Rest between: more'))
    expect(onChange).toHaveBeenLastCalledWith(staged('dropset', 1, 15))
    rerender(<SetTypePicker {...props({ context: 'change-program', value: staged('dropset', 1, 15), onChange })} />)
    expect(button('Rest between: less').disabled).toBe(false)
    fireEvent.click(button('Rest between: less'))
    expect(onChange).toHaveBeenLastCalledWith(staged('dropset', 1, null))
    // a kind whose default is 15 s starts a step past it
    rerender(<SetTypePicker {...props({ context: 'change-program', value: staged('cluster'), onChange })} />)
    fireEvent.click(button('Rest between: more'))
    expect(onChange).toHaveBeenLastCalledWith(staged('cluster', 1, 30))
  })
})

describe('SetTypePicker: the rest steppers stop at 10 minutes', () => {
  it('REST BETWEEN: + does nothing at 10:00 and - still works', () => {
    render(<SetTypePicker {...props({ context: 'planner', value: staged('cluster', 1, 600) })} />)
    expect(screen.getByText('10:00')).toBeTruthy()
    expect(button('Rest between: more').disabled).toBe(true)
    expect(button('Rest between: less').disabled).toBe(false)
  })

  it('Rest after this set: + does nothing at 10:00 and - still works', () => {
    render(<SetTypePicker {...fullProps({ restAfterSeconds: 600 })} />)
    expect(screen.getByText('10:00')).toBeTruthy()
    expect(button('Rest after this set: more').disabled).toBe(true)
    expect(button('Rest after this set: less').disabled).toBe(false)
  })
})

describe('SetTypePicker: Rest after this set', () => {
  it('reads DEFAULT while the set has none of its own, and says it holds every week from now on', () => {
    render(<SetTypePicker {...fullProps({ restAfterSeconds: null })} />)
    expect(screen.getByText('DEFAULT')).toBeTruthy()
    expect(screen.getByText('Every week from now on.')).toBeTruthy()
    expect(button('Rest after this set: less').disabled).toBe(true)
  })

  it('treats a missing value as DEFAULT too', () => {
    render(<SetTypePicker {...fullProps({ restAfterSeconds: undefined })} />)
    expect(screen.getByText('DEFAULT')).toBeTruthy()
  })

  it('+ asks for 15 s from the default, - for the step below, and - back to the default asks for null', () => {
    const onRestAfterChange = vi.fn()
    const { rerender } = render(<SetTypePicker {...fullProps({ restAfterSeconds: null, onRestAfterChange })} />)
    fireEvent.click(button('Rest after this set: more'))
    expect(onRestAfterChange).toHaveBeenLastCalledWith(15)
    rerender(<SetTypePicker {...fullProps({ restAfterSeconds: 120, onRestAfterChange })} />)
    expect(screen.getByText('2:00')).toBeTruthy()
    fireEvent.click(button('Rest after this set: less'))
    expect(onRestAfterChange).toHaveBeenLastCalledWith(105)
    fireEvent.click(button('Rest after this set: more'))
    expect(onRestAfterChange).toHaveBeenLastCalledWith(135)
    rerender(<SetTypePicker {...fullProps({ restAfterSeconds: 15, onRestAfterChange })} />)
    fireEvent.click(button('Rest after this set: less'))
    expect(onRestAfterChange).toHaveBeenLastCalledWith(null)
  })
})

describe('SetTypePicker: Cues and REMOVE THIS SET', () => {
  it("shows the set's cues on the Cues row's second line and opens the cues sheet when tapped", () => {
    const onCues = vi.fn()
    render(<SetTypePicker {...fullProps({ cues: ['push here', 'focus on execution'], onCues })} />)
    expect(screen.getByText('Push here, Focus on execution')).toBeTruthy()
    fireEvent.click(option(/^Cues/))
    expect(onCues).toHaveBeenCalledTimes(1)
  })

  it('shows nothing under Cues for a set with none', () => {
    render(<SetTypePicker {...fullProps({ cues: [] })} />)
    expect(option(/^Cues/).textContent).toBe('Cues')
  })

  it('REMOVE THIS SET asks the caller to remove it, once', () => {
    const onRemove = vi.fn()
    render(<SetTypePicker {...fullProps({ onRemove })} />)
    fireEvent.click(option('REMOVE THIS SET'))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})

describe('SetTypePicker: one long word (DECISIONS 128 (i), Adam 2026-10-15)', () => {
  // A custom cue can be one long word; jsdom lays nothing out, so this holds the rule that wraps it and the fixture it
  // captures is measured in Chromium at 375 px by `node scripts/check-sheet-overflow.mjs`.
  const LONG_CUE = 'X'.repeat(60)

  it("the Cues row's second line wraps a cue of one long word inside its row", () => {
    render(<SetTypePicker {...fullProps({ value: staged('dropset'), cues: [LONG_CUE, 'push here'] })} />)
    // captured before anything is asserted, so a fixture is written even when a rule is broken (the Chromium check needs one)
    captureRender('picker-5-long-cue', document.body)
    const line = screen.getByText(cuesSummary([LONG_CUE, 'push here']))
    expect(line.style.overflowWrap).toBe('anywhere')
    // its column can shrink below the word, which is what lets the line wrap beside the chevron
    expect((line.parentElement as HTMLElement).style.minWidth).toBe('0px')
  })

  it('the exercise name in the eyebrow is wrapped by the sheet frame', () => {
    render(<SetTypePicker {...fullProps({ exerciseName: 'X'.repeat(80) })} />)
    expect(within(screen.getByRole('dialog')).getByText(/^X+ · SET 03 · WEEK 2$/).style.overflowWrap).toBe('anywhere')
  })
})

describe('SetTypePicker: text on the accent', () => {
  it('draws nothing to read on the accent: its only accent fill is the radio dot, which holds nothing', () => {
    render(<SetTypePicker {...fullProps({ value: staged('dropset') })} />)
    expect(document.body.querySelectorAll('[style*="var(--accent)"]').length).toBeGreaterThan(0)
    expect(textOnAccent(document.body)).toEqual([])
  })
})
