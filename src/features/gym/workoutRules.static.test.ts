import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { finishWarning, lockDecision, currentSet, resolveRows } from './workoutRules'
import { card, headLog, orderOf } from './workoutRules.testutil'

// Chunk 46: the module stays pure (it reads the app's types and three small pure modules, nothing else),
// and the words it writes are the boards' (W7b, W18).

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'workoutRules.ts'), 'utf8')
const board = (file: string) => readFileSync(join(here, '..', '..', '..', 'design', '1.2', 'source', file), 'utf8')

describe('workoutRules.ts is a pure module', () => {
  it('imports only the app\'s types, the stage vocabulary and two pure gym modules', () => {
    const imports = [...source.matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1])
    expect(imports.sort()).toEqual(['../../lib/plannerVocabulary', '../../types', './setGroupLogic', './supersetRounds'])
  })

  it('reads no clock, no randomness, no browser, no store, no network', () => {
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'window.', 'document.', 'localStorage', 'fetch(', 'supabase', 'useSettingsStore', 'useRestTimerStore', 'react']) {
      expect(code, forbidden).not.toContain(forbidden)
    }
  })
})

describe('the fixtures\' dates', () => {
  it('log on a weekday, printed: Monday 2026-10-12, the seed\'s week 3 Monday (Checks that lied #21)', () => {
    const at = headLog('bench', 1).loggedAt
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    expect(`${at.slice(0, 10)} is a ${names[new Date(at).getUTCDay()]}`).toBe('2026-10-12 is a Monday')
  })
})

describe('the words are the boards\'', () => {
  it('W7b: the lock\'s question, the set that is next and the button', () => {
    const w7b = board('WorkoutLogOrder.dc.html')
    // The board's own sample: Lat Pulldown 03 is next, LOG on A2 asks.
    const order = orderOf(
      [card('latpull', 'n n n', { name: 'Lat Pulldown' }), card('row', 'n n n', { name: 'Seated Cable Row' }), card('lat', 'n n n', { name: 'Lateral Raise' })],
      [{ id: 'blk', members: ['row', 'lat'] }],
    )
    const logs = [headLog('latpull', 1), headLog('latpull', 2)]
    const rows = resolveRows(order, logs, [])
    const decision = lockDecision({ logInOrder: true, current: currentSet(order, logs, []), tapped: rows.find((r) => r.key === 'set:row.2')! })
    if (decision === 'log') throw new Error('expected a question')
    expect(w7b).toContain(decision.ask)
    expect(w7b).toContain(`<span style="font-weight: 700; color: {{c.t1}}">${decision.next}</span>`)
    expect(w7b).toContain(`>LOG ${decision.label}</button>`)
    expect(w7b).toContain('SEATED CABLE ROW · A2')
  })

  it('W18: the sentence that names the sets not logged yet', () => {
    const w18 = board('SessionComplete.dc.html')
    const warning = finishWarning(orderOf([card('ez', 'w n n', { name: 'EZ Bar Curl' })]), [headLog('ez', 1, { warmup: true, number: 1 })], [])!
    expect(w18).toContain(warning.text)
  })
})
