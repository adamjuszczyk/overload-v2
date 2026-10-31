import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { COACH_KEYS_OF_A_DELETED_PROGRAM, DONE_WEEK_PLANS_PREFIX, MESOS_KEY, finishedRunInvalidations, finishedRunRemovals } from './finishedRunCaches'

// Chunk 75 (1.2.1 item 8b; pre-read 75-1 and 75-2): what the phone refreshes when a finished program is deleted whole.
//
// Coach's list keys are module-private in four Coach hooks, and Coach is frozen (Escalation 16), so the delete cannot import them: it writes them out
// (`finishedRunCaches.ts`). A key spelt wrongly there would refresh nothing and every test that only says "Coach's keys are refreshed" would still
// pass. So this reads the key literals from the Coach files themselves (the syntax tree: a comment that quotes a key is no key) and requires EXACTLY
// these ten to be refreshed: the notes; the session analyses, the sessions that can be analysed and an analysis's detail; the same for weeks; the same
// for whole programs (DECISIONS 249 rows 10, 13, 14, 15). Coach's memory, phases, weights and Q&A stay (rows 17 and 19: not results of the program), so
// none of their keys may be on the list. A Coach hook that gains a key tomorrow fails the first test until someone decides which side of the line it is on.

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const COACH_HOOKS = ['useCoachNotes.ts', 'useCoachAnalysis.ts', 'useCoachWeekAnalysis.ts', 'useCoachMesoAnalysis.ts']
// The Coach hooks that hold what stays.
const COACH_KEEPS = ['useCoachMemory.ts', 'useCoachContext.ts']

const TEN = [
  'v2_coachNotes',
  'v2_coachAnalyzableSessions',
  'v2_coachAnalyses',
  'v2_coachAnalysisDetail',
  'v2_coachAnalyzableWeeks',
  'v2_coachWeekAnalyses',
  'v2_coachWeekAnalysisDetail',
  'v2_coachAnalyzableMesos',
  'v2_coachMesoAnalyses',
  'v2_coachMesoAnalysisDetail',
]

/** The first string of every array literal in the file that starts with `prefix` (`['v2_coachNotes']`, `['v2_coachAnalysisDetail', id]`): a query key's root. */
function keyRoots(file: string, prefix: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const roots = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isArrayLiteralExpression(node)) {
      const first = node.elements[0]
      if (first && ts.isStringLiteralLike(first) && first.text.startsWith(prefix)) roots.add(first.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...roots].sort()
}

/** The string a `const NAME = '…'` or `const NAME = ['…']` declaration holds, from the syntax tree. */
function constantOf(file: string, name: string): string {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let found: string | null = null
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      const init = node.initializer
      if (ts.isStringLiteralLike(init)) found = init.text
      else if (ts.isArrayLiteralExpression(init) && init.elements.length === 1 && ts.isStringLiteralLike(init.elements[0])) found = init.elements[0].text
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (found === null) throw new Error(`no const ${name} in ${file}`)
  return found
}

describe('Coach\'s list keys: the ten the delete refreshes are the ones Coach\'s hooks use', () => {
  it('the four Coach hooks that read sessions, analyses and notes hold exactly these ten key roots', () => {
    const found = COACH_HOOKS.flatMap((hook) => keyRoots(here(`../coach/${hook}`), 'v2_coach'))
    expect([...new Set(found)].sort()).toEqual([...TEN].sort())
  })

  it('each of the ten is in its own hook (the notes in useCoachNotes, the analyses in useCoachAnalysis, and so on), spelt as the hook spells it', () => {
    expect(keyRoots(here('../coach/useCoachNotes.ts'), 'v2_coach')).toEqual(['v2_coachNotes'])
    expect(keyRoots(here('../coach/useCoachAnalysis.ts'), 'v2_coach')).toEqual(['v2_coachAnalyses', 'v2_coachAnalysisDetail', 'v2_coachAnalyzableSessions'])
    expect(keyRoots(here('../coach/useCoachWeekAnalysis.ts'), 'v2_coach')).toEqual(['v2_coachAnalyzableWeeks', 'v2_coachWeekAnalyses', 'v2_coachWeekAnalysisDetail'])
    expect(keyRoots(here('../coach/useCoachMesoAnalysis.ts'), 'v2_coach')).toEqual(['v2_coachAnalyzableMesos', 'v2_coachMesoAnalyses', 'v2_coachMesoAnalysisDetail'])
  })

  it('the delete\'s list of Coach keys is exactly those ten: none missing, none misspelt, none extra', () => {
    expect([...COACH_KEYS_OF_A_DELETED_PROGRAM].sort()).toEqual([...TEN].sort())
    expect(new Set(COACH_KEYS_OF_A_DELETED_PROGRAM).size).toBe(COACH_KEYS_OF_A_DELETED_PROGRAM.length)
  })

  it('and the refreshes the delete makes contain every one of them, as its own prefix', () => {
    const refreshed = finishedRunInvalidations().map((key) => JSON.stringify(key))
    for (const key of TEN) expect(refreshed, key).toContain(JSON.stringify([key]))
  })

  it('what stays is not refreshed: Coach\'s memory, phases, weights and Q&A are not results of the program (249 rows 17 and 19)', () => {
    const stays = COACH_KEEPS.flatMap((hook) => keyRoots(here(`../coach/${hook}`), 'v2_coach'))
    expect(stays.sort()).toEqual(['v2_coachMemory', 'v2_coachPhaseEntries', 'v2_coachWeightEntries'])
    const refreshedRoots = finishedRunInvalidations().map((key) => key[0])
    for (const key of stays) expect(refreshedRoots, key).not.toContain(key)
    expect(refreshedRoots.filter((root) => /^v2_coach/.test(root) && !TEN.includes(root))).toEqual([])
    expect(refreshedRoots.some((root) => /qa/i.test(root))).toBe(false)
  })
})

