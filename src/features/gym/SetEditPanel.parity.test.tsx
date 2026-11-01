// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIOS, runScenarios } from './editPatchParity.testutil'

// Chunk 61 (TASKS-1.2 61 Verification): "the edit panel's SAVE sends the same `updateSetLog` patch the inline edit sent before the chunk (parity capture)".
// `__fixtures__/edit-patch-before-61.json` is what the same scenarios (`editPatchParity.testutil.tsx`) made `onUpdateSet` receive on staging's code before
// this chunk, when the pen opened `SetRowLogged`'s and `SetRowWarmup`'s inline edit (a throwaway worktree of `origin/staging`, run once). Each scenario
// edits a logged row the way a person does and presses SAVE; the panel must hand the card the same arguments, key for key: a patch that gained a key (a
// note, the log's own unit) or lost one (the RIR of a cleared box) is a different write.
afterEach(cleanup)
const before = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'edit-patch-before-61.json'), 'utf8')) as Record<string, unknown[]>

describe('the edit panel\'s SAVE sends what the inline edit sent', () => {
  const now = runScenarios()

  it('the fixture holds every scenario, and each one saved exactly once', () => {
    expect(Object.keys(before)).toEqual(SCENARIOS.map((s) => s.name))
    for (const name of Object.keys(before)) expect(before[name]).toHaveLength(1)
  })

  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: the same call, the same keys`, () => {
      expect(now[scenario.name]).toEqual(before[scenario.name])
      // `toEqual` ignores a key holding undefined: the keys themselves are compared too
      const keys = (calls: unknown[]) => (calls as Array<[string, Record<string, unknown>]>).map(([id, changes]) => [id, Object.keys(changes).sort()])
      expect(keys(now[scenario.name])).toEqual(keys(before[scenario.name]))
    })
  }
})
