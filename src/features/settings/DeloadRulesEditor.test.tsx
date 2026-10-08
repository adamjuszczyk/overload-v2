// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import DeloadRulesEditor from './DeloadRulesEditor'
import { DEFAULT_DELOAD_SETS_RULE, DEFAULT_DELOAD_WEIGHT_RULE } from '../../lib/plannerVocabulary.js'
import type { DeloadRules } from '../../lib/deloadRules'

// Chunk 22 — the ONE shared rules editor (Settings' own global-default
// section and the program override both mount this unchanged). UI rule
// (reviewer's note 10): existing components and tokens only; checked at
// 375px below, same convention as every other planner/settings control.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

function renderEditor(value: DeloadRules | null, onChange = vi.fn()) {
  render(<DeloadRulesEditor value={value} onChange={onChange} />)
  return onChange
}

describe('DeloadRulesEditor — each rule independently on/off, starting from the documented defaults', () => {
  it('every rule reads off when value is null, and only the toggle rows are visible', () => {
    renderEditor(null)
    expect(screen.queryByText('PERCENT')).toBeNull()
    expect(screen.queryByText('DOWN')).toBeNull()
  })

  it('turning SETS on starts from plannerVocabulary.ts\'s own DEFAULT_DELOAD_SETS_RULE — no duplicated literal', () => {
    const onChange = renderEditor(null)
    fireEvent.click(screen.getByLabelText('Sets'))
    expect(onChange).toHaveBeenCalledWith({ sets: { ...DEFAULT_DELOAD_SETS_RULE } })
  })

  it('turning WEIGHT on starts from DEFAULT_DELOAD_WEIGHT_RULE (DECISIONS 33\'s 75%, rounding down, 2.5 kg)', () => {
    const onChange = renderEditor(null)
    fireEvent.click(screen.getByLabelText('Weight'))
    expect(onChange).toHaveBeenCalledWith({ weight: { ...DEFAULT_DELOAD_WEIGHT_RULE } })
  })

  it('turning REPS on starts at delta 0 (no stated default — a harmless no-op until a real value is picked)', () => {
    const onChange = renderEditor(null)
    fireEvent.click(screen.getByLabelText('Reps'))
    expect(onChange).toHaveBeenCalledWith({ reps: { delta: 0 } })
  })

  it('turning RIR on starts at delta 0 too', () => {
    const onChange = renderEditor(null)
    fireEvent.click(screen.getByLabelText('RIR'))
    expect(onChange).toHaveBeenCalledWith({ rir: { delta: 0 } })
  })

  it('turning a rule off removes exactly that key, keeping the others', () => {
    const onChange = renderEditor({ sets: DEFAULT_DELOAD_SETS_RULE, reps: { delta: -2 } })
    fireEvent.click(screen.getByLabelText('Sets'))
    expect(onChange).toHaveBeenCalledWith({ reps: { delta: -2 } })
  })

  it('turning off the only rule present collapses to null, never {}', () => {
    const onChange = renderEditor({ rir: { delta: 1 } })
    fireEvent.click(screen.getByLabelText('RIR'))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

describe('DeloadRulesEditor — editing values', () => {
  it('switching sets mode to COUNT keeps the other sets fields', () => {
    const onChange = renderEditor({ sets: { mode: 'percent', value: 50, rounding: 'down' } })
    fireEvent.click(screen.getByText('COUNT'))
    expect(onChange).toHaveBeenCalledWith({ sets: { mode: 'count', value: 50, rounding: 'down' } })
  })

  it('stepping the sets VALUE up by 5 (percent mode)', () => {
    const onChange = renderEditor({ sets: { mode: 'percent', value: 50, rounding: 'down' } })
    fireEvent.click(screen.getByLabelText('Increase VALUE (%)'))
    expect(onChange).toHaveBeenCalledWith({ sets: { mode: 'percent', value: 55, rounding: 'down' } })
  })

  it('sets VALUE never steps below 1', () => {
    const onChange = renderEditor({ sets: { mode: 'count', value: 1, rounding: 'down' } })
    fireEvent.click(screen.getByLabelText('Decrease VALUE (SETS)'))
    expect(onChange).toHaveBeenCalledWith({ sets: { mode: 'count', value: 1, rounding: 'down' } })
  })

  it('flipping sets rounding to UP', () => {
    const onChange = renderEditor({ sets: { mode: 'percent', value: 50, rounding: 'down' } })
    // Two ROUNDING chip rows could exist once weight is also on; here only
    // sets is on, so this is the only UP chip.
    fireEvent.click(screen.getByText('UP'))
    expect(onChange).toHaveBeenCalledWith({ sets: { mode: 'percent', value: 50, rounding: 'up' } })
  })

  it('stepping the weight PERCENT and STEP, and flipping STEP UNIT', () => {
    const weight = { percent: 75, rounding: 'down' as const, step: 2.5, stepUnit: 'kg' as const }
    const onChange1 = renderEditor({ weight })
    fireEvent.click(screen.getByLabelText('Increase PERCENT'))
    expect(onChange1).toHaveBeenCalledWith({ weight: { ...weight, percent: 80 } })
    cleanup()

    const onChange2 = renderEditor({ weight })
    fireEvent.click(screen.getByLabelText('Increase STEP'))
    expect(onChange2).toHaveBeenCalledWith({ weight: { ...weight, step: 3 } })
    cleanup()

    const onChange3 = renderEditor({ weight })
    fireEvent.click(screen.getByText('LBS'))
    expect(onChange3).toHaveBeenCalledWith({ weight: { ...weight, stepUnit: 'lbs' } })
  })

  it('reps delta can go negative, and shows a leading + once positive', () => {
    const onChange = renderEditor({ reps: { delta: 0 } })
    fireEvent.click(screen.getByLabelText('Decrease DELTA'))
    expect(onChange).toHaveBeenCalledWith({ reps: { delta: -1 } })
    cleanup()

    renderEditor({ reps: { delta: 2 } })
    expect(screen.getByText('+2')).toBeTruthy()
  })

  it('rir delta steps the same way', () => {
    const onChange = renderEditor({ rir: { delta: 0 } })
    fireEvent.click(screen.getByLabelText('Increase DELTA'))
    expect(onChange).toHaveBeenCalledWith({ rir: { delta: 1 } })
  })
})

describe('DeloadRulesEditor — disabled', () => {
  it('every control is disabled, and clicking does nothing', () => {
    const onChange = vi.fn()
    render(<DeloadRulesEditor value={{ sets: DEFAULT_DELOAD_SETS_RULE }} onChange={onChange} disabled />)
    fireEvent.click(screen.getByLabelText('Weight')) // turning a rule ON while disabled
    fireEvent.click(screen.getByText('COUNT')) // changing mode while disabled
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('DeloadRulesEditor — 375px', () => {
  it('no rendered element carries a fixed pixel width wider than 375px, with every rule on', () => {
    const { container } = render(
      <DeloadRulesEditor
        value={{
          sets: DEFAULT_DELOAD_SETS_RULE,
          weight: DEFAULT_DELOAD_WEIGHT_RULE,
          reps: { delta: -2 },
          rir: { delta: 1 },
        }}
        onChange={vi.fn()}
      />,
    )
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
