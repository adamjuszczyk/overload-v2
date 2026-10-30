// @vitest-environment jsdom
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { test, expect, afterEach } from 'vitest'
import App from '../src/App'
import { useDemo } from '../src/demo/demoStore'
import { seed } from '../src/demo/seed'

afterEach(cleanup)
const pick = (label: string) => {
  act(() => useDemo.getState().set({ menuOpen: true }))
  fireEvent.click(screen.getAllByText(label, { selector: 'button' })[0])
}

test('Programs opens with real rows and the DELETE foot', () => {
  seed(); render(<App />)
  expect(screen.getAllByText('Push Pull Legs', { selector: 'span' }).length).toBeGreaterThan(1)
  expect(screen.getByText('FINISH IT FIRST')).toBeTruthy()
  expect(screen.getAllByText('DELETE', { selector: 'button' }).length).toBe(3)
})

test('every DEMO state renders', async () => {
  seed(); render(<App />)
  const labels = ['Delete','Delete offline','No programs','Cut PPL, 10 weeks','False start, 1 week','Delete, no Coach rows','Normal','Offline','1.2.1 (sample)','1.2','Notes, once','Screen','Offline changes waiting','Your account','Ready','Unsent changes','Updating',"Couldn't update"]
  for (const l of labels) pick(l)
})

test('finished delete names counts', async () => {
  seed(); render(<App />)
  pick('Cut PPL, 10 weeks')
  expect(screen.getByText('CUT PPL')).toBeTruthy()
  act(() => useDemo.getState().set({ menuOpen: true }))
  fireEvent.click(screen.getAllByText('Delete', { selector: 'button' })[1])
  await act(async () => { await new Promise((r) => setTimeout(r, 1000)) })
  expect(screen.getByText(/38 sessions and 1046 logged sets, plus 3 Coach analyses/)).toBeTruthy()
})

test('finished priorities are read-only, old marks mapped', () => {
  seed(); render(<App />)
  pick('Old marks (pre-1.1)')
  expect(screen.getByText('STRENGTH BLOCK')).toBeTruthy()
  expect(screen.queryAllByRole('button', { name: /Priority for/ }).length).toBe(0)
  pick('None set')
  expect(screen.getByText('No priorities were set for this program.')).toBeTruthy()
  pick('Marks (1.1 and later)')
  expect(screen.queryAllByRole('button', { name: /Priority for/ }).length).toBe(0)
})

test('pre-1.1 finished program row reads the mapped marks', () => {
  seed(); render(<App />)
  act(() => useDemo.getState().set({ menuOpen: true }))
  fireEvent.click(screen.getByText('Cut PPL, 10 weeks', { selector: 'button' }))
  expect(screen.getByText(/Focus: chest, back/)).toBeTruthy()
})
