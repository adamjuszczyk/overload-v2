import { describe, it, expect } from 'vitest'
import type { FinishedRunCounts } from '../../types'
import {
  FULL_DELETE_COUNTING,
  FULL_DELETE_COUNT_FAILED,
  FULL_DELETE_OFFLINE,
  fullDeleteBody,
  fullDeleteText,
  fullDeleteTitle,
} from './fullDeleteText'

// Chunk 75 (1.2.1 item 8b): the words of the full-delete confirmation, pure. SPEC Screens → Finished program: full delete:
//   Title:    "Delete [name]?"
//   Counting: "Counting what goes…" (DELETE off)
//   Counted:  "Deletes its [N weeks]: [N sessions] and [N logged sets][, plus N Coach analyses][ and N Coach notes]. Its results leave History, Progress and
//             every stat. This can't be undone." Each Coach part only above 0; singular and plural follow the counts.
//   Offline:  "You're offline. Deleting needs a connection." (DELETE off)
// The table asserts the printed sentence for every shape of the counts, the prototype's two examples (10 weeks with Coach rows, 1 week without) included.

const counts = (over: Partial<FinishedRunCounts> = {}): FinishedRunCounts => ({ weeks: 2, sessions: 5, loggedSets: 40, coachAnalyses: 0, coachNotes: 0, ...over })
const TAIL = " Its results leave History, Progress and every stat. This can't be undone."

describe('the counted sentence', () => {
  const table: Array<[string, FinishedRunCounts, string]> = [
    ['one of each, no Coach rows', counts({ weeks: 1, sessions: 1, loggedSets: 1 }), 'Deletes its 1 week: 1 session and 1 logged set.'],
    ['plural of each, no Coach rows', counts({ weeks: 2, sessions: 5, loggedSets: 40 }), 'Deletes its 2 weeks: 5 sessions and 40 logged sets.'],
    ['zero weeks reads "0 weeks" (a program that planned no week)', counts({ weeks: 0, sessions: 0, loggedSets: 0 }), 'Deletes its 0 weeks: 0 sessions and 0 logged sets.'],
    ['one session with many sets, one week', counts({ weeks: 1, sessions: 1, loggedSets: 18 }), 'Deletes its 1 week: 1 session and 18 logged sets.'],
    ['many sessions, one logged set', counts({ weeks: 3, sessions: 7, loggedSets: 1 }), 'Deletes its 3 weeks: 7 sessions and 1 logged set.'],
    ['one Coach analysis', counts({ coachAnalyses: 1 }), 'Deletes its 2 weeks: 5 sessions and 40 logged sets, plus 1 Coach analysis.'],
    ['three Coach analyses', counts({ coachAnalyses: 3 }), 'Deletes its 2 weeks: 5 sessions and 40 logged sets, plus 3 Coach analyses.'],
    ['one Coach note', counts({ coachNotes: 1 }), 'Deletes its 2 weeks: 5 sessions and 40 logged sets and 1 Coach note.'],
    ['two Coach notes', counts({ coachNotes: 2 }), 'Deletes its 2 weeks: 5 sessions and 40 logged sets and 2 Coach notes.'],
    ['both Coach parts', counts({ coachAnalyses: 3, coachNotes: 2 }), 'Deletes its 2 weeks: 5 sessions and 40 logged sets, plus 3 Coach analyses and 2 Coach notes.'],
    ['both Coach parts, one of each', counts({ coachAnalyses: 1, coachNotes: 1 }), 'Deletes its 2 weeks: 5 sessions and 40 logged sets, plus 1 Coach analysis and 1 Coach note.'],
    ['notes only, one set: SPEC\'s template joins the notes straight onto the sets', counts({ weeks: 1, sessions: 1, loggedSets: 1, coachNotes: 1 }), 'Deletes its 1 week: 1 session and 1 logged set and 1 Coach note.'],
    ["the prototype's Delete (10 weeks, 38 sessions, 1046 sets, 3 Coach analyses)", counts({ weeks: 10, sessions: 38, loggedSets: 1046, coachAnalyses: 3 }), 'Deletes its 10 weeks: 38 sessions and 1046 logged sets, plus 3 Coach analyses.'],
    ["the prototype's Delete, no Coach rows (1 week, 2 sessions, 31 sets)", counts({ weeks: 1, sessions: 2, loggedSets: 31 }), 'Deletes its 1 week: 2 sessions and 31 logged sets.'],
    ['the seed\'s finished STG Full Body run (3 | 9 | 66 | 3 | 1)', counts({ weeks: 3, sessions: 9, loggedSets: 66, coachAnalyses: 3, coachNotes: 1 }), 'Deletes its 3 weeks: 9 sessions and 66 logged sets, plus 3 Coach analyses and 1 Coach note.'],
  ]
  for (const [name, input, sentence] of table) {
    it(name, () => {
      expect(fullDeleteText(input)).toBe(sentence + TAIL)
    })
  }

  it('a Coach part is drawn only above 0, each on its own count: analyses without notes and notes without analyses', () => {
    expect(fullDeleteText(counts({ coachAnalyses: 4, coachNotes: 0 }))).not.toMatch(/Coach note/)
    expect(fullDeleteText(counts({ coachAnalyses: 0, coachNotes: 4 }))).not.toMatch(/Coach analys/)
    expect(fullDeleteText(counts())).not.toMatch(/Coach/)
  })

  it('a count is never read as another: every field is printed from its own', () => {
    const text = fullDeleteText({ weeks: 11, sessions: 22, loggedSets: 33, coachAnalyses: 44, coachNotes: 55 })
    expect(text).toContain('11 weeks')
    expect(text).toContain('22 sessions')
    expect(text).toContain('33 logged sets')
    expect(text).toContain('44 Coach analyses')
    expect(text).toContain('55 Coach notes')
  })
})

