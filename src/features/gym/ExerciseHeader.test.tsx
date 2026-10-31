// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import ExerciseHeader from './ExerciseHeader'
import { exerciseOf } from './cardHarness.testutil'

// Chunk 78 (SPEC 1.2.1 [5]): "The history icon beside ⋯ is removed from every exercise header. The LAST line and ⋯ → HISTORY open the same sheet." The workout's
// header (`WorkoutExerciseHeader`) passes `onHistoryClick`, and a header that has it draws no icon; the header with neither prop, which Today's session preview draws
// (it is not in this chunk), keeps its icon, which goes to the exercise's history page.
afterEach(cleanup)

const Where = () => <p data-testid="where">{useLocation().pathname}</p>
function mount(props: Partial<React.ComponentProps<typeof ExerciseHeader>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <Routes>
        <Route path="*" element={<><ExerciseHeader programExercise={exerciseOf()} {...props} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('the exercise header\'s history icon (SPEC 1.2.1 [5])', () => {
  it('the workout\'s header, which passes onHistoryClick, draws no history icon, with or without the ⋯, whichever name it had (break: draw it anyway)', () => {
    const onHistoryClick = vi.fn()
    const view = mount({ onHistoryClick, onOptionsClick: () => {} })
    for (const name of ['Exercise history', 'View exercise history']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(view.container.querySelector('svg.lucide-history')).toBeNull()
    expect(screen.getByLabelText('Exercise options')).toBeTruthy() // the ⋯ is what is left beside the name
    cleanup()
    const alone = mount({ onHistoryClick })
    expect(alone.container.querySelector('svg.lucide-history')).toBeNull()
    expect(onHistoryClick).not.toHaveBeenCalled() // nothing in the header calls it: the LAST line (a part of `lastLine`) is what opens the sheet
  })

  it('the header with no onHistoryClick keeps its icon, and it still goes to the exercise\'s history page (Today\'s preview; the other callers keep it)', () => {
    const view = mount()
    expect(view.container.querySelector('svg.lucide-history')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View exercise history' }))
    expect(screen.getByTestId('where').textContent).toBe('/exercise/ex-1')
  })

  it('a header with the ⋯ but no onHistoryClick has both, the icon at the ⋯\'s size', () => {
    mount({ onOptionsClick: () => {} })
    const icon = screen.getByRole('button', { name: 'View exercise history' })
    expect(icon.getAttribute('style')).toContain('width: 36px')
    expect(screen.getByLabelText('Exercise options')).toBeTruthy()
  })

  it('the name, the muscle line and the LAST line are drawn either way', () => {
    const { container } = mount({ onHistoryClick: () => {}, lastLine: <span data-last-line>LAST = LAST WEEK, TUE</span> })
    expect(container.textContent).toContain('Bench Press')
    expect(container.textContent).toContain('CHEST')
    expect(container.querySelector('[data-last-line]')!.textContent).toBe('LAST = LAST WEEK, TUE')
  })
})
