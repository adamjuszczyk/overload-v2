// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import ExercisePickerSheet from './ExercisePickerSheet'
import type { ExercisePickerSheetProps } from './ExercisePickerSheet'
import { queryClient } from '../lib/queryClient'
import { captureRender } from '../testing/captureRender'
import { textOnAccent } from '../testing/textOnAccent'
import type { Exercise, MuscleGroup } from '../types'

// TASKS-1.2 chunk 41: the one exercise picker (PL4-PL6, PP2d, PP2d2, W11, W13-W15). It writes nothing but a
// new exercise: a pick goes to `onPick` and the caller does the swap or the add. These tests assert what the
// sheet lists and from where (the user's own, active exercises, by name, minus the excluded), what each tap does
// in each of the four shapes (swap or add, with or without a confirm), what an empty list says, and the create
// flow, which is the one write: the typed name and the chosen chip's group reach `createExercise`, a failure
// shows the message the server returned. The renders in "draws board ..." are the fixtures for the 390 px
// screenshots in design/1.2/built/.
//
// The service module is the boundary mocked: the real useExercises / useCreateExercise run on the app's own
// query client, so the list is what `fetchExercises(false)` returns and a created exercise reaches the list the
// way the app's refetch brings it.

const service = vi.hoisted(() => ({ fetchExercises: vi.fn(), createExercise: vi.fn() }))

vi.mock('../features/library/exerciseService', () => ({
  fetchExercises: service.fetchExercises,
  createExercise: service.createExercise,
  updateExercise: vi.fn(),
  setExerciseArchived: vi.fn(),
  fetchExerciseCount: vi.fn(),
  seedDefaultExercisesIfEmpty: vi.fn(),
  fetchLostExercises: vi.fn(),
  previewExerciseDelete: vi.fn(),
  deleteExercise: vi.fn(),
  restoreExercise: vi.fn(),
}))

vi.mock('../features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false, signOut: vi.fn() }) }))

const here = dirname(fileURLToPath(import.meta.url))

function ex(id: string, name: string, muscleGroup: MuscleGroup): Exercise {
  return { id, userId: 'user-1', name, muscleGroup, isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null }
}

const LAT = ex('lat', 'Lat Pulldown', 'back')
const ROW = ex('row', 'Chest-Supported Row', 'back')
const MACHINE = ex('machine', 'Machine Pulldown', 'back')
const PULLUP = ex('pullup', 'Pull-Up', 'back')
const PRESS = ex('press', 'Incline Dumbbell Press', 'chest')
const FLY = ex('fly', 'Pec Deck Fly', 'chest')
const CURL = ex('curl', 'Hammer Curl', 'biceps')
const SQUAT = ex('squat', 'Back Squat', 'quads')
// Only fetchExercises(true) returns this one: a wrong source shows it.
const ARCHIVED = { ...ex('old', 'Retired Rowing Machine', 'back'), isArchived: true }

// Out of order on purpose: the list sorts them.
const LIBRARY = [PULLUP, SQUAT, LAT, FLY, MACHINE, CURL, ROW, PRESS]

let library: Exercise[]

beforeEach(() => {
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false } })
  library = [...LIBRARY]
  service.fetchExercises.mockReset().mockImplementation(async (includeArchived: boolean) => (includeArchived ? [...library, ARCHIVED] : [...library]))
  service.createExercise.mockReset().mockImplementation(async (_userId: string, name: string, group: MuscleGroup) => {
    const created = ex(`new-${library.length}`, name.trim(), group)
    library.push(created)
    return created
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const noop = () => {}

type Props = ExercisePickerSheetProps

function add(over: Partial<Extract<Props, { mode: 'add' }>> = {}): Props {
  return { mode: 'add', title: 'Add exercise', eyebrow: 'PULL 1 · FROM WEEK 2', onPick: noop, onClose: noop, ...over } as Props
}

function swap(over: Partial<Extract<Props, { mode: 'swap' }>> = {}): Props {
  return { mode: 'swap', title: 'Swap Lat Pulldown', eyebrow: 'PULL 1 · FROM WEEK 2', replacing: { id: 'lat', muscleGroup: 'back' }, onPick: noop, onClose: noop, ...over } as Props
}

function renderPicker(props: Props) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ExercisePickerSheet {...props} />
    </QueryClientProvider>,
  )
}

/** What the page behind a board shows, under the scrim. */
function PageBehind({ title }: { title: string }) {
  const card = { borderRadius: 12, background: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' } as const
  return (
    <div aria-hidden="true" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, color: 'var(--text-primary)' }}>{title}</span>
      <div style={{ ...card, height: 52 }} />
      <div style={{ ...card, height: 300 }} />
    </div>
  )
}

function renderWithPage(props: Props, title: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PageBehind title={title} />
      <ExercisePickerSheet {...props} />
    </QueryClientProvider>,
  )
}

const dialog = () => screen.getByRole('dialog')
const chipGroup = () => screen.getByRole('group', { name: 'Muscle group' })
const chips = () => within(chipGroup()).getAllByRole('button') as HTMLButtonElement[]
const chip = (label: string) => chips().find((c) => c.textContent === label) as HTMLButtonElement
const pressed = () => chips().filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent)
/** The list region (a group, or a radio group in a confirmed swap), once the exercises have arrived. */
const list = () => screen.findByLabelText('Exercises')
const radios = () => within(screen.getByRole('radiogroup', { name: 'Exercises' })).getAllByRole('radio') as HTMLButtonElement[]
const rowButtons = () => within(screen.getByRole('group', { name: 'Exercises' })).getAllByRole('button') as HTMLButtonElement[]
/** A row: the name is the first line of its text, the group (when drawn) the second. */
const rowName = (row: HTMLElement) => row.children[0].children[0].textContent
const rowGroup = (row: HTMLElement) => row.children[0].children[1]?.textContent ?? null
const names = (rows: HTMLElement[]) => rows.map(rowName)
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const input = () => screen.getByRole('textbox') as HTMLInputElement

async function listed(props: Props) {
  const view = renderPicker(props)
  await list()
  return view
}

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } })
}

/** A promise a test settles itself, for a call that must still be running. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('what it lists', () => {
  it('is the user\'s own exercises, active and not archived: it asks for them without the archived ones', async () => {
    await listed(add())
    expect(service.fetchExercises).toHaveBeenCalledTimes(1)
    expect(service.fetchExercises).toHaveBeenCalledWith(false)
    expect(names(rowButtons())).not.toContain('Retired Rowing Machine')
    expect(rowButtons()).toHaveLength(LIBRARY.length)
  })

  it('lists them by name, whatever order they arrive in', async () => {
    await listed(add())
    expect(names(rowButtons())).toEqual(['Back Squat', 'Chest-Supported Row', 'Hammer Curl', 'Incline Dumbbell Press', 'Lat Pulldown', 'Machine Pulldown', 'Pec Deck Fly', 'Pull-Up'])
  })

  it('leaves out the exercises already in the workout', async () => {
    await listed(add({ exclude: ['curl', 'press'] }))
    const shown = names(rowButtons())
    expect(shown).not.toContain('Hammer Curl')
    expect(shown).not.toContain('Incline Dumbbell Press')
    expect(shown).toHaveLength(LIBRARY.length - 2)
  })

  it('a swap never lists the exercise it replaces, and leaves out the excluded ones too', async () => {
    await listed(swap({ exclude: ['row'] }))
    // opens on BACK: the other back exercises, minus the excluded one
    expect(names(radiosOrButtons())).toEqual(['Machine Pulldown', 'Pull-Up'])
    fireEvent.click(chip('ALL'))
    const shown = names(radiosOrButtons())
    expect(shown).not.toContain('Lat Pulldown')
    expect(shown).not.toContain('Chest-Supported Row')
    expect(shown).toHaveLength(LIBRARY.length - 2)
  })

  it('draws the group under each name, and nothing under it when showGroup is off', async () => {
    const { unmount } = await listed(add())
    expect(rowButtons().map(rowGroup)).toEqual(['QUADS', 'BACK', 'BICEPS', 'CHEST', 'BACK', 'BACK', 'CHEST', 'BACK'])
    unmount()
    await listed(add({ showGroup: false }))
    expect(rowButtons().map(rowGroup)).toEqual(Array(LIBRARY.length).fill(null))
  })
})

/** The rows of whichever list is on: radios in a confirmed swap, buttons otherwise. */
function radiosOrButtons(): HTMLButtonElement[] {
  return screen.queryByRole('radiogroup', { name: 'Exercises' }) ? radios() : rowButtons()
}

