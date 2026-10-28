// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { findRow, readScrollTop, scrollRowIntoView, scrollToRowKey, writeScrollTop } from './scrollArea'

// Chunk 64 — the workout screen's scroll area (`scrollArea.ts`): the jump button's scroll and GO BACK's are one function, and the two ways back from the finish screen read and write the
// scroller. jsdom lays nothing out, so each rectangle, the scroller's height and its position are set by hand.
afterEach(() => cleanup())

const rect = (top: number) => ({ top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

function scene() {
  const { container } = render(
    <main>
      <div data-row-key="set:a" />
      <div data-row-key="set:b" />
      <div data-row-key="set:c" data-current-set="true" />
    </main>,
  )
  const main = container.querySelector('main') as HTMLElement
  let scrollTop = 300
  Object.defineProperty(main, 'clientHeight', { value: 800, configurable: true })
  Object.defineProperty(main, 'scrollTop', { get: () => scrollTop, set: (v: number) => void (scrollTop = v), configurable: true })
  main.scrollTo = vi.fn() as unknown as typeof main.scrollTo
  const rows = Object.fromEntries(['set:a', 'set:b', 'set:c'].map((key) => [key, container.querySelector(`[data-row-key="${key}"]`) as HTMLElement]))
  vi.spyOn(rows['set:a'], 'getBoundingClientRect').mockReturnValue(rect(100))
  vi.spyOn(rows['set:b'], 'getBoundingClientRect').mockReturnValue(rect(1200))
  vi.spyOn(rows['set:c'], 'getBoundingClientRect').mockReturnValue(rect(2000))
  return { main, rows }
}

describe('scrollArea', () => {
  it('scrollRowIntoView puts the row at the top quarter of the scroller, smoothly: the scroller\'s own position plus the row\'s distance from the quarter line', () => {
    const { main, rows } = scene()
    scrollRowIntoView(rows['set:b'])
    // 300 (where the scroller is) + (1200 - 800 * 0.25)
    expect(main.scrollTo).toHaveBeenCalledWith({ top: 1300, behavior: 'smooth' })
  })

  it('scrollToRowKey scrolls to the row with that key and to no other (the current set is not the target: its rectangle would give another top)', () => {
    const { main } = scene()
    expect(scrollToRowKey('set:a')).toBe(true)
    expect(main.scrollTo).toHaveBeenCalledTimes(1)
    expect(main.scrollTo).toHaveBeenCalledWith({ top: 300 + (100 - 200), behavior: 'smooth' })
  })

  it('a key no row on the screen has scrolls nothing and says so', () => {
    const { main } = scene()
    expect(findRow('set:zzz')).toBeNull()
    expect(scrollToRowKey('set:zzz')).toBe(false)
    expect(main.scrollTo).not.toHaveBeenCalled()
  })

  it('readScrollTop and writeScrollTop: the scroller\'s position, put back at once with no animation; with no scroller 0 and nothing', () => {
    const { main } = scene()
    expect(readScrollTop()).toBe(300)
    writeScrollTop(0)
    expect(main.scrollTop).toBe(0)
    writeScrollTop(640)
    expect(readScrollTop()).toBe(640)
    expect(main.scrollTo).not.toHaveBeenCalled()
    cleanup()
    expect(readScrollTop()).toBe(0)
    expect(() => writeScrollTop(10)).not.toThrow()
  })
})
