// Chunk 61 — the scenarios of the "SAVE sends the same `updateSetLog` patch the inline edit sent before the chunk" parity capture (TASKS-1.2 61
// Verification). Each scenario presses the pen of one logged row, edits it the way a person does and presses SAVE, and answers what the card handed
// `onUpdateSet`. The same scenarios were run on staging's code before chunk 61 (the inline edit of `SetRowLogged` and `SetRowWarmup`), and what they
// sent is committed as `__fixtures__/edit-patch-before-61.json`; `SetEditPanel.parity.test.tsx` runs them again on the panel and compares.
// Only valid input is here: the panel refuses more than the inline edit did (a weight like "52..5" is no number to it, where `parseFloat` read 52).
import { cleanup, fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { headLogOf, logOf, plannedDrop, plannedSet, renderCard } from './cardHarness.testutil'

const rowOf = (container: HTMLElement, key: string) => container.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const typeInto = (scope: HTMLElement, label: 'Weight' | 'Reps' | 'RIR', value: string) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } })

interface Scenario {
  name: string
  render: () => { container: HTMLElement; calls: () => unknown[]; key: string }
  edit: (row: HTMLElement) => void
}

function card(plannedSets: ReturnType<typeof plannedSet>[], logs: ReturnType<typeof headLogOf>[], key: string) {
  const onUpdateSet = vi.fn()
  const { container } = renderCard({ plannedSets, logs, props: { onUpdateSet } })
  return { container, calls: () => onUpdateSet.mock.calls as unknown[], key }
}

export const SCENARIOS: Scenario[] = [
  { name: 'reps 8 to 9', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 80, reps: 8, rir: 2 })], 'set:set-1'), edit: (row) => typeInto(row, 'Reps', '9') },
  { name: 'RIR cleared', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 80, reps: 8, rir: 2 })], 'set:set-1'), edit: (row) => typeInto(row, 'RIR', '') },
  { name: 'RIR typed on a set that had none', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 80, reps: 8, rir: null })], 'set:set-1'), edit: (row) => typeInto(row, 'RIR', '1') },
  { name: 'FORM controlled', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 80, reps: 8, rir: 2 })], 'set:set-1'), edit: (row) => fireEvent.click(within(row).getByText('CONTROLLED')) },
  { name: 'FORM cleared again', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 80, reps: 8, rir: 2, formRating: 'rushed' })], 'set:set-1'), edit: (row) => fireEvent.click(within(row).getByText('RUSHED')) },
  { name: 'weight with a comma', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 80, reps: 8, rir: 2 })], 'set:set-1'), edit: (row) => typeInto(row, 'Weight', '82,5') },
  { name: 'weight, reps and RIR together', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 80, reps: 8, rir: 2 })], 'set:set-1'), edit: (row) => { typeInto(row, 'Weight', '85'); typeInto(row, 'Reps', '6'); typeInto(row, 'RIR', '0') } },
  { name: 'lbs set saved untouched keeps the stored kg', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 9, reps: 8, rir: 2, enteredUnit: 'lbs' })], 'set:set-1'), edit: () => {} },
  { name: 'lbs set, a new weight', render: () => card([plannedSet(1)], [headLogOf(1, { weight: 9, reps: 8, rir: 2, enteredUnit: 'lbs' })], 'set:set-1'), edit: (row) => typeInto(row, 'Weight', '20') },
  {
    name: 'a drop, reps changed',
    render: () =>
      card(
        [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)],
        [headLogOf(1, { stageKind: 'dropset' }), logOf({ id: 'drop-1', parentSetId: 'log-1', stageIndex: 1, setNumber: 1, isDropset: true, weekPlanSetId: 'set-1-drop-1', weight: 40, reps: 8, rir: 0 })],
        'set:set-1:stage:1',
      ),
    edit: (row) => typeInto(row, 'Reps', '7'),
  },
  {
    name: 'a warmup, reps changed',
    render: () => card([plannedSet(1, { isWarmup: true })], [headLogOf(1, { isWarmup: true, weight: 20, reps: 12, rir: null })], 'set:set-1'),
    edit: (row) => typeInto(row, 'Reps', '10'),
  },
]

/** What each scenario hands `onUpdateSet`, by name. */
export function runScenarios(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const scenario of SCENARIOS) {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'rows' })
    const { container, calls, key } = scenario.render()
    fireEvent.click(within(rowOf(container, key)).getByLabelText('Edit set'))
    const row = rowOf(container, key)
    scenario.edit(row)
    fireEvent.click(within(row).getByText('SAVE'))
    out[scenario.name] = calls()
    cleanup()
  }
  return out
}
