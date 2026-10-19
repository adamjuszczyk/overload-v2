// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { textOnAccent, textOnAccentColours } from '../../testing/textOnAccent'
import WeekTiles from './WeekTiles'
import { weekTiles } from './weekPlanning'

// Chunk 52 (TASKS-1.2 "Plan's header" → WeekTiles; SPEC Screens → Plan screen → Week row; P1.2-6; boards 1, 1b, 1c, 1d, 12). The strip of
// tiles as a component: what each state says and draws, what a tap hands back, the open tile's text on the accent, and where the strip
// is scrolled when it opens. Which tiles there are is `weekTiles`' (chunk 42); the fixtures are its output, so the states here are the
// ones the screen gets.

afterEach(cleanup)

const tilesOf = (plannedWeeks: number[], currentWeek: number) => weekTiles({ plannedWeeks, currentWeek })
const tile = (week: number) => document.querySelector<HTMLElement>(`[data-week="${week}"]`) as HTMLElement
const labels = () => Array.from(document.querySelectorAll('[data-week]')).map((el) => el.getAttribute('aria-label'))

function strip(props: Partial<Parameters<typeof WeekTiles>[0]> = {}) {
  const onOpen = vi.fn()
  const tiles = props.tiles ?? tilesOf([1, 2, 3, 5], 3)
  const utils = render(<WeekTiles tiles={tiles} unit="WEEK" openWeek={3} focusWeek={3} onOpen={onOpen} {...props} />)
  return { ...utils, onOpen }
}