describe('the chips', () => {
  it('are ALL first and then the twelve groups in the app\'s order, ALL on in an add', async () => {
    await listed(add())
    expect(chips().map((c) => c.textContent)).toEqual(['ALL', 'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'FOREARMS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'CORE', 'OTHER'])
    expect(pressed()).toEqual(['ALL'])
  })

  it('draw the one that is on as on (an accent outline and a muted accent fill) and the others plain, every one a 44 px target', async () => {
    await listed(add())
    const on = chip('ALL')
    const off = chip('BACK')
    expect(on.style.borderColor).toBe('var(--accent)')
    expect(on.style.background).toBe('var(--accent-muted)')
    expect(off.style.borderColor).toBe('var(--border)')
    expect(off.style.background).toBe('var(--surface)')
    for (const c of chips()) expect(c.style.height).toBe('44px')
    fireEvent.click(off)
    expect(chip('BACK').style.borderColor).toBe('var(--accent)')
    expect(chip('ALL').style.borderColor).toBe('var(--border)')
  })

  it('a swap opens on the group of the exercise it replaces, and lists that group alone', async () => {
    await listed(swap({ replacing: { id: 'press', muscleGroup: 'chest' } }))
    expect(pressed()).toEqual(['CHEST'])
    expect(names(rowButtons())).toEqual(['Pec Deck Fly'])
  })

  it('a swap opens on ALL when the exercise has no group the chips know', async () => {
    await listed(swap({ replacing: { id: 'lat', muscleGroup: null } }))
    expect(pressed()).toEqual(['ALL'])
    expect(rowButtons()).toHaveLength(LIBRARY.length - 1)
  })

  it('a tap picks the group: only its exercises are listed; ALL lists everything', async () => {
    await listed(add())
    fireEvent.click(chip('BACK'))
    expect(pressed()).toEqual(['BACK'])
    expect(names(rowButtons())).toEqual(['Chest-Supported Row', 'Lat Pulldown', 'Machine Pulldown', 'Pull-Up'])
    fireEvent.click(chip('CHEST'))
    expect(pressed()).toEqual(['CHEST'])
    expect(names(rowButtons())).toEqual(['Incline Dumbbell Press', 'Pec Deck Fly'])
    fireEvent.click(chip('ALL'))
    expect(pressed()).toEqual(['ALL'])
    expect(rowButtons()).toHaveLength(LIBRARY.length)
  })

  it('a tap on the chip that is on goes back to ALL', async () => {
    await listed(add())
    fireEvent.click(chip('BACK'))
    fireEvent.click(chip('BACK'))
    expect(pressed()).toEqual(['ALL'])
    expect(rowButtons()).toHaveLength(LIBRARY.length)
  })

  it('a chip starts its list at the top, not wherever the last list was scrolled to', async () => {
    await listed(add())
    const content = (await list()).parentElement as HTMLElement
    content.scrollTop = 300
    expect(content.scrollTop).toBe(300)
    fireEvent.click(chip('BACK'))
    expect(content.scrollTop).toBe(0)
    content.scrollTop = 120
    fireEvent.click(chip('BACK'))
    expect(content.scrollTop).toBe(0)
  })

  it('are pinned outside the list\'s scroll, so they stay in view while it scrolls', async () => {
    await listed(add())
    const content = (await list()).parentElement as HTMLElement
    expect(content.style.overflowY).toBe('auto')
    expect(content.contains(chipGroup())).toBe(false)
    expect(dialog().contains(chipGroup())).toBe(true)
  })

  it('open with the chip that is on scrolled into view, when the row has to scroll', async () => {
    // jsdom lays nothing out: stand in for the browser's layout on the one chip and the row
    const offsetLeft = vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-pressed') === 'true' ? 640 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-pressed') === 'true' ? 80 : 0
    })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.getAttribute('role') === 'group' && this.getAttribute('aria-label') === 'Muscle group' ? 340 : 0
    })
    // forearms has nothing in the library: there is no list to wait for
    renderPicker(swap({ replacing: { id: 'lat', muscleGroup: 'forearms' } }))
    await screen.findByText('NONE IN THIS GROUP')
    expect(pressed()).toEqual(['FOREARMS'])
    // centred: 640 - (340 - 80) / 2
    expect(chipGroup().scrollLeft).toBe(510)
    expect(offsetLeft).toHaveBeenCalled()
  })
})

