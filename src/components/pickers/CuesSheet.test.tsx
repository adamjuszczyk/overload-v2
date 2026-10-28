// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import CuesSheet from './CuesSheet'
import type { CuesSheetProps, CuesSheetResult } from './CuesSheet'
import SetTypePicker from './SetTypePicker'
import type { TargetableSet } from './pickerLogic'
import { applyTagToAllHeads } from '../../lib/plannerVocabulary'
import { captureRender } from '../../testing/captureRender'
import { textOnAccent } from '../../testing/textOnAccent'

// TASKS-1.2 chunk 40: the cues sheet (board 8). It writes nothing: DONE returns the set's cues and whether
// "Use for all" was ticked. These tests assert what the sheet draws (SPEC "Tags [1.2]"), where each part
// of it comes from (the set's own cues, the run's tags, the typed text, the exercise's sets) and what
// DONE hands back. The render in "draws board 8" is the fixture for the 390 px screenshot in design/1.2/built/.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const noop = () => {}

/** The exercise's head sets, `true` for a warmup: board 8's exercise has three working sets. */
const heads = (...warmups: boolean[]): TargetableSet[] => warmups.map((isWarmup, i) => ({ id: `set-${i + 1}`, isWarmup }))

const THREE_WORKING = heads(false, false, false)

function props(over: Partial<CuesSheetProps> = {}): CuesSheetProps {
  return {
    exerciseName: 'Lat Pulldown',
    setNumber: 3,
    weekNumber: 2,
    value: ['push here'],
    runCues: ['1-sec pause at the bottom'],
    sets: THREE_WORKING,
    onDone: noop,
    onClose: noop,
    ...over,
  }
}

/** What the page behind board 8 shows, under the scrim. */
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
const list = () => screen.getByRole('group', { name: 'Cues' })
const rows = () => within(list()).getAllByRole('checkbox') as HTMLButtonElement[]
/** A row's text: the tick box is its first child, the label the second, YOURS the third. */
const label = (row: HTMLElement) => row.children[1].textContent
const marker = (row: HTMLElement) => row.children[2]?.textContent ?? null
const rowLabels = () => rows().map(label)
const tickedLabels = () => rows().filter((row) => row.getAttribute('aria-checked') === 'true').map(label)
const row = (name: string) => rows().find((r) => label(r) === name) as HTMLButtonElement
const useForAll = () => screen.queryByRole('checkbox', { name: /^Use for all/ })
const done = () => button('DONE')
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const input = () => screen.getByRole('textbox', { name: 'New cue' }) as HTMLInputElement

/** Opens "+ NEW CUE" if it isn't open, types `text` and confirms it with Enter or the ADD button. */
function addCue(text: string, how: 'enter' | 'add' = 'enter') {
  if (!screen.queryByRole('textbox', { name: 'New cue' })) fireEvent.click(button('+ NEW CUE'))
  fireEvent.change(input(), { target: { value: text } })
  if (how === 'enter') fireEvent.keyDown(input(), { key: 'Enter' })
  else fireEvent.click(button('ADD'))
}

/** Renders the sheet, does what `act` says, taps DONE once and returns what it handed over; the sheet is gone afterwards, so a test can ask again. */
function doneWith(over: Partial<CuesSheetProps>, act: () => void): CuesSheetResult {
  const onDone = vi.fn()
  const { unmount } = render(<CuesSheet {...props({ ...over, onDone })} />)
  act()
  fireEvent.click(done())
  expect(onDone).toHaveBeenCalledTimes(1)
  unmount()
  return onDone.mock.calls[0][0] as CuesSheetResult
}

