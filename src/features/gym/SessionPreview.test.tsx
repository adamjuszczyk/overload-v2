// @vitest-environment jsdom
// Chunk 77 (1.2.1 item 4; SPEC "PREVIEW SESSION"; the prototype's "PREVIEW SESSION": New design, Week not planned yet) — the preview in the workout's design,
// from board W1's data (`previewWorld.testutil.ts`, the world `GymSession.boards.test.tsx` builds). Each rule is asserted on the screen that draws it, with
// a world that tells its right source from the wrong one; `CAPTURE_RENDER=1 npx vitest run src/features/gym/SessionPreview.test.tsx` writes the two
// render fixtures `npm run shot` turns into design/1.2.1/built/preview-session-*.png.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'
import type { ProgramExercise, ProgramSupersetBlock, WeekPlan } from '../../types'
import type { ReferenceSession } from './sessionService'
import { captureRender } from '../../testing/captureRender'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { blocks, lastByExercise, noSetsPlan, peEz, peFace, peLat, peRow, plannedSet, programExercise, w1Plan, workoutDay } from './previewWorld.testutil'

afterEach(() => cleanup())

// What the screen's three reads say, and what each was asked: a mock that answers whatever it is asked hides which argument the page passed (RULES).
const world = {
  fallback: [] as ProgramExercise[],
  fallbackPending: false,
  blocks: blocks as ProgramSupersetBlock[],
  reference: { data: lastByExercise as Map<string, ReferenceSession[]>, isLoading: false, isError: false, isFromCache: false },
}
const retry = vi.fn()
const reads = {
  program: vi.fn((_workoutDayId: string) => ({ data: world.fallback, isPending: world.fallbackPending })),
  blocks: vi.fn((_workoutDayId: string) => ({ data: world.blocks })),
  reference: vi.fn((_workoutDayId: string, _exerciseIds: string[], _currentSessionId: string | null) => ({ ...world.reference, retry })),
}
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: (workoutDayId: string) => reads.program(workoutDayId),
  useSupersetBlockRests: (workoutDayId: string) => reads.blocks(workoutDayId),
}))
vi.mock('./useSession', () => ({
  useExerciseReferenceSessions: (workoutDayId: string, exerciseIds: string[], currentSessionId: string | null) => reads.reference(workoutDayId, exerciseIds, currentSessionId),
}))
vi.mock('../offline/useSyncQueue', () => ({ retrySyncFailures: vi.fn() }))

const { default: SessionPreview } = await import('./SessionPreview')
type Props = ComponentProps<typeof SessionPreview>

const TODAY = '2026-01-06' // a Tuesday: last week's Tuesday reads "LAST = LAST WEEK, TUE"

beforeEach(() => {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
  world.fallback = []
  world.fallbackPending = false
  world.blocks = blocks
  world.reference = { data: lastByExercise, isLoading: false, isError: false, isFromCache: false }
  retry.mockClear()
  reads.program.mockClear()
  reads.blocks.mockClear()
  reads.reference.mockClear()
})

function renderPreview(over: Partial<Props> = {}) {
  const props: Props = { workoutDay, weekPlan: w1Plan, today: TODAY, isStarting: false, eyebrow: 'WEEK 2 · TUESDAY', onBack: vi.fn(), onStart: vi.fn(), ...over }
  const view = render(
    <MemoryRouter>
      <SessionPreview {...props} />
    </MemoryRouter>,
  )
  return { ...view, props }
}

const card = (container: HTMLElement, programExerciseId: string) => container.querySelector(`[data-preview-exercise="${programExerciseId}"]`) as HTMLElement
const lastLineOf = (scope: Element) => scope.querySelector('[data-last-line]') as HTMLElement

/** One set as the screen says it, a line per row: "01 55 kg × 9 @ RIR 2", "↳ 40 kg × AMRAP @ RIR 0", then the cue's words. */
const linesOf = (group: Element): string[] =>
  Array.from(group.children).map((row) => {
    const parts = Array.from(row.querySelectorAll('span')).map((span) => span.textContent)
    return parts.length > 0 ? parts.join(' ') : (row.textContent ?? '')
  })
