// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { useScrollToCurrentSet } from './useScrollToCurrentSet'

// Chunk 58a: "the current set" the jump button points at is the one row the rules name (`data-current-set`, SetRowCurrent), not the first
// unlogged row in the DOM. jsdom lays nothing out, so each element's rectangle is set by hand, as the scroll parent's (<main>) is.
afterEach(() => cleanup())

function Probe({ onState }: { onState: (state: ReturnType<typeof useScrollToCurrentSet>) => void }) {
  const state = useScrollToCurrentSet()
  onState(state)
  return (
    <main>
      <div ref={state.containerRef}>
        <div data-row-key="logged" data-row-state="logged" />
        <div data-row-key="upcoming" data-row-state="upcoming" />
        <div data-row-key="current" data-current-set="true" />
      </div>
    </main>
  )
}

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

describe('useScrollToCurrentSet', () => {
  it('points at the current set only: below the screen "down", above "up", on it nothing', () => {
    let state!: ReturnType<typeof useScrollToCurrentSet>
    const { container } = render(<Probe onState={(s) => (state = s)} />)
    const main = container.querySelector('main') as HTMLElement
    const current = container.querySelector('[data-current-set]') as HTMLElement
    const upcoming = container.querySelector('[data-row-key="upcoming"]') as HTMLElement
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue(rect(0, 600))
    // an unlogged row that is not the current set is on screen: it must not decide
    vi.spyOn(upcoming, 'getBoundingClientRect').mockReturnValue(rect(100, 140))

    vi.spyOn(current, 'getBoundingClientRect').mockReturnValue(rect(900, 960))
    act(() => void fireEvent.scroll(main))
    expect(state.direction).toBe('down')

    vi.spyOn(current, 'getBoundingClientRect').mockReturnValue(rect(-200, -150))
    act(() => void fireEvent.scroll(main))
    expect(state.direction).toBe('up')

    vi.spyOn(current, 'getBoundingClientRect').mockReturnValue(rect(200, 260))
    act(() => void fireEvent.scroll(main))
    expect(state.direction).toBeNull()
  })

  it('with no current set (everything logged: the current row has gone) there is nothing to point at', async () => {
    let state!: ReturnType<typeof useScrollToCurrentSet>
    const { container } = render(<Probe onState={(s) => (state = s)} />)
    const main = container.querySelector('main') as HTMLElement
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue(rect(0, 600))
    const current = container.querySelector('[data-current-set]') as HTMLElement
    vi.spyOn(current, 'getBoundingClientRect').mockReturnValue(rect(900, 960))
    act(() => void fireEvent.scroll(main))
    expect(state.direction).toBe('down')
    await act(async () => {
      current.remove() // the row draws as logged: the screen's markup changes, which the hook watches for
      await Promise.resolve()
    })
    expect(state.direction).toBeNull()
  })
})