describe('CuesSheet: the frame', () => {
  it('draws board 8: the eyebrow, the title, the line, five rows with Push here ticked and one YOURS, + NEW CUE, "Use for all" unticked, DONE', () => {
    render(
      <>
        <PageBehind title="PLAN" />
        <CuesSheet {...props()} />
      </>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Cues for this set' })
    expect(within(dialog).getByText('Lat Pulldown · SET 03 · WEEK 2')).toBeTruthy()
    expect(rowLabels()).toEqual(['Push here', 'Maintain strength', 'Focus on execution', 'Push back', '1-sec pause at the bottom'])
    expect(tickedLabels()).toEqual(['Push here'])
    expect(rows().map(marker)).toEqual([null, null, null, null, 'YOURS'])
    expect((useForAll() as HTMLElement).getAttribute('aria-checked')).toBe('false')
    const parts = [
      within(dialog).getByText('Lat Pulldown · SET 03 · WEEK 2'),
      within(dialog).getByRole('heading', { level: 2, name: 'Cues for this set' }),
      within(dialog).getByText("Shown on the set when it's next in the workout. Not copied to next week."),
      rows()[0],
      rows()[4],
      button('+ NEW CUE'),
      screen.getByRole('checkbox', { name: 'Use for all 3 sets of Lat Pulldown' }),
      done(),
    ]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    // DONE is the sheet's footer: under the content, outside what scrolls
    expect(list().parentElement?.contains(done())).toBe(false)
    captureRender('cues-8', document.body)
  })

  it('names the eyebrow: WEEK N, CYCLE N on a sequence program, no week where there is none to give', () => {
    const eyebrow = (over: Partial<CuesSheetProps>) => {
      const { unmount } = render(<CuesSheet {...props(over)} />)
      const text = within(screen.getByRole('dialog')).getByText(/· SET 03/).textContent
      unmount()
      return text
    }
    expect(eyebrow({})).toBe('Lat Pulldown · SET 03 · WEEK 2')
    expect(eyebrow({ isCycle: true })).toBe('Lat Pulldown · SET 03 · CYCLE 2')
    expect(eyebrow({ weekNumber: undefined })).toBe('Lat Pulldown · SET 03')
  })

  it('× , a tap on the scrim and Escape ask to close and send nothing; DONE sends once and does not close it', () => {
    const onClose = vi.fn()
    const onDone = vi.fn()
    render(<CuesSheet {...props({ onClose, onDone })} />)
    fireEvent.click(button('Close'))
    fireEvent.click(document.querySelector('[data-bottom-sheet-scrim]') as HTMLElement)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(done())
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('CuesSheet: the list', () => {
  it('lists the four presets in PRESET_TAGS order, each as it reads on the set (a capital first letter)', () => {
    render(<CuesSheet {...props({ value: [], runCues: [] })} />)
    expect(rowLabels()).toEqual(['Push here', 'Maintain strength', 'Focus on execution', 'Push back'])
  })

  it("ticks what the set has, not what the run has: the run's tags only decide which of the user's own cues are offered", () => {
    render(<CuesSheet {...props({ value: ['maintain strength'], runCues: ['pause at the end', 'push here', '1-sec pause at the bottom', 'pause at the end'] })} />)
    expect(tickedLabels()).toEqual(['Maintain strength'])
    // the run's own cues, once each, in the run's order after the presets; the run's use of a preset adds no row
    expect(rowLabels()).toEqual(['Push here', 'Maintain strength', 'Focus on execution', 'Push back', 'Pause at the end', '1-sec pause at the bottom'])
    expect(rows().map(marker)).toEqual([null, null, null, null, 'YOURS', 'YOURS'])
  })

  it("lists a cue of the set's own after the run's, when the run's tags don't hold it", () => {
    render(<CuesSheet {...props({ value: ['my own cue', 'push here'], runCues: ['pause at the end', '1-sec pause at the bottom'] })} />)
    expect(rowLabels()).toEqual(['Push here', 'Maintain strength', 'Focus on execution', 'Push back', 'Pause at the end', '1-sec pause at the bottom', 'My own cue'])
    expect(tickedLabels()).toEqual(['Push here', 'My own cue'])
  })

  it("lists a cue the set has although the run's tags don't hold it, ticked and YOURS, and gives it back as it was stored", () => {
    const result = doneWith({ value: ['push back', 'my own cue'], runCues: [] }, () => {
      expect(rowLabels()).toEqual(['Push here', 'Maintain strength', 'Focus on execution', 'Push back', 'My own cue'])
      expect(tickedLabels()).toEqual(['Push back', 'My own cue'])
      expect(marker(row('My own cue'))).toBe('YOURS')
    })
    expect(result.cues).toEqual(['push back', 'my own cue'])
  })

  it('a run with no cues of its own, and a set with none, lists the presets and + NEW CUE only', () => {
    render(<CuesSheet {...props({ value: null, runCues: undefined })} />)
    expect(rowLabels()).toHaveLength(4)
    expect(tickedLabels()).toEqual([])
    expect(screen.queryByText('YOURS')).toBeNull()
    expect(button('+ NEW CUE')).toBeTruthy()
  })

  it("marks the user's own cues as YOURS and no preset", () => {
    render(<CuesSheet {...props({ value: [], runCues: ['a', 'b'] })} />)
    expect(screen.getAllByText('YOURS')).toHaveLength(2)
    for (const preset of ['Push here', 'Maintain strength', 'Focus on execution', 'Push back']) expect(marker(row(preset)), preset).toBeNull()
  })

  it('a cue the set has twice, or a blank one, is one row and one cue', () => {
    const result = doneWith({ value: ['push here', 'push here', '  '], runCues: [] }, () => {
      expect(tickedLabels()).toEqual(['Push here'])
    })
    expect(result.cues).toEqual(['push here'])
  })

  it('exposes each row as a checkbox that says whether the set has it', () => {
    render(<CuesSheet {...props({ value: ['push back'] })} />)
    expect(rows().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'false'])
    fireEvent.click(row('Maintain strength'))
    fireEvent.click(row('Push back'))
    expect(rows().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false'])
  })
})

describe('CuesSheet: DONE returns the ticked list', () => {
  it("is the set's cues with the taps applied: new ones after the set's own, an unticked one gone, as stored (a preset in lower case)", () => {
    const result = doneWith({ value: ['maintain strength'] }, () => {
      fireEvent.click(row('Push here'))
      fireEvent.click(row('1-sec pause at the bottom'))
    })
    expect(result).toEqual({ cues: ['maintain strength', 'push here', '1-sec pause at the bottom'], applyToAll: false })
    expect(doneWith({ value: ['maintain strength', 'push here'] }, () => fireEvent.click(row('Maintain strength')))).toEqual({ cues: ['push here'], applyToAll: false })
  })

  it('with nothing ticked it is an empty list, not null', () => {
    const result = doneWith({ value: ['push here'] }, () => fireEvent.click(row('Push here')))
    expect(result.cues).toEqual([])
  })

  it('with nothing touched it is what the set had', () => {
    expect(doneWith({ value: ['focus on execution', 'push here'] }, noop).cues).toEqual(['focus on execution', 'push here'])
  })

  it("never changes the array the caller passed in", () => {
    const value = ['push here']
    doneWith({ value }, () => {
      fireEvent.click(row('Push back'))
      fireEvent.click(row('Push here'))
    })
    expect(value).toEqual(['push here'])
  })
})

describe('CuesSheet: + NEW CUE', () => {
  it('opens an input with the focus in it, in the dashed button\'s place', () => {
    render(
      <>
        <PageBehind title="PLAN" />
        <CuesSheet {...props()} />
      </>,
    )
    fireEvent.click(button('+ NEW CUE'))
    expect(document.activeElement).toBe(input())
    expect(screen.queryByRole('button', { name: '+ NEW CUE' })).toBeNull()
    expect(button('ADD')).toBeTruthy()
    // still at the end of the list, under the rows
    expect(follows(rows()[4], input())).toBe(true)
    // no board draws this state (D31): the picture is for the reviewer to judge
    fireEvent.change(input(), { target: { value: 'elbows in' } })
    captureRender('cues-8-new-cue', document.body)
  })

  it('Enter adds a row at the end of the list, ticked and YOURS, closes the input and puts the focus back on + NEW CUE', () => {
    const result = doneWith({}, () => {
      addCue('elbows in')
      expect(rowLabels()).toEqual(['Push here', 'Maintain strength', 'Focus on execution', 'Push back', '1-sec pause at the bottom', 'Elbows in'])
      expect(tickedLabels()).toEqual(['Push here', 'Elbows in'])
      expect(marker(row('Elbows in'))).toBe('YOURS')
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(document.activeElement).toBe(button('+ NEW CUE'))
      // the next cue starts from an empty input
      fireEvent.click(button('+ NEW CUE'))
      expect(input().value).toBe('')
    })
    expect(result.cues).toEqual(['push here', 'elbows in'])
  })

  it('the ADD button adds it too', () => {
    const result = doneWith({}, () => {
      addCue('elbows in', 'add')
      expect(tickedLabels()).toEqual(['Push here', 'Elbows in'])
    })
    expect(result.cues).toEqual(['push here', 'elbows in'])
  })

  it('keeps the text as it was typed (trimmed) and reads it with a capital', () => {
    const result = doneWith({ value: [] }, () => {
      addCue('  squeeze at the TOP  ')
      expect(rowLabels()).toContain('Squeeze at the TOP')
    })
    expect(result.cues).toEqual(['squeeze at the TOP'])
  })

  it('a cue typed twice is one row and one cue, however it is capitalised', () => {
    const result = doneWith({ value: [], runCues: [] }, () => {
      addCue('elbows in')
      addCue('elbows in')
      addCue('Elbows In')
      expect(rowLabels()).toEqual(['Push here', 'Maintain strength', 'Focus on execution', 'Push back', 'Elbows in'])
    })
    expect(result.cues).toEqual(['elbows in'])
  })

  it('"Push here" typed is the preset: ticked as the preset, no second row that reads the same, and given back as the preset', () => {
    const result = doneWith({ value: [], runCues: [] }, () => {
      addCue('Push here')
      expect(rowLabels()).toHaveLength(4)
      expect(tickedLabels()).toEqual(['Push here'])
    })
    expect(result.cues).toEqual(['push here'])
  })

  it("one of the user's own cues typed in another case is that row, ticked", () => {
    const result = doneWith({ value: [] }, () => {
      addCue('1-SEC PAUSE AT THE BOTTOM')
      expect(rowLabels()).toHaveLength(5)
      expect(tickedLabels()).toEqual(['1-sec pause at the bottom'])
    })
    expect(result.cues).toEqual(['1-sec pause at the bottom'])
  })

  it('a cue the set has, typed again, stays ticked: it is not a toggle', () => {
    const result = doneWith({ value: ['maintain strength'] }, () => addCue('maintain strength'))
    expect(result.cues).toEqual(['maintain strength'])
  })

  it('a blank text adds nothing and leaves the input open', () => {
    render(<CuesSheet {...props()} />)
    addCue('   ')
    expect(rowLabels()).toHaveLength(5)
    expect(input()).toBeTruthy()
  })

  it('Escape in the input cancels it and nothing more: the sheet stays open, the text is dropped, the focus goes back; the next Escape closes the sheet', () => {
    const onClose = vi.fn()
    const result = doneWith({ onClose }, () => {
      fireEvent.click(button('+ NEW CUE'))
      fireEvent.change(input(), { target: { value: 'half typed' } })
      fireEvent.keyDown(input(), { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(rowLabels()).toHaveLength(5)
      expect(document.activeElement).toBe(button('+ NEW CUE'))
      // the dropped text isn't back when the input is opened again
      fireEvent.click(button('+ NEW CUE'))
      expect(input().value).toBe('')
      fireEvent.keyDown(input(), { key: 'Escape' })
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(result.cues).toEqual(['push here'])
  })

  it('DONE with a cue typed and not added yet adds it first', () => {
    const result = doneWith({}, () => {
      fireEvent.click(button('+ NEW CUE'))
      fireEvent.change(input(), { target: { value: 'elbows in' } })
    })
    expect(result.cues).toEqual(['push here', 'elbows in'])
  })

  it('DONE with a blank input open is just what the set has', () => {
    const result = doneWith({}, () => {
      fireEvent.click(button('+ NEW CUE'))
      fireEvent.change(input(), { target: { value: '  ' } })
    })
    expect(result.cues).toEqual(['push here'])
  })

  it('× sends nothing, a typed cue included', () => {
    const onDone = vi.fn()
    const onClose = vi.fn()
    render(<CuesSheet {...props({ onDone, onClose })} />)
    fireEvent.click(button('+ NEW CUE'))
    fireEvent.change(input(), { target: { value: 'elbows in' } })
    fireEvent.click(button('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('CuesSheet: Use for all', () => {
  it('starts unticked, and returns what it was when DONE is tapped', () => {
    expect(doneWith({}, noop).applyToAll).toBe(false)
    expect(
      doneWith({}, () => {
        fireEvent.click(useForAll() as HTMLElement)
        expect((useForAll() as HTMLElement).getAttribute('aria-checked')).toBe('true')
      }).applyToAll,
    ).toBe(true)
    expect(
      doneWith({}, () => {
        fireEvent.click(useForAll() as HTMLElement)
        fireEvent.click(useForAll() as HTMLElement)
      }).applyToAll,
    ).toBe(false)
  })

  it("counts the exercise's working sets: a warmup is not one of the N", () => {
    render(<CuesSheet {...props({ sets: heads(true, false, false, false) })} />)
    expect(useForAll()?.textContent).toBe('Use for all 3 sets of Lat Pulldown')
  })

  it('names the exercise it was given', () => {
    render(<CuesSheet {...props({ exerciseName: 'Seated Cable Row', sets: heads(false, false, false, false) })} />)
    expect(useForAll()?.textContent).toBe('Use for all 4 sets of Seated Cable Row')
  })

  it('is not drawn when fewer than two working sets would take it, or when the caller gave no sets: then there is nothing to apply it to', () => {
    for (const sets of [heads(false), heads(true, false), heads(true, true), [], undefined]) {
      const { unmount } = render(<CuesSheet {...props({ sets })} />)
      expect(useForAll(), JSON.stringify(sets)).toBeNull()
      unmount()
    }
    render(<CuesSheet {...props({ sets: heads(true, false, false) })} />)
    expect(useForAll()?.textContent).toBe('Use for all 2 sets of Lat Pulldown')
  })

  it('applyToAll is false whenever the row is not drawn', () => {
    expect(doneWith({ sets: heads(false) }, noop).applyToAll).toBe(false)
    expect(doneWith({ sets: undefined }, noop).applyToAll).toBe(false)
  })

  it('the N it shows is the number of sets the caller writes to with applyTagToAllHeads, which skips warmups', () => {
    const setList = heads(true, false, false, false)
    let shown = NaN
    const result = doneWith({ sets: setList, value: [] }, () => {
      fireEvent.click(row('Push back'))
      fireEvent.click(useForAll() as HTMLElement)
      shown = Number(/Use for all (\d+) sets/.exec(useForAll()?.textContent ?? '')?.[1])
    })
    expect(result).toEqual({ cues: ['push back'], applyToAll: true })
    // the caller's write, as chunk 54a / 61 will make it: every returned cue added to every head
    const writes = result.cues.flatMap((cue) => applyTagToAllHeads(setList.map((set) => ({ ...set, tags: null })), cue))
    expect(writes.map((write) => write.id)).toEqual(['set-2', 'set-3', 'set-4'])
    expect(writes).toHaveLength(shown)
  })
})

describe('CuesSheet: long text', () => {
  const LONG = 'X'.repeat(80)

  it('an unbroken cue wraps inside its row, and YOURS stays beside it', () => {
    render(<CuesSheet {...props({ value: [LONG], runCues: [] })} />)
    const long = row(LONG)
    expect(long).toBeTruthy()
    // jsdom lays nothing out: the Chromium check at 375 px (the builder's report) is the proof; this holds the rule that gives it
    const text = long.children[1] as HTMLElement
    expect(text.style.overflowWrap).toBe('break-word')
    expect(text.style.minWidth).toBe('0px')
    expect(marker(long)).toBe('YOURS')
  })

  it('"Use for all" keeps a long exercise name inside its row too', () => {
    render(<CuesSheet {...props({ exerciseName: LONG })} />)
    const text = (useForAll() as HTMLElement).lastElementChild as HTMLElement
    expect(text.style.overflowWrap).toBe('break-word')
    expect(text.style.minWidth).toBe('0px')
  })
})

describe('CuesSheet: opened from the set type picker (board 5 → 8)', () => {
  function Caller({ onClosePicker, onCuesDone }: { onClosePicker: () => void; onCuesDone: (result: CuesSheetResult) => void }) {
    const [cues, setCues] = useState<string[]>(['push here'])
    const [open, setOpen] = useState(false)
    return (
      <>
        <SetTypePicker
          context="plan-week-dependent"
          exerciseName="Lat Pulldown"
          setNumber={3}
          weekNumber={2}
          value={{ kind: 'normal' }}
          onChange={noop}
          onClose={onClosePicker}
          cues={cues}
          onCues={() => setOpen(true)}
        />
        {open ? (
          <CuesSheet
            {...props({ value: cues })}
            onDone={(result) => {
              onCuesDone(result)
              setCues(result.cues)
              setOpen(false)
            }}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    )
  }

  it('stacks on the picker: Escape closes the cues sheet only, and DONE puts the new cues on the Cues row', () => {
    const onClosePicker = vi.fn()
    const onCuesDone = vi.fn()
    render(<Caller onClosePicker={onClosePicker} onCuesDone={onCuesDone} />)
    expect(screen.getByText('Push here')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Cues/ }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(onClosePicker).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^Cues/ }))
    fireEvent.click(row('Maintain strength'))
    fireEvent.click(done())
    expect(onCuesDone).toHaveBeenCalledWith({ cues: ['push here', 'maintain strength'], applyToAll: false })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('Push here, Maintain strength')).toBeTruthy()
    expect(onClosePicker).not.toHaveBeenCalled()
  })
})

describe('CuesSheet: text on the accent is --on-accent, never --base (DECISIONS 129 (d), Adam 2026-10-15)', () => {
  it('a ticked row\'s check mark and DONE, and nothing else, are drawn on the accent', () => {
    render(<CuesSheet {...props({ value: ['push here', 'push back'] })} />)
    const onAccent = textOnAccent(document.body)
    // two ticked rows (a check mark each) and DONE; an unticked row has no accent behind it
    expect(onAccent.map((el) => el.textContent)).toEqual(['', '', 'DONE'])
    for (const el of onAccent) expect(el.style.color, el.textContent || 'the tick').toBe('var(--on-accent)')
  })

  it('"Use for all" is drawn on the accent once it is ticked, in the same colour', () => {
    render(<CuesSheet {...props({ value: [] })} />)
    expect(textOnAccent(document.body).map((el) => el.textContent)).toEqual(['DONE'])
    fireEvent.click(useForAll() as HTMLElement)
    const onAccent = textOnAccent(document.body)
    expect(onAccent.map((el) => el.textContent)).toEqual(['', 'DONE'])
    for (const el of onAccent) expect(el.style.color).toBe('var(--on-accent)')
  })
})