describe('what each tile says and draws', () => {
  it('DONE (a tick), THIS WEEK, NOT PLANNED (the lock) and PLANNED, each named by its week and its state', () => {
    // planned {1, 2, 3, 5} with week 3 current: the strip stops at week 4, the first unplanned week after the current one
    strip({ tiles: tilesOf([1, 2, 3, 4], 3), openWeek: 3 })
    expect(labels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · PLANNED', 'WEEK 5 · NOT PLANNED'])
    expect(tile(1).textContent).toBe('WEEK 1DONE')
    expect(tile(3).textContent).toBe('WEEK 3THIS WEEK')
    expect(tile(4).textContent).toBe('WEEK 4PLANNED')
    expect(tile(5).textContent).toBe('WEEK 5NOT PLANNED')
    // a tick on DONE, the lock on NOT PLANNED, neither on the others
    expect(tile(1).querySelector('svg.lucide-check')).not.toBeNull()
    expect(tile(5).querySelector('svg.lucide-lock')).not.toBeNull()
    for (const week of [2, 3, 4]) expect(tile(week).querySelector('svg.lucide-lock')).toBeNull()
    for (const week of [3, 4, 5]) expect(tile(week).querySelector('svg.lucide-check')).toBeNull()
  })

  it('a week nobody planned in the past is NOT PLANNED with the lock too, so a week off reads as a week with nothing in it (DECISIONS 131)', () => {
    strip({ tiles: tilesOf([2, 3], 3) })
    expect(labels()).toEqual(['WEEK 1 · NOT PLANNED', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · NOT PLANNED'])
    expect(tile(1).querySelector('svg.lucide-lock')).not.toBeNull()
    expect(tile(1).style.borderStyle).toBe('dashed')
    expect(tile(4).style.borderStyle).toBe('dashed')
  })

  it('a sequence run says CYCLE and THIS CYCLE, and the strip is named for cycles', () => {
    strip({ unit: 'CYCLE', tiles: tilesOf([1, 2], 2), openWeek: 2, focusWeek: 2 })
    expect(labels()).toEqual(['CYCLE 1 · DONE', 'CYCLE 2 · THIS CYCLE', 'CYCLE 3 · NOT PLANNED'])
    expect(screen.getByLabelText('Cycles of this program')).toBeTruthy()
    expect(screen.queryByLabelText('Weeks of this program')).toBeNull()
    expect(document.body.textContent).not.toMatch(/WEEK/)
  })

  it('the open tile is the one marked current, and only it', () => {
    strip({ openWeek: 2 })
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
    expect(tile(2).getAttribute('aria-current')).toBe('true')
    expect(tile(3).getAttribute('aria-current')).toBeNull()
  })

  it('a tap hands back that tile\'s week, whatever its state, and nothing else is called', () => {
    const { onOpen } = strip({ tiles: tilesOf([1, 2, 3], 3), openWeek: 3 })
    for (const week of [1, 4, 2, 3]) fireEvent.click(tile(week))
    expect(onOpen.mock.calls).toEqual([[1], [4], [2], [3]])
  })

  it('no tile, no button: an empty strip draws no tile (the run\'s weeks have not been read)', () => {
    strip({ tiles: [] })
    expect(document.querySelectorAll('[data-week]')).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('each tile is a third of the strip less the gaps, so the strip scrolls sideways past three', () => {
    strip()
    // (jsdom writes the calc the other way round: one third of the strip less the two gaps of 8 px)
    for (const el of document.querySelectorAll<HTMLElement>('[data-week]')) expect(el.style.flex).toMatch(/^0 0 calc\(.*100% - 16px.*\)$/)
    const row = screen.getByLabelText('Weeks of this program')
    expect(row.style.overflowX).toBe('auto')
    expect(row.className).toContain('hide-scrollbar')
  })
})

describe('text on the accent is --on-accent (DECISIONS 128 (g), the rebuilt screens)', () => {
  it('the open tile is the accent\'s: its name and its state line draw in --on-accent, in every state it can be open', () => {
    for (const open of [1, 3, 4, 5]) {
      const { container, unmount } = strip({ tiles: tilesOf([1, 2, 3, 4], 3), openWeek: open })
      expect(textOnAccent(container)).toEqual([tile(open)])
      expect(textOnAccentColours(container)).toEqual(['var(--on-accent)'])
      const parts = within(tile(open)).getAllByText(/./) // the name and the state line
      for (const part of parts.filter((el) => el.tagName === 'SPAN' && el.parentElement === tile(open))) {
        expect(part.style.color === '' || part.style.color === 'var(--on-accent)').toBe(true)
      }
      const stateLine = tile(open).querySelectorAll<HTMLElement>(':scope > span')[1]
      expect(stateLine.style.color).toBe('var(--on-accent)')
      unmount()
    }
  })

  it('a tile that is not open never has the accent behind it, and draws no --on-accent', () => {
    const { container } = strip({ openWeek: 3 })
    for (const week of [1, 2, 4]) {
      expect(tile(week).style.background).not.toBe('var(--accent)')
      expect(tile(week).style.color).not.toBe('var(--on-accent)')
    }
    expect(textOnAccent(container)).toEqual([tile(3)])
  })

  it('the current week\'s tile, when it is not open, is outlined in the accent (board 1c) and says THIS WEEK in it', () => {
    strip({ tiles: tilesOf([1, 2, 3], 3), openWeek: 1 })
    expect(tile(3).style.borderColor).toBe('var(--accent)')
    expect(tile(3).style.background).toBe('var(--surface)')
    const stateLine = tile(3).querySelectorAll<HTMLElement>(':scope > span')[1]
    expect(stateLine.style.color).toBe('var(--accent)')
  })
})

describe('the strip opens scrolled to the current tile (P1.2-6)', () => {
  // jsdom has no layout: a tile is 100 px per week from the strip's left edge and 90 px wide, the strip 300 px wide.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.week ? (Number(this.dataset.week) - 1) * 100 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.week ? 90 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-label')?.endsWith('of this program') ? 300 : 0
    })
  })
  afterEach(() => vi.restoreAllMocks())

  const row = () => screen.getByLabelText('Weeks of this program')

  it('on the first render the current tile is centred: left edge − (strip − tile) / 2', () => {
    strip({ tiles: tilesOf([1, 2, 3, 4, 5, 6], 5), openWeek: 5, focusWeek: 5 })
    // week 5 starts at 400; centred in 300 px with a 90 px tile: 400 − 105 = 295
    expect(row().scrollLeft).toBe(295)
  })

  it('opened on another tile, it is still the CURRENT week\'s tile that is in view, not the open one', () => {
    strip({ tiles: tilesOf([1, 2, 3, 4, 5, 6], 5), openWeek: 1, focusWeek: 5 })
    expect(row().scrollLeft).toBe(295)
  })

  it('never negative: the first tile\'s centre is left of the edge', () => {
    strip({ tiles: tilesOf([1, 2, 3], 1), openWeek: 1, focusWeek: 1 })
    expect(row().scrollLeft).toBe(0)
  })

  it('a re-render that opens another tile leaves the strip where the user scrolled it', () => {
    const { rerender, onOpen } = strip({ tiles: tilesOf([1, 2, 3, 4, 5, 6], 5), openWeek: 5, focusWeek: 5 })
    row().scrollLeft = 17 // the user scrolled
    rerender(<WeekTiles tiles={tilesOf([1, 2, 3, 4, 5, 6], 5)} unit="WEEK" openWeek={2} focusWeek={5} onOpen={onOpen} />)
    expect(row().scrollLeft).toBe(17)
    rerender(<WeekTiles tiles={tilesOf([1, 2, 3, 4, 5, 6, 7], 5)} unit="WEEK" openWeek={2} focusWeek={5} onOpen={onOpen} />) // a week planned ahead
    expect(row().scrollLeft).toBe(17)
  })

  it('when the current week moves on (Plan left open over Sunday midnight) the strip goes to the new one', () => {
    const { rerender, onOpen } = strip({ tiles: tilesOf([1, 2, 3, 4, 5, 6], 4), openWeek: 4, focusWeek: 4 })
    expect(row().scrollLeft).toBe(195) // week 4: 300 − 105
    rerender(<WeekTiles tiles={tilesOf([1, 2, 3, 4, 5, 6], 5)} unit="WEEK" openWeek={4} focusWeek={5} onOpen={onOpen} />)
    expect(row().scrollLeft).toBe(295)
  })

  it('tiles that arrive after the first render (the run\'s weeks are read) are scrolled to as they come', () => {
    const onOpen = vi.fn()
    const { rerender } = render(<WeekTiles tiles={[]} unit="WEEK" openWeek={5} focusWeek={5} onOpen={onOpen} />)
    expect(row().scrollLeft).toBe(0)
    rerender(<WeekTiles tiles={tilesOf([1, 2, 3, 4, 5, 6], 5)} unit="WEEK" openWeek={5} focusWeek={5} onOpen={onOpen} />)
    expect(row().scrollLeft).toBe(295)
  })

  it('a current week with no tile (it can\'t happen, but the strip must not throw) leaves the strip alone', () => {
    strip({ tiles: tilesOf([1, 2], 2), openWeek: 2, focusWeek: 9 })
    expect(row().scrollLeft).toBe(0)
  })
})
