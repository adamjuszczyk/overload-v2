import { describe, expect, it } from 'vitest'
import * as pickers from './index'

// TASKS-1.2 chunk 39 "Done when": the three pickers are exported from src/components/pickers/index.ts,
// with the logic a caller needs to use them; chunk 40 adds the cues sheet beside them. Later chunks
// import from here and nowhere deeper.

describe('the pickers folder', () => {
  const exported = pickers as unknown as Record<string, unknown>

  it('exports the three pickers', () => {
    for (const name of ['SetTypePicker', 'RepTargetPicker', 'RirTargetPicker']) expect(typeof exported[name], name).toBe('function')
  })

  it('exports the cues sheet (chunk 40)', () => {
    expect(typeof exported.CuesSheet).toBe('function')
  })

  it('exports the logic a caller writes with: the type change, "Use for all", the RIR target and its columns', () => {
    for (const name of ['applySetType', 'setTypeId', 'applyToAllTargets', 'countApplyToAll', 'repRange', 'rirRange', 'rirTargetFromColumns', 'rirTargetToColumns']) {
      expect(typeof exported[name], name).toBe('function')
    }
  })
})