describe('the title and the other states', () => {
  it('"Delete [name]?": the program\'s own name', () => {
    expect(fullDeleteTitle('Cut PPL')).toBe('Delete Cut PPL?')
  })

  it('counting: "Counting what goes…" with DELETE off', () => {
    expect(FULL_DELETE_COUNTING).toBe('Counting what goes…')
    expect(fullDeleteBody({ kind: 'counting' })).toEqual({ text: 'Counting what goes…', canDelete: false })
  })

  it('offline: "You\'re offline. Deleting needs a connection." with DELETE off', () => {
    expect(FULL_DELETE_OFFLINE).toBe("You're offline. Deleting needs a connection.")
    expect(fullDeleteBody({ kind: 'offline' })).toEqual({ text: "You're offline. Deleting needs a connection.", canDelete: false })
  })

  it('a count that could not be read: it says so and DELETE stays off', () => {
    expect(FULL_DELETE_COUNT_FAILED).toBe("Couldn't count what goes.")
    expect(fullDeleteBody({ kind: 'failed' })).toEqual({ text: "Couldn't count what goes.", canDelete: false })
  })

  it('counted: the sentence, and DELETE on — the only state in which it is', () => {
    const c = counts({ weeks: 1, sessions: 2, loggedSets: 31 })
    expect(fullDeleteBody({ kind: 'counted', counts: c })).toEqual({ text: fullDeleteText(c), canDelete: true })
    for (const kind of ['offline', 'counting', 'failed'] as const) expect(fullDeleteBody({ kind }).canDelete).toBe(false)
  })

  it('no word of it is one the UI is not to say (C12: "program" everywhere): no run, no meso, no tag', () => {
    const all = [
      fullDeleteText(counts({ coachAnalyses: 2, coachNotes: 2 })),
      fullDeleteTitle('Cut PPL'),
      FULL_DELETE_COUNTING,
      FULL_DELETE_OFFLINE,
      FULL_DELETE_COUNT_FAILED,
    ].join(' ')
    expect(all).not.toMatch(/\bruns?\b|\bmeso(cycle)?s?\b|\btags?\b/i)
  })
})