describe('the other keys the delete refreshes are the app\'s own, spelt as the app spells them', () => {
  it('the done-weeks key is the constant every session writer uses, and the programs list key is the one useMesos reads', () => {
    expect(DONE_WEEK_PLANS_PREFIX).toBe(constantOf(here('../plan/useDoneWeekPlanIds.ts'), 'DONE_WEEK_PLANS_KEY'))
    expect(MESOS_KEY).toEqual([constantOf(here('./useMesos.ts'), 'MESOS_KEY')])
  })

  it('History\'s session delete and the finish are both covered: every prefix either invalidates, and the two it removes', () => {
    const refreshed = finishedRunInvalidations().map((key) => JSON.stringify(key))
    const historyAndFinish = [
      ['v2_history'],
      ['v2_sessions'],
      [DONE_WEEK_PLANS_PREFIX],
      ['v2_sessionTypeHistory'],
      ['v2_exerciseProgress'],
      ['v2_mesoProgress'],
      ['v2_positionMatchedHeadline'],
      ['v2_positionMatchTable'],
      ['v2_lastDoneOrSkippedSession'],
      ['v2_referenceSessions'],
      [...MESOS_KEY],
      ['v2_programs'],
    ]
    for (const key of historyAndFinish) expect(refreshed, JSON.stringify(key)).toContain(JSON.stringify(key))
  })

  it('the keys useHistory.ts and useSession.ts invalidate are each in the list (read from their source, so a key they gain is noticed)', () => {
    const wanted = new Set<string>()
    for (const [file, from, to] of [
      ['../history/useHistory.ts', 'export function useDeleteSession', '// ─── Session type, all time'],
      ['../gym/useSession.ts', 'export function useCompleteSession', 'export function useReopenSession'],
    ] as const) {
      const text = readFileSync(here(file), 'utf8')
      const part = text.slice(text.indexOf(from), text.indexOf(to))
      for (const m of part.matchAll(/invalidateQueries\(\{ queryKey: \[(?:'([A-Za-z0-9_]+)'|(DONE_WEEK_PLANS_KEY))/g)) wanted.add(m[1] ?? DONE_WEEK_PLANS_PREFIX)
      if (/\bHISTORY_KEY\b/.test(part)) wanted.add('v2_history')
    }
    // `v2_session` is the finished session's own read: the delete removes it per session instead (below)
    wanted.delete('v2_session')
    const refreshed = new Set(finishedRunInvalidations().map((key) => key[0]))
    expect([...wanted].filter((root) => !refreshed.has(root))).toEqual([])
    expect(wanted.size).toBeGreaterThanOrEqual(10)
  })

  it('a deleted session\'s own reads are dropped, not refreshed: its History detail, the workout\'s read of it and its swaps', () => {
    expect(finishedRunRemovals(['s1', 's2'])).toEqual([
      ['v2_historyDetail', 's1'],
      ['v2_session', 's1'],
      ['v2_sessionSwaps', 's1'],
      ['v2_historyDetail', 's2'],
      ['v2_session', 's2'],
      ['v2_sessionSwaps', 's2'],
    ])
    expect(finishedRunRemovals([])).toEqual([])
  })

  it('the counts of the program being deleted are not refreshed (the confirmation is still on them when the delete lands)', () => {
    const roots = finishedRunInvalidations().map((key) => key[0])
    expect(roots).not.toContain('v2_finishedRunCounts')
  })
})
