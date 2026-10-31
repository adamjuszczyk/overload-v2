// @vitest-environment jsdom
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { test, expect, afterEach } from 'vitest'
afterEach(cleanup)
import App from '../src/App'
import { useDemo } from '../src/demo/demoStore'
import { seed } from '../src/demo/seed'
import { queryClient } from '@app/lib/queryClient'
const pick = (l: string) => { act(() => useDemo.getState().set({ menuOpen: true })); fireEvent.click(screen.getByText(l, { selector: 'button' })) }
test('workout: items 5, 6, 12, 13, 15, 21', async () => {
  seed(); render(<App />)
  pick('In progress (board W1)')
  expect(screen.queryAllByLabelText('Exercise history').length).toBe(0)
  expect(document.body.textContent).toContain('MON 32.5 × 8 @ 1')
  pick('Warmup up next')
  fireEvent.click(document.querySelector('[data-row-key="set:ez-w"] [aria-label="Set options"]')!)
  expect(screen.getByText(/DELETE/)).toBeTruthy()
  pick('All sets done')
  expect(document.querySelector('[data-workout-complete]')).toBeTruthy()
  expect(screen.queryByText('✕')).toBeNull()
})

test('preview: new design', () => {
  seed(); render(<App />)
  pick('New design')
  const t = document.body.textContent!
  expect(t).toContain('SUPERSET A')
  expect(t).not.toContain('TARGET RIR')
  pick('Week not planned yet')
  expect(document.body.textContent).toContain('NO SETS PLANNED')
  pick('1.2 today (for comparison)')
  // Since chunk 77 this state draws the app's real, rebuilt preview (the old targets panel and its "TARGET RIR" rows are gone from the app).
  expect(document.body.textContent).toContain('· PREVIEW')
})

test('planner: a member moves inside its superset; the header moves the superset', () => {
  seed(); render(<App />)
  pick('Pull 1 with a superset')
  const order = () => [...document.querySelectorAll('[aria-label^="Edit "], [aria-label^="Close "]')].map((b) => b.getAttribute('aria-label')!.replace(/^(Edit|Close) /, '')).join(' / ')
  expect(document.body.textContent).toContain('SUPERSET A · 3 EXERCISES')
  fireEvent.click(screen.getByLabelText('Edit Face Pull'))
  fireEvent.click(screen.getByLabelText('Move Face Pull up'))
  expect(order()).toContain('Face Pull / Seated Cable Row / Rear Delt Fly')
  expect((screen.getByLabelText('Move Face Pull up') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('Move superset A up'))
  expect(order()).toMatch(/^Face Pull \/ Seated Cable Row \/ Rear Delt Fly \/ Lat Pulldown/)
})

test('tempo picker: no dashes typed, X by stepping below 0', () => {
  seed(); render(<App />)
  pick('Tempo picker')
  expect(screen.getByText('SET TEMPO 3-1-1-0')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('Less UP'))
  fireEvent.click(screen.getByLabelText('Less UP'))
  expect(screen.getByText('SET TEMPO 3-1-X-0')).toBeTruthy()
  fireEvent.click(screen.getByText('SET TEMPO 3-1-X-0'))
  expect(screen.getByLabelText('Tempo for Seated Cable Row').textContent).toBe('3-1-X-0')
})