const setsIn = (scope: Element): string[][] => Array.from(scope.querySelectorAll('[data-preview-set]')).map(linesOf)

/** A plan for the given exercises and sets (week 2 of the run, nothing deload). */
const planOf = (exercises: ProgramExercise[], sets: WeekPlan['sets']): WeekPlan => ({ ...w1Plan, exercises, sets })

describe('PREVIEW SESSION — the header', () => {
  it('back, "[eyebrow] · PREVIEW" with the eyebrow as it was handed in, the workout\'s name', () => {
    const { props } = renderPreview({ eyebrow: 'DELOAD · WEEK 2 · TUESDAY' })
    expect(screen.getByText('DELOAD · WEEK 2 · TUESDAY · PREVIEW')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PULL 1')
    fireEvent.click(screen.getByLabelText('Back to Today'))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('the eyebrow is the prop, not the plan\'s own week (told apart: the plan says week 2 and no deload)', () => {
    renderPreview({ eyebrow: 'CYCLE 3 · SLOT 2' })
    expect(screen.getByText('CYCLE 3 · SLOT 2 · PREVIEW')).toBeTruthy()
    expect(screen.queryByText(/WEEK 2/)).toBeNull()
  })
})

describe('PREVIEW SESSION — each exercise under the workout\'s header', () => {
  it('in plan order whatever order the list came in: name, muscle, tempo, and the LAST line', () => {
    const shuffled = planOf([peEz, peRow, peLat, peFace], w1Plan.sets)
    const { container } = renderPreview({ weekPlan: shuffled })
    expect(Array.from(container.querySelectorAll('[data-preview-exercise]')).map((el) => el.getAttribute('data-preview-exercise'))).toEqual(['xe-lat', 'xe-row', 'xe-face', 'xe-ez'])
    for (const [id, name, muscle] of [['xe-lat', 'Lat Pulldown', 'BACK'], ['xe-row', 'Seated Cable Row', 'BACK'], ['xe-face', 'Face Pull', 'REAR DELTS'], ['xe-ez', 'EZ Bar Curl', 'BICEPS']]) {
      const scope = within(card(container, id))
      expect(scope.getByText(name)).toBeTruthy()
      expect(scope.getByText(muscle)).toBeTruthy()
    }
    expect(within(card(container, 'xe-ez')).getByText('3-0-1-0')).toBeTruthy()
    expect(Array.from(container.querySelectorAll('[data-last-line]')).map((el) => el.textContent)).toEqual(Array(4).fill('LAST = LAST WEEK, TUE'))
  })

  it('the LAST line opens the last-time sheet, and the sheet reads that exercise\'s own reference', () => {
    const { container } = renderPreview()
    fireEvent.click(lastLineOf(card(container, 'xe-lat')))
    const sheet = within(screen.getByRole('dialog'))
    for (const word of ['LAT PULLDOWN', 'Last time', 'LAST WEEK', 'TUE 30 DEC', '52.5 × 10', 'FULL HISTORY']) expect(sheet.getByText(word)).toBeTruthy()
    expect(sheet.queryByText('30 × 8')).toBeNull() // the curl's, not this exercise's
  })

  it('a reference still being read says so on the line; one that could not be read is its own line with RETRY, which asks the read again', () => {
    world.reference = { data: new Map(), isLoading: true, isError: false, isFromCache: false }
    const loading = renderPreview()
    expect(Array.from(loading.container.querySelectorAll('[data-last-line]')).map((el) => el.textContent)).toEqual(Array(4).fill('LAST = ···'))
    cleanup()

    world.reference = { data: new Map(), isLoading: false, isError: true, isFromCache: false }
    const failed = renderPreview()
    expect(within(card(failed.container, 'xe-lat')).getByText("COULDN'T LOAD LAST TIME")).toBeTruthy()
    fireEvent.click(within(card(failed.container, 'xe-lat')).getByText('RETRY'))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('numbers read from the phone\'s cache are marked in the sheet', () => {
    world.reference = { data: lastByExercise, isLoading: false, isError: false, isFromCache: true }
    const { container } = renderPreview()
    fireEvent.click(lastLineOf(card(container, 'xe-lat')))
    expect(within(screen.getByRole('dialog')).getByText('OFFLINE · CACHED')).toBeTruthy()
  })

  it('weights are in each exercise\'s own unit: Settings\' lbs for the one with no override, its own kg for the one that has one (rows and sheet alike)', () => {
    useSettingsStore.setState({ weightUnit: 'lbs' })
    const kgCurl = { ...peEz, weightUnit: 'kg' as const }
    const plan = planOf([peLat, kgCurl], w1Plan.sets.filter((set) => set.programExerciseId === 'xe-lat' || set.programExerciseId === 'xe-ez'))
    const { container } = renderPreview({ weekPlan: plan })
    expect(setsIn(card(container, 'xe-lat'))[0]).toEqual(['01 121.3 lbs × 9 @ RIR 2']) // 55 kg
    expect(setsIn(card(container, 'xe-lat'))[2][0]).toBe('03 115.7 lbs × 8–10 @ RIR 1 DROPSET · 1 DROP') // 52.5 kg
    expect(setsIn(card(container, 'xe-ez'))[1]).toEqual(['01 30 kg × 8 @ RIR 1'])
    fireEvent.click(lastLineOf(card(container, 'xe-lat')))
    expect(within(screen.getByRole('dialog')).getByText('115.7 × 10')).toBeTruthy() // last week's 52.5 kg
    cleanup()
    const again = renderPreview({ weekPlan: plan })
    fireEvent.click(lastLineOf(card(again.container, 'xe-ez')))
    expect(within(screen.getByRole('dialog')).getByText('30 × 8')).toBeTruthy()
  })
})

describe('PREVIEW SESSION — each set as an upcoming row', () => {
  it('a plain exercise: the set number and its targets, in set order (W1: Lat Pulldown)', () => {
    const { container } = renderPreview()
    const lat = setsIn(card(container, 'xe-lat'))
    expect(lat.map((lines) => lines[0])).toEqual(['01 55 kg × 9 @ RIR 2', '02 55 kg × 8 @ RIR 1', '03 52.5 kg × 8–10 @ RIR 1 DROPSET · 1 DROP'])
    // a target range reads as a range, with no weight the targets are only the reps and the RIR
    const sets = [
      plannedSet('r-1', 'xe-lat', 1, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
      plannedSet('r-2', 'xe-lat', 2, { repMin: 8, repMax: 8, targetRir: 2 }),
      plannedSet('r-3', 'xe-lat', 3, { isAmrap: true, targetRir: 0 }),
      plannedSet('r-4', 'xe-lat', 4, { targetRir: null }),
    ]
    cleanup()
    const ranges = renderPreview({ weekPlan: planOf([peLat], sets) })
    expect(setsIn(card(ranges.container, 'xe-lat')).map((lines) => lines[0])).toEqual(['01 60 kg × 10–12 @ RIR 1–2', '02 8 @ RIR 2', '03 AMRAP @ RIR 0', '04 —'])
  })

  it('a set\'s number is its rank among the working sets, whatever numbers the plan stores, and a warmup is W (a warmup in position 1 leaves the working sets 01, 02)', () => {
    const sets = [
      plannedSet('ez-w', 'xe-ez', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: null }),
      plannedSet('ez-a', 'xe-ez', 2, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 }),
      plannedSet('ez-b', 'xe-ez', 4, { targetWeight: 32.5, repMin: 6, repMax: 6, targetRir: 0 }),
    ]
    const forward = renderPreview({ weekPlan: planOf([peEz], sets) })
    const expected = [['W 20 kg × 12'], ['01 30 kg × 8 @ RIR 1'], ['02 32.5 kg × 6 @ RIR 0']]
    expect(setsIn(card(forward.container, 'xe-ez'))).toEqual(expected)
    cleanup()
    // the same plan with its sets read in the opposite order draws the same card (the order is the sets' own numbers)
    const reversed = renderPreview({ weekPlan: planOf([peEz], [...sets].reverse()) })
    expect(setsIn(card(reversed.container, 'xe-ez'))).toEqual(expected)
    cleanup()
    // a warmup that sits between the working sets stays where the plan puts it, as the workout draws it
    const middle = [sets[1], { ...sets[0], setNumber: 3 }, sets[2]]
    const between = renderPreview({ weekPlan: planOf([peEz], middle) })
    expect(setsIn(card(between.container, 'xe-ez')).map((lines) => lines[0].split(' ')[0])).toEqual(['01', 'W', '02'])
  })

  it('a warmup is weight and reps only: a RIR target the plan still holds from the set\'s earlier type is not shown (W1: EZ Bar Curl)', () => {
    const { container } = renderPreview()
    expect(setsIn(card(container, 'xe-ez'))).toEqual([['W 20 kg × 12'], ['01 30 kg × 8 @ RIR 1'], ['02 30 kg × AMRAP @ RIR 0', 'CUE']])
    cleanup()
    const stale = [plannedSet('w-stale', 'xe-ez', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: 2, targetRirMax: 3 })]
    const held = renderPreview({ weekPlan: planOf([peEz], stale) })
    expect(setsIn(card(held.container, 'xe-ez'))).toEqual([['W 20 kg × 12']])
  })

  it('a dropset head has the stage chip and its drops under it as ↳ rows, in stage order whatever order they came in (W1: Lat Pulldown 03)', () => {
    const { container } = renderPreview()
    expect(setsIn(card(container, 'xe-lat'))[2]).toEqual(['03 52.5 kg × 8–10 @ RIR 1 DROPSET · 1 DROP', '↳ 40 kg × AMRAP @ RIR 0', 'PUSH HERE'])
    cleanup()
    const sets = [
      plannedSet('rp-1-s2', 'xe-lat', 1, { isDropset: true, parentWeekPlanSetId: 'rp-1', stageIndex: 2, targetWeight: 20, repMin: 5, repMax: 5, targetRir: 0 }),
      plannedSet('rp-1', 'xe-lat', 1, { targetWeight: 20, repMin: 12, repMax: 12, targetRir: 0, stageKind: 'rest_pause' }),
      plannedSet('rp-1-s1', 'xe-lat', 1, { isDropset: true, parentWeekPlanSetId: 'rp-1', stageIndex: 1, targetWeight: 20, repMin: 6, repMax: 6, targetRir: 0 }),
      // a head from before the kind column, with drops and no kind, reads as a dropset
      plannedSet('old-2', 'xe-lat', 2, { targetWeight: 15, repMin: 10, repMax: 10, targetRir: 1, stageKind: null }),
      plannedSet('old-2-d1', 'xe-lat', 2, { isDropset: true, parentWeekPlanSetId: 'old-2', stageIndex: 1, targetWeight: 12, repMin: 10, repMax: 10, targetRir: 0 }),
      plannedSet('old-2-d2', 'xe-lat', 2, { isDropset: true, parentWeekPlanSetId: 'old-2', stageIndex: 2, targetWeight: 10, repMin: 10, repMax: 10, targetRir: 0 }),
    ]
    const kinds = renderPreview({ weekPlan: planOf([peLat], sets) })
    expect(setsIn(card(kinds.container, 'xe-lat'))).toEqual([
      ['01 20 kg × 12 @ RIR 0 REST-PAUSE · 2 STAGES', '↳ 20 kg × 6 @ RIR 0', '↳ 20 kg × 5 @ RIR 0'],
      ['02 15 kg × 10 @ RIR 1 DROPSET · 2 DROPS', '↳ 12 kg × 10 @ RIR 0', '↳ 10 kg × 10 @ RIR 0'],
    ])
  })

  it('cues are under the row, in the cue\'s own words (W1: "push here", "squeeze", "cue")', () => {
    const { container } = renderPreview()
    expect(setsIn(card(container, 'xe-lat'))[2][2]).toBe('PUSH HERE')
    expect(setsIn(card(container, 'xe-ez'))[2][1]).toBe('CUE')
    expect(setsIn(container.querySelector('[data-preview-round="2"]')!)[1]).toEqual(['B2 17.5 kg × 15–20 @ RIR 1', 'SQUEEZE']) // a superset member's cue is under its row in the round
    cleanup()
    const two = [plannedSet('c-1', 'xe-lat', 1, { targetWeight: 50, repMin: 8, repMax: 8, targetRir: 1, tags: ['push here', 'slow'] })]
    const many = renderPreview({ weekPlan: planOf([peLat], two) })
    expect(setsIn(card(many.container, 'xe-lat'))).toEqual([['01 50 kg × 8 @ RIR 1', 'PUSH HERE · SLOW']])
  })
})

describe('PREVIEW SESSION — supersets as the workout draws them', () => {
  it('the link line with the round rest, the lettered members with their headers, then ROUND 1 (A1, B1), ROUND 2 … with unequal counts (W1: Seated Cable Row + Face Pull)', () => {
    const { container } = renderPreview()
    const block = container.querySelector('[data-preview-superset="A"]') as HTMLElement
    expect(block.textContent).toContain('SUPERSET A · REST 1:30 AFTER EACH ROUND')
    for (const [id, letter, name] of [['xe-row', 'A', 'Seated Cable Row'], ['xe-face', 'B', 'Face Pull']]) {
      const member = within(card(container, id))
      expect(member.getByText(letter)).toBeTruthy()
      expect(member.getByText(name)).toBeTruthy()
      expect(lastLineOf(card(container, id)).textContent).toBe('LAST = LAST WEEK, TUE')
    }
    expect(Array.from(block.querySelectorAll('[data-preview-round] > p')).map((p) => p.textContent)).toEqual(['ROUND 1', 'ROUND 2', 'ROUND 3'])
    expect(Array.from(block.querySelectorAll('[data-preview-round]')).map((round) => setsIn(round))).toEqual([
      [['A1 60 kg × 12 @ RIR 2'], ['B1 15 kg × 18 @ RIR 1']],
      [['A2 60 kg × 10–12 @ RIR 1–2'], ['B2 17.5 kg × 15–20 @ RIR 1', 'SQUEEZE']],
      [['A3 60 kg × 10–12 @ RIR 1–2']], // the second member has no third set: a round with an empty slot
    ])
  })

  it('the rest is the block\'s own, found by its id among the workout\'s blocks; a block with no round rest has no rest in its line', () => {
    world.blocks = [
      { id: 'block-other', restAfterRoundSeconds: 45, restWithinRoundSeconds: null },
      { id: 'block-a', restAfterRoundSeconds: 150, restWithinRoundSeconds: null },
    ]
    const timed = renderPreview()
    expect(timed.container.querySelector('[data-preview-superset="A"]')!.textContent).toContain('SUPERSET A · REST 2:30 AFTER EACH ROUND')
    cleanup()
    world.blocks = [{ id: 'block-a', restAfterRoundSeconds: null, restWithinRoundSeconds: 30 }]
    const none = renderPreview()
    const line = none.container.querySelector('[data-preview-superset="A"] span.tracking-widest')!.textContent
    expect(line).toBe('SUPERSET A')
  })

  it('a member\'s warmups are under its header and never in a round; only the working sets make rounds', () => {
    const sets = [
      plannedSet('row-w', 'xe-row', 1, { isWarmup: true, targetWeight: 30, repMin: 12, repMax: 12, targetRir: null }),
      plannedSet('row-a', 'xe-row', 2, { targetWeight: 60, repMin: 12, repMax: 12, targetRir: 2 }),
      plannedSet('face-a', 'xe-face', 1, { targetWeight: 15, repMin: 18, repMax: 18, targetRir: 1 }),
    ]
    const { container } = renderPreview({ weekPlan: planOf([peRow, peFace], sets) })
    const block = container.querySelector('[data-preview-superset="A"]') as HTMLElement
    expect(setsIn(card(container, 'xe-row'))).toEqual([['W 30 kg × 12']])
    expect(setsIn(card(container, 'xe-face'))).toEqual([])
    expect(Array.from(block.querySelectorAll('[data-preview-round]')).map((round) => setsIn(round))).toEqual([[['A1 60 kg × 12 @ RIR 2'], ['B1 15 kg × 18 @ RIR 1']]])
  })

  it('consecutive exercises that share a block are one superset, the blocks are lettered in the order they are drawn, and a lone member is a plain card', () => {
    const member = (id: string, position: number, block: string | null) => programExercise(id, `e-${id}`, `Exercise ${id}`, 'back', position, { supersetBlockId: block })
    const exercises = [member('p1', 0, 'blk-x'), member('p2', 1, 'blk-x'), member('p3', 2, null), member('p4', 3, 'blk-y'), member('p5', 4, 'blk-y'), member('p6', 5, 'blk-y'), member('p7', 6, 'blk-x')]
    world.blocks = [{ id: 'blk-y', restAfterRoundSeconds: 60, restWithinRoundSeconds: null }]
    const sets = exercises.map((pe, i) => plannedSet(`s-${i}`, pe.id, 1, { targetWeight: 10 + i, repMin: 8, repMax: 8, targetRir: 1 }))
    const { container } = renderPreview({ weekPlan: planOf(exercises, sets) })
    const blocksDrawn = Array.from(container.querySelectorAll('[data-preview-superset]'))
    expect(blocksDrawn.map((el) => el.getAttribute('data-preview-superset'))).toEqual(['A', 'B'])
    expect(blocksDrawn.map((el) => Array.from(el.querySelectorAll('[data-preview-exercise]')).map((m) => m.getAttribute('data-preview-exercise')))).toEqual([['p1', 'p2'], ['p4', 'p5', 'p6']])
    expect(blocksDrawn[0].textContent).toContain('SUPERSET A')
    expect(blocksDrawn[0].textContent).not.toContain('REST') // blk-x has no row among the workout's blocks
    expect(blocksDrawn[1].textContent).toContain('SUPERSET B · REST 1:00 AFTER EACH ROUND')
    // p3 (no block) and p7 (the block's member again, but not next to its block) are plain cards, outside both blocks
    for (const id of ['p3', 'p7']) expect(blocksDrawn.some((el) => el.contains(card(container, id)))).toBe(false)
    expect(container.querySelectorAll('[data-preview-exercise]')).toHaveLength(7)
  })
})

describe('PREVIEW SESSION — empty states', () => {
  it('an exercise with no sets says NO SETS PLANNED; its neighbours with sets do not', () => {
    const plan = planOf(w1Plan.exercises, w1Plan.sets.filter((set) => set.programExerciseId !== 'xe-lat'))
    const { container } = renderPreview({ weekPlan: plan })
    expect(card(container, 'xe-lat').textContent).toContain('NO SETS PLANNED')
    expect(setsIn(card(container, 'xe-lat'))).toEqual([])
    expect(card(container, 'xe-ez').textContent).not.toContain('NO SETS PLANNED')
    expect(container.textContent!.match(/NO SETS PLANNED/g)).toHaveLength(1)
  })

  it('a superset with no sets says NO SETS PLANNED once, in its block', () => {
    const plan = planOf(w1Plan.exercises, w1Plan.sets.filter((set) => set.programExerciseId !== 'xe-row' && set.programExerciseId !== 'xe-face'))
    const { container } = renderPreview({ weekPlan: plan })
    const block = container.querySelector('[data-preview-superset="A"]') as HTMLElement
    expect(block.textContent!.match(/NO SETS PLANNED/g)).toHaveLength(1)
    expect(block.querySelectorAll('[data-preview-round]')).toHaveLength(0)
    expect(block.textContent).toContain('SUPERSET A · REST 1:30 AFTER EACH ROUND')
  })

  it('the week not planned yet: the program\'s own exercises, each with NO SETS PLANNED (the plan row is missing, or it holds no sets)', () => {
    world.fallback = [peLat, peRow, peFace, peEz]
    const unplanned = renderPreview({ weekPlan: null })
    const empty = renderPreview({ weekPlan: noSetsPlan })
    for (const { container } of [unplanned, empty]) {
      expect(Array.from(container.querySelectorAll('[data-preview-exercise]')).map((el) => el.getAttribute('data-preview-exercise'))).toEqual(['xe-lat', 'xe-row', 'xe-face', 'xe-ez'])
      expect(container.querySelectorAll('[data-preview-set]')).toHaveLength(0)
      expect(container.textContent!.match(/NO SETS PLANNED/g)).toHaveLength(3) // Lat Pulldown, the superset, EZ Bar Curl
      expect(container.querySelector('[data-preview-superset="A"]')!.textContent).toContain('SUPERSET A · REST 1:30 AFTER EACH ROUND')
    }
  })

  it('a workout with no exercises says so, and START SESSION is still pinned', () => {
    world.fallback = []
    const { container } = renderPreview({ weekPlan: null })
    expect(screen.getByText('No exercises in this workout yet.')).toBeTruthy()
    expect(container.querySelectorAll('[data-preview-exercise]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'START SESSION' })).toBeTruthy()
    cleanup()
    // a planned week whose exercise list is empty says the same
    renderPreview({ weekPlan: planOf([], []) })
    expect(screen.getByText('No exercises in this workout yet.')).toBeTruthy()
  })

  it('until the program\'s exercises have been read it does not say there are none', () => {
    world.fallback = []
    world.fallbackPending = true
    const { container } = renderPreview({ weekPlan: null })
    expect(screen.queryByText('No exercises in this workout yet.')).toBeNull()
    expect(container.querySelectorAll('[data-preview-exercise]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'START SESSION' })).toBeTruthy()
  })
})

describe('PREVIEW SESSION — where the exercises and the reference come from', () => {
  it('a planned week\'s own exercise list wins over the program\'s (told apart: the program lists another exercise)', () => {
    world.fallback = [programExercise('xe-leg', 'ex-leg', 'Leg Press', 'quads', 0)]
    const { container } = renderPreview()
    expect(screen.queryByText('Leg Press')).toBeNull()
    expect(container.querySelectorAll('[data-preview-exercise]')).toHaveLength(4)
    expect(reads.program).toHaveBeenCalledWith('wd-1')
    cleanup()
    // with no plan row the program's list is the only one
    const unplanned = renderPreview({ weekPlan: null })
    expect(Array.from(unplanned.container.querySelectorAll('[data-preview-exercise]')).map((el) => el.getAttribute('data-preview-exercise'))).toEqual(['xe-leg'])
  })

  it('the batched reference is read once for this workout\'s exercises with no current session, and the block rests for this workout', () => {
    renderPreview()
    const asked = reads.reference.mock.calls[reads.reference.mock.calls.length - 1]
    expect(asked[0]).toBe('wd-1')
    expect([...asked[1]].sort()).toEqual(['ex-ez', 'ex-face', 'ex-lat', 'ex-row'])
    expect(asked[2]).toBeNull()
    expect(reads.blocks).toHaveBeenCalledWith('wd-1')
    cleanup()
    // with no plan row the ids are the program's exercises'
    reads.reference.mockClear()
    world.fallback = [peLat]
    renderPreview({ weekPlan: null })
    const unplanned = reads.reference.mock.calls[reads.reference.mock.calls.length - 1]
    expect(unplanned[1]).toEqual(['ex-lat'])
  })
})

describe('PREVIEW SESSION — START SESSION, pinned at the foot', () => {
  it('START SESSION calls onStart once; it is outside the scrolling column, last on the screen', () => {
    const { container, props } = renderPreview()
    const start = screen.getByRole('button', { name: 'START SESSION' })
    const root = container.querySelector('[data-session-preview]') as HTMLElement
    expect(root.lastElementChild!.contains(start)).toBe(true)
    expect(Array.from(root.children).some((child) => child !== root.lastElementChild && child.contains(start))).toBe(false)
    fireEvent.click(start)
    expect(props.onStart).toHaveBeenCalledTimes(1)
    expect(props.onBack).not.toHaveBeenCalled()
  })

  it('while the session is starting it says STARTING… and presses nothing', () => {
    const { props } = renderPreview({ isStarting: true })
    const start = screen.getByRole('button', { name: 'STARTING…' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(props.onStart).not.toHaveBeenCalled()
    expect(screen.queryByText('START SESSION')).toBeNull()
  })
})

describe('PREVIEW SESSION — what the old preview said is gone', () => {
  it('no TARGET RIR rows, no targets panel, no old last-time panel, no history icon that leaves the screen, no "NOTHING LOGGED YET" badge', () => {
    for (const weekPlan of [w1Plan, null]) {
      world.fallback = w1Plan.exercises
      const { container } = renderPreview({ weekPlan })
      const text = container.textContent ?? ''
      for (const old of ['TARGET RIR', 'NO TARGET', 'PLANNED RIR', 'NOTHING LOGGED YET', 'REFERENCE']) expect(text, old).not.toContain(old)
      expect(screen.queryByText('NO PLAN')).toBeNull()
      expect(screen.queryByLabelText('View exercise history')).toBeNull() // the old preview's icon, which went to the exercise's history page
      expect(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([])
      cleanup()
    }
  })
})

// ─── The two DEMO states, as render fixtures (390 px: `npm run shot -- <fixture> design/1.2.1/built/<name>.png`) ───────────────────────────────────────
// Captured after the assertions, so a render that loses a state stops here and the picture is never of the broken one. The screen fills its frame's height
// (its scrolling column scrolls, START SESSION is pinned at the foot): the frame stands where the app's `main` stands, given the phone's whole 844 px
// (in the app the bottom bar takes the last 64 of them).
const Phone = ({ children }: { children: ReactNode }) => <div style={{ height: 844 }}>{children}</div>

describe('PREVIEW SESSION — the DEMO states', () => {
  it('New design: board W1\'s workout, week 2 · Tuesday', () => {
    const { container } = render(
      <MemoryRouter>
        <Phone>
          <SessionPreview workoutDay={workoutDay} weekPlan={w1Plan} today={TODAY} isStarting={false} eyebrow="WEEK 2 · TUESDAY" onBack={() => {}} onStart={() => {}} />
        </Phone>
      </MemoryRouter>,
    )
    const text = container.textContent ?? ''
    for (const word of ['WEEK 2 · TUESDAY · PREVIEW', 'PULL 1', 'Lat Pulldown', 'DROPSET · 1 DROP', 'PUSH HERE', 'SUPERSET A · REST 1:30 AFTER EACH ROUND', 'ROUND 3', 'EZ Bar Curl', 'START SESSION']) {
      expect(text, word).toContain(word)
    }
    expect(text).not.toContain('NO SETS PLANNED')
    captureRender('preview-session-new-design', container)
  })

  it('Week not planned yet: the same exercises, none with sets', () => {
    world.fallback = w1Plan.exercises
    const { container } = render(
      <MemoryRouter>
        <Phone>
          <SessionPreview workoutDay={workoutDay} weekPlan={null} today={TODAY} isStarting={false} eyebrow="WEEK 2 · TUESDAY" onBack={() => {}} onStart={() => {}} />
        </Phone>
      </MemoryRouter>,
    )
    const text = container.textContent ?? ''
    expect(text.match(/NO SETS PLANNED/g)).toHaveLength(3)
    for (const word of ['Lat Pulldown', 'SUPERSET A', 'EZ Bar Curl', 'START SESSION']) expect(text, word).toContain(word)
    captureRender('preview-session-week-not-planned-yet', container)
  })
})