describe('a tap in an add', () => {
  it('without a confirm adds at once: onPick gets the exercise, and the sheet asks for nothing else', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    await listed(add({ onPick, onClose }))
    fireEvent.click(button('Add Hammer Curl'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(CURL)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('every row is a + the caller can tap again: a second add is a second onPick (the list stays open)', async () => {
    const onPick = vi.fn()
    await listed(add({ onPick, stayOpenAfterAdd: true }))
    fireEvent.click(button('Add Hammer Curl'))
    fireEvent.click(button('Add Pec Deck Fly'))
    expect(onPick.mock.calls.map(([picked]) => (picked as Exercise).id)).toEqual(['curl', 'fly'])
  })

  it('says the list stays open only when the caller keeps it open (PP2d)', async () => {
    const { unmount } = await listed(add({ stayOpenAfterAdd: true }))
    expect(screen.getByText('Tap to add. The list stays open for the next one.')).toBeTruthy()
    unmount()
    await listed(add())
    expect(screen.queryByText('Tap to add. The list stays open for the next one.')).toBeNull()
  })

  describe('focus in a list that stays open', () => {
    // sorted: Back Squat, Chest-Supported Row, Hammer Curl, Incline Dumbbell Press, Lat Pulldown, Machine Pulldown, Pec Deck Fly, Pull-Up
    const focusedName = () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label')

    it('moves to the next row before the pick, so it is never on a row the caller is about to take away', async () => {
      let during: string | null | undefined
      const onPick = vi.fn(() => {
        during = focusedName()
      })
      await listed(add({ stayOpenAfterAdd: true, onPick }))
      const row = button('Add Hammer Curl')
      row.focus()
      fireEvent.click(row)
      expect(onPick).toHaveBeenCalledTimes(1)
      expect(during).toBe('Add Incline Dumbbell Press')
      expect(focusedName()).toBe('Add Incline Dumbbell Press')
    })

    it('moves to the row before when the last row is tapped', async () => {
      await listed(add({ stayOpenAfterAdd: true }))
      const row = button('Add Pull-Up')
      row.focus()
      fireEvent.click(row)
      expect(focusedName()).toBe('Add Pec Deck Fly')
    })

    it('moves to the chip that is on when there is no other row', async () => {
      await listed(add({ stayOpenAfterAdd: true }))
      fireEvent.click(chip('CHEST'))
      fireEvent.click(chip('BICEPS'))
      const row = button('Add Hammer Curl')
      expect(rowButtons()).toHaveLength(1)
      row.focus()
      fireEvent.click(row)
      expect(document.activeElement).toBe(chip('BICEPS'))
    })

    it('leaves the focus alone when the sheet does not stay open: the caller closes it', async () => {
      await listed(add())
      const row = button('Add Hammer Curl')
      row.focus()
      fireEvent.click(row)
      expect(document.activeElement).toBe(row)
    })

    it('after an exercise is created here the focus is back on the row that opened the field, as everywhere else', async () => {
      await listed(add({ stayOpenAfterAdd: true, onCreate: noop }))
      fireEvent.click(chip('FOREARMS'))
      fireEvent.click(button('+ NEW FOREARMS EXERCISE'))
      type('Wrist Curl')
      fireEvent.click(button('CREATE'))
      await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
      expect(document.activeElement).toBe(button('+ NEW FOREARMS EXERCISE'))
    })
  })

  it('draws a + at the end of each row', async () => {
    await listed(add())
    for (const row of rowButtons()) {
      expect(row.querySelector('svg.lucide-plus')).toBeTruthy()
      expect(row.querySelector('svg.lucide-arrow-right-left')).toBeNull()
      expect(row.querySelector('svg.lucide-chevron-right')).toBeNull()
    }
  })

  describe('with a confirm (W13, W14)', () => {
    const withConfirm = (over: Partial<Extract<Props, { mode: 'add' }>> = {}) =>
      add({ eyebrow: 'PULL 1 · TODAY', title: 'Add an exercise', confirmLabel: 'ADD EXERCISE', confirmNote: () => "Only today's session changes; the plan stays the same.", ...over })

    it('draws a › at the end of each row, and a tap adds nothing yet: it asks first', async () => {
      const onPick = vi.fn()
      await listed(withConfirm({ onPick }))
      for (const row of rowButtons()) expect(row.querySelector('svg.lucide-chevron-right')).toBeTruthy()
      fireEvent.click(button('Add Hammer Curl'))
      expect(onPick).not.toHaveBeenCalled()
      expect(screen.getByRole('heading', { level: 2, name: 'Add Hammer Curl?' })).toBeTruthy()
    })

    it('draws W14: the eyebrow as it was, the title, the caller\'s line, then BACK and the label', async () => {
      await listed(withConfirm())
      fireEvent.click(button('Add Hammer Curl'))
      const parts = [
        within(dialog()).getByText('PULL 1 · TODAY'),
        within(dialog()).getByRole('heading', { level: 2, name: 'Add Hammer Curl?' }),
        within(dialog()).getByText("Only today's session changes; the plan stays the same."),
        button('BACK'),
        button('ADD EXERCISE'),
      ]
      for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
      // the list and its chips are gone: this is the confirm alone
      expect(screen.queryByRole('group', { name: 'Muscle group' })).toBeNull()
      expect(screen.queryByRole('group', { name: 'Exercises' })).toBeNull()
    })

    it('hands the caller\'s line the exercise being added', async () => {
      const confirmNote = vi.fn((exercise: Exercise | null) => `Adds ${exercise?.name} to today`)
      await listed(withConfirm({ confirmNote }))
      fireEvent.click(button('Add Pec Deck Fly'))
      expect(screen.getByText('Adds Pec Deck Fly to today')).toBeTruthy()
      expect(confirmNote).toHaveBeenLastCalledWith(FLY)
    })

    it('the label picks: onPick gets the exercise, once', async () => {
      const onPick = vi.fn()
      await listed(withConfirm({ onPick }))
      fireEvent.click(button('Add Hammer Curl'))
      fireEvent.click(button('ADD EXERCISE'))
      expect(onPick).toHaveBeenCalledTimes(1)
      expect(onPick).toHaveBeenCalledWith(CURL)
    })

    it('BACK returns to the list with the chip that was on, and picks nothing', async () => {
      const onPick = vi.fn()
      await listed(withConfirm({ onPick }))
      fireEvent.click(chip('CHEST'))
      fireEvent.click(button('Add Pec Deck Fly'))
      fireEvent.click(button('BACK'))
      expect(onPick).not.toHaveBeenCalled()
      expect(pressed()).toEqual(['CHEST'])
      expect(names(rowButtons())).toEqual(['Incline Dumbbell Press', 'Pec Deck Fly'])
      expect(screen.getByRole('heading', { level: 2, name: 'Add an exercise' })).toBeTruthy()
    })

    it('is a content-sized sheet while it asks, and the tall picker again after BACK', async () => {
      await listed(withConfirm())
      expect(dialog().style.height).toBe('calc(100dvh - 64px)')
      fireEvent.click(button('Add Hammer Curl'))
      expect(dialog().style.height).toBe('')
      fireEvent.click(button('BACK'))
      expect(dialog().style.height).toBe('calc(100dvh - 64px)')
    })

    it('keeps the one sheet open across the steps: the same dialog, the page behind still locked', async () => {
      await listed(withConfirm())
      const before = dialog()
      fireEvent.click(button('Add Hammer Curl'))
      expect(dialog()).toBe(before)
      expect(document.body.style.overflow).toBe('hidden')
    })

    it('× asks to close from the confirm too, and picks nothing', async () => {
      const onPick = vi.fn()
      const onClose = vi.fn()
      await listed(withConfirm({ onPick, onClose }))
      fireEvent.click(button('Add Hammer Curl'))
      fireEvent.click(button('Close'))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onPick).not.toHaveBeenCalled()
    })
  })
})

describe('a tap in a swap', () => {
  it('without a confirm swaps at once: ⇄ rows, named "Swap to X" (PL4), onPick gets the exercise', async () => {
    const onPick = vi.fn()
    await listed(swap({ onPick }))
    for (const row of rowButtons()) expect(row.querySelector('svg.lucide-arrow-right-left')).toBeTruthy()
    expect(rowButtons().map((row) => row.getAttribute('aria-label'))).toEqual(['Swap to Chest-Supported Row', 'Swap to Machine Pulldown', 'Swap to Pull-Up'])
    fireEvent.click(button('Swap to Machine Pulldown'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(MACHINE)
  })

  describe('with a confirm (W11)', () => {
    const withConfirm = (over: Partial<Extract<Props, { mode: 'swap' }>> = {}) =>
      swap({
        eyebrow: 'LAT PULLDOWN · TODAY ONLY',
        title: 'Swap for what?',
        confirmLabel: 'SWAP FOR TODAY',
        confirmNote: (picked) => (picked ? `The set left moves to ${picked.name}. Next week's plan stays the same.` : "Next week's plan stays the same."),
        showGroup: false,
        ...over,
      })

    it('draws radio rows, none picked, and a confirm that can\'t be pressed until one is', async () => {
      const onPick = vi.fn()
      await listed(withConfirm({ onPick }))
      expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])
      expect(button('SWAP FOR TODAY').disabled).toBe(true)
      fireEvent.click(button('SWAP FOR TODAY'))
      expect(onPick).not.toHaveBeenCalled()
    })

    it('tints the row that is picked and no other', async () => {
      await listed(withConfirm())
      fireEvent.click(radios()[1])
      expect(radios().map((r) => r.style.background)).toEqual(['transparent', 'var(--accent-muted)', 'transparent'])
    })

    it('a tap picks the row: one radio is on, the confirm is enabled and nothing has been handed over', async () => {
      const onPick = vi.fn()
      await listed(withConfirm({ onPick }))
      fireEvent.click(radios()[1])
      expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
      expect(button('SWAP FOR TODAY').disabled).toBe(false)
      expect(onPick).not.toHaveBeenCalled()
      fireEvent.click(radios()[2])
      expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    })

    it('the confirm hands over the picked exercise, once', async () => {
      const onPick = vi.fn()
      await listed(withConfirm({ onPick }))
      fireEvent.click(radios()[1])
      fireEvent.click(button('SWAP FOR TODAY'))
      expect(onPick).toHaveBeenCalledTimes(1)
      expect(onPick).toHaveBeenCalledWith(MACHINE)
    })

    it('puts the caller\'s line over the button and tells it what is picked (null before a pick)', async () => {
      const confirmNote = vi.fn((picked: Exercise | null) => (picked ? `The set left moves to ${picked.name}.` : 'Nothing picked yet.'))
      await listed(withConfirm({ confirmNote }))
      expect(screen.getByText('Nothing picked yet.')).toBeTruthy()
      expect(confirmNote).toHaveBeenCalledWith(null)
      fireEvent.click(radios()[1])
      const line = screen.getByText('The set left moves to Machine Pulldown.')
      expect(follows(line, button('SWAP FOR TODAY'))).toBe(true)
      expect(confirmNote).toHaveBeenLastCalledWith(MACHINE)
    })

    it('draws nothing for a line the caller returns null for', async () => {
      await listed(withConfirm({ confirmNote: () => null }))
      expect(button('SWAP FOR TODAY').parentElement?.children).toHaveLength(1)
    })

    it('keeps the pick when another chip is tapped, and the confirm still hands it over', async () => {
      const onPick = vi.fn()
      await listed(withConfirm({ onPick }))
      fireEvent.click(radios()[1])
      fireEvent.click(chip('CHEST'))
      expect(screen.getByText('The set left moves to Machine Pulldown. Next week\'s plan stays the same.')).toBeTruthy()
      expect(button('SWAP FOR TODAY').disabled).toBe(false)
      fireEvent.click(button('SWAP FOR TODAY'))
      expect(onPick).toHaveBeenCalledWith(MACHINE)
    })

    it('draws the footer under the list, outside what scrolls', async () => {
      await listed(withConfirm())
      const content = screen.getByRole('radiogroup', { name: 'Exercises' }).parentElement as HTMLElement
      expect(content.contains(button('SWAP FOR TODAY'))).toBe(false)
      expect(follows(screen.getByRole('radiogroup', { name: 'Exercises' }), button('SWAP FOR TODAY'))).toBe(true)
    })

    it('the label is whatever the caller gave (SWAP, SWAP FOR TODAY)', async () => {
      await listed(withConfirm({ confirmLabel: 'SWAP' }))
      expect(button('SWAP')).toBeTruthy()
    })
  })
})

describe('when there is nothing to list', () => {
  it('says LOADING… until the exercises come, and shows no empty-library line meanwhile', async () => {
    service.fetchExercises.mockReturnValue(new Promise(() => {}))
    renderPicker(add({ onCreate: noop }))
    expect(await screen.findByText('LOADING…')).toBeTruthy()
    expect(screen.queryByText(/No exercises yet/)).toBeNull()
    expect(screen.queryByText('ALL EXERCISES ADDED')).toBeNull()
  })

  it('says why when they can\'t be loaded: a headline and the message the server returned', async () => {
    service.fetchExercises.mockRejectedValue({ message: 'JWT expired', code: 'PGRST301' })
    renderPicker(add())
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("COULDN'T LOAD EXERCISES")).toBeTruthy()
    expect(within(alert).getByText('JWT expired')).toBeTruthy()
    expect(screen.queryByText('NONE IN THIS GROUP')).toBeNull()
    expect(screen.queryByText(/No exercises yet/)).toBeNull()
  })

  it('ALL EXERCISES ADDED: every exercise is already in the workout (PP2d2)', async () => {
    renderPicker(add({ exclude: LIBRARY.map((e) => e.id) }))
    expect(await screen.findByText('ALL EXERCISES ADDED')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Exercises' })).toBeNull()
  })

  it('NONE IN THIS GROUP: a chip with nothing left under it (PL6, PP2d2)', async () => {
    await listed(add({ exclude: ['press', 'fly'] }))
    fireEvent.click(chip('CHEST'))
    expect(screen.getByText('NONE IN THIS GROUP')).toBeTruthy()
    expect(screen.queryByText('ALL EXERCISES ADDED')).toBeNull()
    fireEvent.click(chip('FOREARMS'))
    expect(screen.getByText('NONE IN THIS GROUP')).toBeTruthy()
  })

  it('a swap with nothing else to swap to says so, not that everything was added', async () => {
    library = [LAT]
    renderPicker(swap({ replacing: { id: 'lat', muscleGroup: null } }))
    expect(await screen.findByText('NO OTHER EXERCISES')).toBeTruthy()
    expect(screen.queryByText('ALL EXERCISES ADDED')).toBeNull()
  })

  it('"No forearms exercises yet." and the create row, where creating is offered (W15)', async () => {
    await listed(add({ onCreate: noop }))
    fireEvent.click(chip('FOREARMS'))
    expect(screen.getByText('No forearms exercises yet.')).toBeTruthy()
    expect(button('+ NEW FOREARMS EXERCISE')).toBeTruthy()
    expect(screen.queryByText('NONE IN THIS GROUP')).toBeNull()
  })

  it('a group whose exercises are all in the workout says NONE IN THIS GROUP even where creating is offered: they exist, so "none yet" would be wrong (PP2d2), and the create row is still there', async () => {
    await listed(add({ onCreate: noop, exclude: ['press', 'fly'] }))
    fireEvent.click(chip('CHEST'))
    expect(screen.getByText('NONE IN THIS GROUP')).toBeTruthy()
    expect(screen.queryByText('No chest exercises yet.')).toBeNull()
    expect(button('+ NEW CHEST EXERCISE')).toBeTruthy()
  })

  it('a swap whose exercise is the only one in its group says NONE IN THIS GROUP and offers to create one', async () => {
    library = [LAT, PRESS]
    renderPicker(swap({ onCreate: noop }))
    expect(await screen.findByText('NONE IN THIS GROUP')).toBeTruthy()
    expect(pressed()).toEqual(['BACK'])
    expect(button('+ NEW BACK EXERCISE')).toBeTruthy()
  })

  it('"No exercises yet. Pick a muscle group to create one." for an empty library, where creating is offered (W15), and no create row on ALL', async () => {
    library = []
    renderPicker(add({ onCreate: noop }))
    expect(await screen.findByText('No exercises yet. Pick a muscle group to create one.')).toBeTruthy()
    expect(screen.queryByText('Pick a muscle group to create a new exercise.')).toBeNull()
    expect(screen.queryByRole('button', { name: /NEW .* EXERCISE/ })).toBeNull()
  })

  it('"No exercises yet." for an empty library where nothing can be created', async () => {
    library = []
    renderPicker(add())
    expect(await screen.findByText('No exercises yet.')).toBeTruthy()
  })
})

describe('"+ NEW [GROUP] EXERCISE": offered only to a caller that passes onCreate', () => {
  it('draws the dashed row under the list for the chip that is on, in a swap (W11)', async () => {
    await listed(swap({ onCreate: noop }))
    const row = button('+ NEW BACK EXERCISE')
    expect(follows(screen.getByRole('group', { name: 'Exercises' }), row)).toBe(true)
  })

  it('on ALL there is no group to make it in: the line says to pick one (W13)', async () => {
    await listed(add({ onCreate: noop }))
    expect(screen.getByText('Pick a muscle group to create a new exercise.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /NEW .* EXERCISE/ })).toBeNull()
  })

  it('draws neither the row nor the line for a caller that leaves onCreate out (PL4-PL6, PP2d)', async () => {
    const { unmount } = await listed(swap())
    expect(screen.queryByRole('button', { name: /NEW .* EXERCISE/ })).toBeNull()
    unmount()
    await listed(add())
    expect(screen.queryByText('Pick a muscle group to create a new exercise.')).toBeNull()
    fireEvent.click(chip('BACK'))
    expect(screen.queryByRole('button', { name: /NEW .* EXERCISE/ })).toBeNull()
  })
})

describe('creating an exercise (the one write)', () => {
  /** Opens the field under BACK in a swap, the way W15 shows it. */
  async function openField(over: Partial<Extract<Props, { mode: 'swap' }>> = {}) {
    const view = await listed(swap({ onCreate: noop, ...over }))
    fireEvent.click(button('+ NEW BACK EXERCISE'))
    return view
  }

  it('opens a field under the chips with the caption NEW BACK EXERCISE, focused, and CANCEL and CREATE under it (W15)', async () => {
    await openField()
    expect(screen.getByLabelText('NEW BACK EXERCISE')).toBe(input())
    expect(document.activeElement).toBe(input())
    expect(input().value).toBe('')
    const parts = [chipGroup(), screen.getByText('NEW BACK EXERCISE'), input(), button('CANCEL'), button('CREATE'), screen.getByRole('group', { name: 'Exercises' })]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    // the dashed row is the field now
    expect(screen.queryByRole('button', { name: '+ NEW BACK EXERCISE' })).toBeNull()
  })

  it('the field is 16 px (iOS zooms the page on a smaller one) and can be typed in until the exercise is being saved', async () => {
    const call = deferred<Exercise>()
    service.createExercise.mockReturnValue(call.promise)
    await openField()
    expect(input().style.fontSize).toBe('16px')
    expect(input().readOnly).toBe(false)
    type('Kneeling Pulldown')
    fireEvent.click(button('CREATE'))
    await screen.findByRole('button', { name: 'CREATING…' })
    expect(input().readOnly).toBe(true)
    await act(async () => call.resolve(ex('made', 'Kneeling Pulldown', 'back')))
  })

  it('writes the typed name and the group of the chip that is on: createExercise(user, name, group)', async () => {
    await openField()
    type('Kneeling Pulldown')
    fireEvent.click(button('CREATE'))
    await waitFor(() => expect(service.createExercise).toHaveBeenCalledTimes(1))
    expect(service.createExercise).toHaveBeenCalledWith('user-1', 'Kneeling Pulldown', 'back', undefined)
  })

  it('writes the group of the chip that is on when CREATE is pressed, not the one the sheet opened on', async () => {
    await openField()
    fireEvent.click(chip('BICEPS'))
    expect(screen.getByLabelText('NEW BICEPS EXERCISE')).toBe(input())
    type('Spider Curl')
    fireEvent.click(button('CREATE'))
    await waitFor(() => expect(service.createExercise).toHaveBeenCalledTimes(1))
    expect(service.createExercise).toHaveBeenCalledWith('user-1', 'Spider Curl', 'biceps', undefined)
  })

  it('sends the name trimmed, and Enter in the field creates too', async () => {
    await openField()
    type('  Kneeling Pulldown  ')
    fireEvent.submit(input().closest('form') as HTMLFormElement)
    await waitFor(() => expect(service.createExercise).toHaveBeenCalledTimes(1))
    expect(service.createExercise.mock.calls[0][1]).toBe('Kneeling Pulldown')
  })

  it('a blank name creates nothing: CREATE is disabled, and a submit does nothing', async () => {
    await openField()
    expect(button('CREATE').disabled).toBe(true)
    type('   ')
    expect(button('CREATE').disabled).toBe(true)
    fireEvent.submit(input().closest('form') as HTMLFormElement)
    await Promise.resolve()
    expect(service.createExercise).not.toHaveBeenCalled()
    type('Kneeling Pulldown')
    expect(button('CREATE').disabled).toBe(false)
  })

  it('calls onCreate with the exercise it made, before treating it as picked', async () => {
    const order: string[] = []
    const onCreate = vi.fn(() => order.push('create'))
    const onPick = vi.fn(() => order.push('pick'))
    await openField({ onCreate, onPick })
    type('Kneeling Pulldown')
    fireEvent.click(button('CREATE'))
    await waitFor(() => expect(onPick).toHaveBeenCalled())
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kneeling Pulldown', muscleGroup: 'back' }))
    expect(order).toEqual(['create', 'pick'])
  })

  describe('then treats it as a tap on its row', () => {
    it('swap without a confirm: onPick gets it at once', async () => {
      const onPick = vi.fn()
      await openField({ onPick })
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kneeling Pulldown', muscleGroup: 'back' }))
    })

    it('swap with a confirm: it is the row that is picked, in the list, and the confirm is enabled', async () => {
      const onPick = vi.fn()
      await openField({ onPick, confirmLabel: 'SWAP FOR TODAY' })
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      await waitFor(() => expect(button('SWAP FOR TODAY').disabled).toBe(false))
      expect(onPick).not.toHaveBeenCalled()
      const on = radios().filter((r) => r.getAttribute('aria-checked') === 'true')
      expect(on.map(rowName)).toEqual(['Kneeling Pulldown'])
      // the field has closed
      expect(screen.queryByRole('textbox')).toBeNull()
      fireEvent.click(button('SWAP FOR TODAY'))
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kneeling Pulldown' }))
    })

    it('add without a confirm: onPick gets it at once', async () => {
      const onPick = vi.fn()
      await listed(add({ onCreate: noop, onPick }))
      fireEvent.click(chip('FOREARMS'))
      fireEvent.click(button('+ NEW FOREARMS EXERCISE'))
      type('Wrist Curl')
      fireEvent.click(button('CREATE'))
      await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Wrist Curl', muscleGroup: 'forearms' }))
    })

    it('add with a confirm: it asks about it (W14)', async () => {
      const onPick = vi.fn()
      await listed(add({ onCreate: noop, onPick, confirmLabel: 'ADD EXERCISE' }))
      fireEvent.click(chip('FOREARMS'))
      fireEvent.click(button('+ NEW FOREARMS EXERCISE'))
      type('Wrist Curl')
      fireEvent.click(button('CREATE'))
      expect(await screen.findByRole('heading', { level: 2, name: 'Add Wrist Curl?' })).toBeTruthy()
      expect(onPick).not.toHaveBeenCalled()
    })

    it('and the field has closed, with the typed text gone', async () => {
      await openField({ confirmLabel: 'SWAP FOR TODAY' })
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
      fireEvent.click(button('+ NEW BACK EXERCISE'))
      expect(input().value).toBe('')
    })
  })

  describe('a failure', () => {
    it('shows a headline and the message the server returned, word for word', async () => {
      service.createExercise.mockRejectedValue({ message: 'duplicate key value violates unique constraint "exercises_name_key"', code: '23505' })
      const onPick = vi.fn()
      const onCreate = vi.fn()
      await openField({ onPick, onCreate })
      type('Pull-Up')
      fireEvent.click(button('CREATE'))
      const alert = await screen.findByRole('alert')
      expect(within(alert).getByText("Couldn't create the exercise.")).toBeTruthy()
      expect(within(alert).getByText('duplicate key value violates unique constraint "exercises_name_key"')).toBeTruthy()
      expect(onPick).not.toHaveBeenCalled()
      expect(onCreate).not.toHaveBeenCalled()
    })

    it('reads an Error\'s message too', async () => {
      service.createExercise.mockRejectedValue(new Error('Failed to fetch'))
      await openField()
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      expect(within(await screen.findByRole('alert')).getByText('Failed to fetch')).toBeTruthy()
    })

    it('says "Something went wrong." when the error has no message (P1.2-5)', async () => {
      service.createExercise.mockRejectedValue({ message: '' })
      await openField()
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      expect(within(await screen.findByRole('alert')).getByText('Something went wrong.')).toBeTruthy()
    })

    it('keeps the field open with what was typed, so it can be tried again, and a retry that works picks it', async () => {
      service.createExercise.mockRejectedValueOnce({ message: 'timeout' })
      const onPick = vi.fn()
      await openField({ onPick })
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      await screen.findByRole('alert')
      expect(input().value).toBe('Kneeling Pulldown')
      expect(button('CREATE').disabled).toBe(false)
      fireEvent.click(button('CREATE'))
      await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
      expect(service.createExercise).toHaveBeenCalledTimes(2)
    })

    it('draws the chips and the list again (the saving state hid them)', async () => {
      service.createExercise.mockRejectedValue({ message: 'nope' })
      await openField()
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      await screen.findByRole('alert')
      expect(screen.getByRole('group', { name: 'Muscle group' })).toBeTruthy()
      expect(screen.getByRole('group', { name: 'Exercises' })).toBeTruthy()
    })
  })

  describe('while it is being saved (W15)', () => {
    it('says CREATING…, greys CANCEL out, and draws only the field: no chips, no list', async () => {
      const call = deferred<Exercise>()
      service.createExercise.mockReturnValue(call.promise)
      await openField()
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      expect(await screen.findByRole('button', { name: 'CREATING…' })).toBeTruthy()
      expect(button('CANCEL').disabled).toBe(true)
      expect(button('CREATING…').disabled).toBe(true)
      expect(screen.queryByRole('group', { name: 'Muscle group' })).toBeNull()
      expect(screen.queryByRole('group', { name: 'Exercises' })).toBeNull()
      expect(screen.getByLabelText('NEW BACK EXERCISE')).toBeTruthy()
      await act(async () => call.resolve(ex('made', 'Kneeling Pulldown', 'back')))
    })

    it('a second press while it is being saved writes nothing more', async () => {
      const call = deferred<Exercise>()
      service.createExercise.mockReturnValue(call.promise)
      await openField()
      type('Kneeling Pulldown')
      const form = input().closest('form') as HTMLFormElement
      fireEvent.submit(form)
      await waitFor(() => expect(service.createExercise).toHaveBeenCalledTimes(1))
      fireEvent.submit(form)
      fireEvent.submit(form)
      await act(async () => {})
      expect(service.createExercise).toHaveBeenCalledTimes(1)
      await act(async () => call.resolve(ex('made', 'Kneeling Pulldown', 'back')))
    })

    it('two presses in the same instant, before the sheet has drawn the saving state, write once', async () => {
      const call = deferred<Exercise>()
      service.createExercise.mockReturnValue(call.promise)
      await openField()
      type('Kneeling Pulldown')
      const form = input().closest('form') as HTMLFormElement
      await act(async () => {
        form.requestSubmit()
        form.requestSubmit()
      })
      await waitFor(() => expect(service.createExercise).toHaveBeenCalledTimes(1))
      await act(async () => {})
      expect(service.createExercise).toHaveBeenCalledTimes(1)
      await act(async () => call.resolve(ex('made', 'Kneeling Pulldown', 'back')))
    })

    it('a sheet that was closed meanwhile picks nothing when the exercise arrives', async () => {
      const call = deferred<Exercise>()
      service.createExercise.mockReturnValue(call.promise)
      const onPick = vi.fn()
      const onCreate = vi.fn()
      const { unmount } = await openField({ onPick, onCreate })
      type('Kneeling Pulldown')
      fireEvent.click(button('CREATE'))
      await screen.findByRole('button', { name: 'CREATING…' })
      unmount()
      await act(async () => call.resolve(ex('made', 'Kneeling Pulldown', 'back')))
      expect(onPick).not.toHaveBeenCalled()
      expect(onCreate).not.toHaveBeenCalled()
    })
  })

  describe('cancelling', () => {
    it('CANCEL closes the field, forgets the text and puts the focus back on the dashed row', async () => {
      await openField()
      type('Kneeling Pulldown')
      fireEvent.click(button('CANCEL'))
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(document.activeElement).toBe(button('+ NEW BACK EXERCISE'))
      fireEvent.click(button('+ NEW BACK EXERCISE'))
      expect(input().value).toBe('')
      expect(service.createExercise).not.toHaveBeenCalled()
    })

    it('Escape in the field closes the field and nothing else; the next Escape closes the sheet', async () => {
      const onClose = vi.fn()
      await openField({ onClose })
      input().focus()
      const notPrevented = fireEvent.keyDown(input(), { key: 'Escape' })
      expect(notPrevented).toBe(false)
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ALL has no group to make it in: it closes the field and forgets the text', async () => {
      await openField()
      type('Kneeling Pulldown')
      fireEvent.click(chip('ALL'))
      expect(screen.queryByRole('textbox')).toBeNull()
      fireEvent.click(chip('BACK'))
      fireEvent.click(button('+ NEW BACK EXERCISE'))
      expect(input().value).toBe('')
    })

    it('another group keeps the field and the text, and renames the caption', async () => {
      await openField()
      type('Spider Curl')
      fireEvent.click(chip('BICEPS'))
      expect(input().value).toBe('Spider Curl')
      expect(screen.getByText('NEW BICEPS EXERCISE')).toBeTruthy()
    })
  })
})

describe('the props are a union: what a swap needs and what only an add can do', () => {
  it('compiles only the right shapes (tsc is the check: a @ts-expect-error that stops being an error is an error)', () => {
    const fine: Props[] = [
      { mode: 'swap', title: 'T', replacing: { id: 'x' }, onPick: noop, onClose: noop },
      { mode: 'swap', title: 'T', replacing: { id: 'x', muscleGroup: 'back' }, confirmLabel: 'SWAP', onPick: noop, onClose: noop },
      { mode: 'add', title: 'T', stayOpenAfterAdd: true, onPick: noop, onClose: noop },
    ]
    // @ts-expect-error a swap says which exercise it replaces
    const swapWithoutReplacing: Props = { mode: 'swap', title: 'T', onPick: noop, onClose: noop }
    // @ts-expect-error an add has nothing it replaces
    const addWithReplacing: Props = { mode: 'add', title: 'T', replacing: { id: 'x' }, onPick: noop, onClose: noop }
    // @ts-expect-error only an add can stay open
    const swapThatStaysOpen: Props = { mode: 'swap', title: 'T', replacing: { id: 'x' }, stayOpenAfterAdd: true, onPick: noop, onClose: noop }
    // @ts-expect-error a mode is a swap or an add
    const neither: Props = { mode: 'replace', title: 'T', onPick: noop, onClose: noop }
    expect(fine).toHaveLength(3)
    expect([swapWithoutReplacing, addWithReplacing, swapThatStaysOpen, neither]).toHaveLength(4)
  })
})

describe('when the phone is offline (Errors: "You may be offline" only when that is the reason)', () => {
  it('a create that fails with no message says the phone is offline, and one with a message still says the message', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    service.createExercise.mockRejectedValueOnce({ message: '' }).mockRejectedValueOnce(new Error('Failed to fetch'))
    await listed(swap({ onCreate: noop }))
    fireEvent.click(button('+ NEW BACK EXERCISE'))
    type('Kneeling Pulldown')
    fireEvent.click(button('CREATE'))
    expect(within(await screen.findByRole('alert')).getByText('You may be offline.')).toBeTruthy()
    fireEvent.click(button('CREATE'))
    await waitFor(() => expect(within(screen.getByRole('alert')).getByText('Failed to fetch')).toBeTruthy())
    expect(screen.queryByText('You may be offline.')).toBeNull()
  })

  it('a list that can\'t be loaded with no message says it too', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    service.fetchExercises.mockRejectedValue({ message: '' })
    renderPicker(add())
    expect(within(await screen.findByRole('alert')).getByText('You may be offline.')).toBeTruthy()
  })

  it('an online failure with no message says "Something went wrong."', async () => {
    service.fetchExercises.mockRejectedValue(new Error(''))
    renderPicker(add())
    expect(within(await screen.findByRole('alert')).getByText('Something went wrong.')).toBeTruthy()
  })
})

describe('React StrictMode (the app\'s dev build runs every effect twice)', () => {
  it('a create still picks the exercise, once, and the field still takes the focus', async () => {
    const onPick = vi.fn()
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ExercisePickerSheet {...swap({ onCreate: noop, onPick })} />
        </QueryClientProvider>
      </StrictMode>,
    )
    await list()
    fireEvent.click(button('+ NEW BACK EXERCISE'))
    expect(document.activeElement).toBe(input())
    type('Kneeling Pulldown')
    fireEvent.click(button('CREATE'))
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
    expect(service.createExercise).toHaveBeenCalledTimes(1)
  })
})

describe('the caller\'s line, the list and the opener', () => {
  it('takes a plain line as well as a function, for a swap and for W14', async () => {
    const { unmount } = await listed(swap({ confirmLabel: 'SWAP', confirmNote: "Next week's plan stays the same." }))
    expect(screen.getByText("Next week's plan stays the same.")).toBeTruthy()
    unmount()
    await listed(add({ confirmLabel: 'ADD EXERCISE', confirmNote: 'Only today changes.' }))
    fireEvent.click(button('Add Hammer Curl'))
    expect(screen.getByText('Only today changes.')).toBeTruthy()
  })

  it('a caller that leaves an added exercise out of exclude sees it leave the list (the list stays open for the next one)', async () => {
    const props = add({ stayOpenAfterAdd: true })
    const { rerender } = await listed(props)
    expect(names(rowButtons())).toContain('Hammer Curl')
    rerender(
      <QueryClientProvider client={queryClient}>
        <ExercisePickerSheet {...(add({ stayOpenAfterAdd: true, exclude: ['curl'] }) as Props)} />
      </QueryClientProvider>,
    )
    expect(names(rowButtons())).not.toContain('Hammer Curl')
    expect(rowButtons()).toHaveLength(LIBRARY.length - 1)
  })

  it('the focus goes back to what opened the sheet when it is closed', async () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <QueryClientProvider client={queryClient}>
          <button type="button" onClick={() => setOpen(true)}>
            Swap for today
          </button>
          {open && <ExercisePickerSheet {...(swap({ onClose: () => setOpen(false) }) as Props)} />}
        </QueryClientProvider>
      )
    }
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Swap for today' })
    opener.focus()
    fireEvent.click(opener)
    await list()
    expect(document.activeElement).toBe(dialog())
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('the frame', () => {
  it('draws the eyebrow, the title and a close button the caller\'s, then the chips, then the list', async () => {
    await listed(swap())
    const parts = [
      within(dialog()).getByText('PULL 1 · FROM WEEK 2'),
      within(dialog()).getByRole('heading', { level: 2, name: 'Swap Lat Pulldown' }),
      within(dialog()).getByRole('button', { name: 'Close' }),
      chipGroup(),
      screen.getByRole('group', { name: 'Exercises' }),
    ]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
  })

  it('is a tall sheet: the whole height below the 64 px gap, so it doesn\'t jump when a chip changes the list', async () => {
    await listed(add())
    expect(dialog().style.height).toBe('calc(100dvh - 64px)')
    fireEvent.click(chip('FOREARMS'))
    expect(dialog().style.height).toBe('calc(100dvh - 64px)')
  })

  it('the PP2d line sits between the header and the chips', async () => {
    await listed(add({ stayOpenAfterAdd: true, eyebrow: 'PUSH 1' }))
    const parts = [screen.getByRole('heading', { level: 2, name: 'Add exercise' }), screen.getByText('Tap to add. The list stays open for the next one.'), chipGroup()]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
  })

  it('×, a tap on the scrim and Escape ask to close and pick nothing', async () => {
    const onClose = vi.fn()
    const onPick = vi.fn()
    await listed(add({ onClose, onPick }))
    fireEvent.click(button('Close'))
    fireEvent.click(document.querySelector('[data-bottom-sheet-scrim]') as HTMLElement)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('is drawn through BottomSheet, outside the container it was rendered in', async () => {
    const { container } = await listed(add())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(dialog().closest('[data-bottom-sheet]')?.parentElement).toBe(document.body)
  })

  it('wraps a name with no break opportunity inside its row instead of running past it', async () => {
    library = [ex('long', 'X'.repeat(80), 'back')]
    await listed(add())
    const name = rowButtons()[0].children[0].children[0] as HTMLElement
    expect(name.style.overflowWrap).toBe('anywhere')
    expect((rowButtons()[0].children[0] as HTMLElement).style.minWidth).toBe('0px')
  })
})

describe('the source', () => {
  const source = (name: string) => readFileSync(join(here, name), 'utf8')

  it('writes no colour literal: the app\'s custom properties only', () => {
    for (const name of ['ExercisePickerSheet.tsx', 'exercisePickerLogic.ts']) {
      const text = source(name)
      expect(text.match(/#[0-9a-fA-F]{3,6}\b/g), `${name} has a hex colour`).toBeNull()
      expect(text.match(/\b(?:rgb|rgba|hsl|hsla)\(/g), `${name} has a colour function`).toBeNull()
    }
  })

  it('reads the exercises and creates one through the library\'s own hooks, and imports nothing else from src/features', () => {
    const importsOf = (name: string) => [...source(name).matchAll(/^import [^']*from '([^']+)'/gm)].map((m) => m[1])
    expect(importsOf('ExercisePickerSheet.tsx').filter((path) => /features/.test(path))).toEqual(['../features/library/useExercises'])
    // the rules are plain functions: no React, no screen, no query
    expect(importsOf('exercisePickerLogic.ts')).toEqual(['../types', '../lib/exerciseTags'])
  })
})

describe('draws the boards', () => {
  it('PL4: swap, CHANGE THE PROGRAM, on BACK: the eyebrow, the title, the chips, six ⇄ rows with their group, no create row', async () => {
    library = [LAT, ROW, MACHINE, PULLUP, ex('sacr', 'Single-Arm Cable Row', 'back'), ex('straight', 'Straight-Arm Pulldown', 'back'), ex('tbar', 'T-Bar Row', 'back'), SQUAT, CURL]
    renderWithPage(swap({ eyebrow: 'PULL 1 · FROM WEEK 2', title: 'Swap Lat Pulldown' }), 'CHANGE THE PROGRAM')
    await list()
    expect(pressed()).toEqual(['BACK'])
    expect(names(rowButtons())).toEqual(['Chest-Supported Row', 'Machine Pulldown', 'Pull-Up', 'Single-Arm Cable Row', 'Straight-Arm Pulldown', 'T-Bar Row'])
    expect(rowButtons().map(rowGroup)).toEqual(Array(6).fill('BACK'))
    expect(screen.queryByRole('button', { name: /NEW .* EXERCISE/ })).toBeNull()
    captureRender('exercise-picker-pl4', document.body)
  })

  it('PL5: add, CHANGE THE PROGRAM, on ALL: nine + rows with their group', async () => {
    library = [SQUAT, ex('cable', 'Cable Curl', 'biceps'), ROW, CURL, ex('hang', 'Hanging Leg Raise', 'core'), PRESS, ex('lat-raise', 'Lateral Raise', 'shoulders'), MACHINE, FLY]
    renderWithPage(add({ eyebrow: 'PULL 1 · FROM WEEK 2', title: 'Add exercise' }), 'CHANGE THE PROGRAM')
    await list()
    expect(pressed()).toEqual(['ALL'])
    expect(names(rowButtons())).toEqual(['Back Squat', 'Cable Curl', 'Chest-Supported Row', 'Hammer Curl', 'Hanging Leg Raise', 'Incline Dumbbell Press', 'Lateral Raise', 'Machine Pulldown', 'Pec Deck Fly'])
    expect(rowButtons().map(rowGroup)).toEqual(['QUADS', 'BICEPS', 'BACK', 'BICEPS', 'CORE', 'CHEST', 'SHOULDERS', 'BACK', 'CHEST'])
    captureRender('exercise-picker-pl5', document.body)
  })

  it('PL6: add, a group with nothing in it: NONE IN THIS GROUP', async () => {
    renderWithPage(add({ eyebrow: 'PULL 1 · FROM WEEK 2', title: 'Add exercise' }), 'CHANGE THE PROGRAM')
    await list()
    fireEvent.click(chip('FOREARMS'))
    expect(pressed()).toEqual(['FOREARMS'])
    expect(screen.getByText('NONE IN THIS GROUP')).toBeTruthy()
    captureRender('exercise-picker-pl6', document.body)
  })

  it('PP2d: add on CHEST, the stepped planner: the line, the chips, eight rows with a + and the name alone', async () => {
    library = ['Barbell Bench Press', 'Bench Supported Incline Cable Fly', 'Chest Press', 'Dumbbell Bench Press', 'Dumbbell Fly', 'Incline Barbell Bench Press', 'Incline Smith Press', 'Push-Up'].map((name, i) => ex(`chest-${i}`, name, 'chest'))
    renderWithPage(add({ eyebrow: 'PUSH 1', title: 'Add exercise', stayOpenAfterAdd: true, showGroup: false }), 'Bulk')
    await list()
    fireEvent.click(chip('CHEST'))
    expect(screen.getByText('Tap to add. The list stays open for the next one.')).toBeTruthy()
    expect(names(rowButtons())).toEqual(['Barbell Bench Press', 'Bench Supported Incline Cable Fly', 'Chest Press', 'Dumbbell Bench Press', 'Dumbbell Fly', 'Incline Barbell Bench Press', 'Incline Smith Press', 'Push-Up'])
    expect(rowButtons().map((row) => row.getAttribute('aria-label'))[0]).toBe('Add Barbell Bench Press')
    captureRender('exercise-picker-pp2d', document.body)
  })

  it('PP2d2: every exercise already in the workout: ALL EXERCISES ADDED', async () => {
    renderPicker(add({ eyebrow: 'PUSH 1', title: 'Add exercise', stayOpenAfterAdd: true, showGroup: false, exclude: LIBRARY.map((e) => e.id) }))
    await screen.findByText('ALL EXERCISES ADDED')
    expect(pressed()).toEqual(['ALL'])
    captureRender('exercise-picker-pp2d2-all-added', document.body)
  })

  it('PP2d2: nothing left in the group: NONE IN THIS GROUP', async () => {
    renderPicker(add({ eyebrow: 'PUSH 1', title: 'Add exercise', stayOpenAfterAdd: true, showGroup: false, exclude: ['press', 'fly'] }))
    await list()
    fireEvent.click(chip('CHEST'))
    expect(screen.getByText('NONE IN THIS GROUP')).toBeTruthy()
    expect(pressed()).toEqual(['CHEST'])
    captureRender('exercise-picker-pp2d2-none-in-group', document.body)
  })

  it('W11: swap for today: radio rows without a group, the dashed row, the line naming the pick, SWAP FOR TODAY', async () => {
    library = [LAT, ROW, MACHINE, PULLUP, ex('sacr', 'Single-Arm Cable Row', 'back'), ex('straight', 'Straight-Arm Pulldown', 'back'), ex('tbar', 'T-Bar Row', 'back')]
    renderWithPage(
      swap({
        eyebrow: 'LAT PULLDOWN · TODAY ONLY',
        title: 'Swap for what?',
        showGroup: false,
        onCreate: noop,
        confirmLabel: 'SWAP FOR TODAY',
        confirmNote: (picked) => (picked ? `The set left moves to ${picked.name}. Next week's plan stays the same.` : "Next week's plan stays the same."),
      }),
      'PULL 1',
    )
    await list()
    fireEvent.click(radios()[1])
    expect(names(radios())).toEqual(['Chest-Supported Row', 'Machine Pulldown', 'Pull-Up', 'Single-Arm Cable Row', 'Straight-Arm Pulldown', 'T-Bar Row'])
    const parts = [
      within(dialog()).getByText('LAT PULLDOWN · TODAY ONLY'),
      within(dialog()).getByRole('heading', { level: 2, name: 'Swap for what?' }),
      chipGroup(),
      radios()[0],
      radios()[5],
      button('+ NEW BACK EXERCISE'),
      screen.getByText("The set left moves to Machine Pulldown. Next week's plan stays the same."),
      button('SWAP FOR TODAY'),
    ]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    captureRender('exercise-picker-w11', document.body)
  })

  it('W13: add an exercise, on ALL: › rows without a group and the line under the list', async () => {
    library = ['Barbell Row', 'Bulgarian Split Squat', 'Cable Crunch', 'Chest-Supported Row', 'Dips', 'Hammer Curl', 'Incline Dumbbell Press', 'Lateral Raise', 'Leg Press'].map((name, i) => ex(`w13-${i}`, name, 'back'))
    renderWithPage(add({ eyebrow: 'PULL 1 · TODAY', title: 'Add an exercise', showGroup: false, onCreate: noop, confirmLabel: 'ADD EXERCISE' }), 'PULL 1')
    await list()
    expect(names(rowButtons())).toEqual(['Barbell Row', 'Bulgarian Split Squat', 'Cable Crunch', 'Chest-Supported Row', 'Dips', 'Hammer Curl', 'Incline Dumbbell Press', 'Lateral Raise', 'Leg Press'])
    expect(follows(rowButtons()[8], screen.getByText('Pick a muscle group to create a new exercise.'))).toBe(true)
    captureRender('exercise-picker-w13', document.body)
  })

  it('W14: add Hammer Curl? BACK and ADD EXERCISE', async () => {
    renderWithPage(
      add({ eyebrow: 'PULL 1 · TODAY', title: 'Add an exercise', showGroup: false, onCreate: noop, confirmLabel: 'ADD EXERCISE', confirmNote: () => "Only today's session changes; the plan stays the same." }),
      'PULL 1',
    )
    await list()
    fireEvent.click(button('Add Hammer Curl'))
    captureRender('exercise-picker-w14', document.body)
  })

  it('W15: swap, creating a new exercise: the field, CANCEL and CREATE, then the list', async () => {
    library = [LAT, ROW, MACHINE, PULLUP]
    renderPicker(swap({ eyebrow: 'LAT PULLDOWN · TODAY ONLY', title: 'Swap for what?', showGroup: false, onCreate: noop, confirmLabel: 'SWAP FOR TODAY' }))
    await list()
    fireEvent.click(button('+ NEW BACK EXERCISE'))
    type('Kneeling Pulldown')
    captureRender('exercise-picker-w15-create', document.body)
  })

  it('W15: swap, saving the new exercise: CANCEL greyed, CREATING…', async () => {
    service.createExercise.mockReturnValue(new Promise(() => {}))
    library = [LAT, ROW, MACHINE, PULLUP]
    renderPicker(swap({ eyebrow: 'LAT PULLDOWN · TODAY ONLY', title: 'Swap for what?', showGroup: false, onCreate: noop, confirmLabel: 'SWAP FOR TODAY' }))
    await list()
    fireEvent.click(button('+ NEW BACK EXERCISE'))
    type('Kneeling Pulldown')
    fireEvent.click(button('CREATE'))
    await screen.findByRole('button', { name: 'CREATING…' })
    captureRender('exercise-picker-w15-saving', document.body)
  })

  it('W15: add, a group with nothing in it: No forearms exercises yet. + NEW FOREARMS EXERCISE', async () => {
    renderPicker(add({ eyebrow: 'PULL 1 · TODAY', title: 'Add an exercise', showGroup: false, onCreate: noop }))
    await list()
    fireEvent.click(chip('FOREARMS'))
    expect(screen.getByText('No forearms exercises yet.')).toBeTruthy()
    captureRender('exercise-picker-w15-group-empty', document.body)
  })

  it('W15: add, an empty library: No exercises yet. Pick a muscle group to create one.', async () => {
    library = []
    renderPicker(add({ eyebrow: 'PULL 1 · TODAY', title: 'Add an exercise', showGroup: false, onCreate: noop }))
    await screen.findByText('No exercises yet. Pick a muscle group to create one.')
    captureRender('exercise-picker-w15-library-empty', document.body)
  })
})

describe('text on the accent is --on-accent, never --base (DECISIONS 130 (j), Adam 2026-10-15)', () => {
  it("W11: the swap button is greyed until a row is picked; once it is, SWAP FOR TODAY is the one thing on the accent", async () => {
    library = [LAT, ROW, MACHINE]
    renderPicker(swap({ title: 'Swap for what?', showGroup: false, confirmLabel: 'SWAP FOR TODAY' }))
    await list()
    expect(textOnAccent(document.body)).toEqual([])
    fireEvent.click(radios()[0])
    const onAccent = textOnAccent(document.body)
    expect(onAccent.map((el) => el.textContent)).toEqual(['SWAP FOR TODAY'])
    expect(onAccent[0].style.color).toBe('var(--on-accent)')
  })

  it("W14: ADD EXERCISE is on the accent in --on-accent", async () => {
    renderPicker(add({ title: 'Add an exercise', showGroup: false, confirmLabel: 'ADD EXERCISE' }))
    await list()
    fireEvent.click(button('Add Hammer Curl'))
    const onAccent = textOnAccent(document.body)
    expect(onAccent.map((el) => el.textContent)).toEqual(['ADD EXERCISE'])
    expect(onAccent[0].style.color).toBe('var(--on-accent)')
  })

  it('the create form: CREATE is on the accent in --on-accent (and so is CREATING… while it saves)', async () => {
    service.createExercise.mockReturnValue(new Promise(() => {}))
    library = [LAT, ROW]
    renderPicker(swap({ title: 'Swap for what?', showGroup: false, onCreate: noop, confirmLabel: 'SWAP FOR TODAY' }))
    await list()
    fireEvent.click(button('+ NEW BACK EXERCISE'))
    type('Kneeling Pulldown')
    expect(textOnAccent(document.body).map((el) => el.textContent)).toEqual(['CREATE'])
    expect(textOnAccent(document.body)[0].style.color).toBe('var(--on-accent)')
    fireEvent.click(button('CREATE'))
    await screen.findByRole('button', { name: 'CREATING…' })
    expect(textOnAccent(document.body).map((el) => [el.textContent, el.style.color])).toEqual([['CREATING…', 'var(--on-accent)']])
  })
})

describe('a name with no break opportunity wraps inside its line (DECISIONS 130 (m), Adam 2026-10-15)', () => {
  const LONG = 'X'.repeat(80)

  // jsdom lays nothing out: these hold the rule that gives the wrap (on the element that draws the text), and the
  // fixtures they capture are measured in Chromium at 375 px by `node scripts/check-sheet-overflow.mjs`.
  it("W11: the line over the button wraps the picked exercise's name, and so do its row, the eyebrow and the title", async () => {
    library = [LAT, ROW, ex('long', LONG, 'back')]
    renderWithPage(
      swap({
        eyebrow: `${LONG} · TODAY ONLY`,
        title: 'Swap for what?',
        showGroup: false,
        onCreate: noop,
        confirmLabel: 'SWAP FOR TODAY',
        confirmNote: (picked) => (picked ? `The set left moves to ${picked.name}. Next week's plan stays the same.` : "Next week's plan stays the same."),
      }),
      'PULL 1',
    )
    await list()
    fireEvent.click(radios().find((row) => rowName(row) === LONG) as HTMLElement)
    // captured before anything is asserted, so a fixture is written even when a rule is broken (the Chromium check needs one)
    captureRender('exercise-picker-w11-long-name', document.body)
    const line = screen.getByText(`The set left moves to ${LONG}. Next week's plan stays the same.`)
    expect(line.style.overflowWrap).toBe('anywhere')
    expect(within(dialog()).getByText(`${LONG} · TODAY ONLY`).style.overflowWrap).toBe('anywhere')
    const name = radios().find((row) => rowName(row) === LONG) as HTMLElement
    expect((name.children[0].children[0] as HTMLElement).style.overflowWrap).toBe('anywhere')
  })

  it('W14: the title names the exercise being added, and the line under it, in one long word each', async () => {
    library = [LAT, ex('long', LONG, 'back')]
    renderWithPage(
      add({ eyebrow: 'PULL 1 · TODAY', title: 'Add an exercise', showGroup: false, onCreate: noop, confirmLabel: 'ADD EXERCISE', confirmNote: (picked) => `Only today's session changes. ${picked?.name ?? ''}` }),
      'PULL 1',
    )
    await list()
    fireEvent.click(button(`Add ${LONG}`))
    captureRender('exercise-picker-w14-long-name', document.body)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe(`Add ${LONG}?`)
    expect(heading.style.overflowWrap).toBe('anywhere')
    const line = screen.getByText(`Only today's session changes. ${LONG}`)
    expect(line.style.overflowWrap).toBe('anywhere')
  })

  it("the reason a create failed wraps too: a server message can be one long word", async () => {
    service.createExercise.mockRejectedValue({ message: LONG })
    library = [LAT, ROW]
    renderPicker(swap({ title: 'Swap for what?', showGroup: false, onCreate: noop, confirmLabel: 'SWAP FOR TODAY' }))
    await list()
    fireEvent.click(button('+ NEW BACK EXERCISE'))
    type('Kneeling Pulldown')
    fireEvent.click(button('CREATE'))
    const reason = await screen.findByText(LONG)
    expect(reason.style.overflowWrap).toBe('anywhere')
  })
})
