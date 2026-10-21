import { describe, expect, it } from 'vitest'
import type { MuscleGroup, WeeklySchedule } from '../../types'
import { MUSCLE_GROUPS } from '../../lib/exerciseTags'
import { lastWeekIsEmpty, muscleName, occurrencesOf, volumeExercises, volumeFooter } from './volumeSheetLogic'
import { pe, wset } from './weekPlanning.testutil'

// Chunk 55: what the VOLUME sheet decides apart from the counting (chunk 44's `volumeRows`, tested there): how many sessions a plan row
// stands for, which exercises its rows can name, when last week is empty, and the words.

const FULL_BODY: WeeklySchedule = { monday: null, tuesday: 'wd-full', wednesday: null, thursday: 'wd-full', friday: null, saturday: 'wd-arms', sunday: null }

describe('occurrencesOf: the weekdays of the schedule in force that hold the workout', () => {
  it('a workout on Tuesday and Thursday (G14: one shared plan row) stands for two sessions; one on a day, one', () => {
    expect(occurrencesOf({ workoutDayId: 'wd-full' }, FULL_BODY)).toBe(2)
    expect(occurrencesOf({ workoutDayId: 'wd-arms' }, FULL_BODY)).toBe(1)
  })

  it('a workout the schedule no longer holds on any day stands for none', () => {
    expect(occurrencesOf({ workoutDayId: 'wd-legs' }, FULL_BODY)).toBe(0)
  })

  it('reads a sparse schedule (a weekday left out) as no workout that day, and the schedule it is given, not another week\'s', () => {
    const sparse = { tuesday: 'wd-full' } as WeeklySchedule
    expect(occurrencesOf({ workoutDayId: 'wd-full' }, sparse)).toBe(1)
    expect(occurrencesOf({ workoutDayId: 'wd-full' }, { ...FULL_BODY, thursday: 'wd-arms' })).toBe(1)
  })

  it('a sequence run has no weekday schedule: every plan row is one session, whatever its workout', () => {
    expect(occurrencesOf({ workoutDayId: 'wd-full' }, null)).toBe(1)
  })
})

describe('volumeExercises: every exercise a planned set or a log can name', () => {
  const planWith = (...rows: ReturnType<typeof pe>[]) => ({ exercises: rows })
  const group = (id: string, muscleGroup: MuscleGroup) => pe(`row-${id}`, id, 0, { exercise: { ...pe('x', id, 0).exercise!, muscleGroup } })

  it('takes the exercises last week\'s logs name and the plans\' own (both weeks) for the rest, each once', () => {
    const out = volumeExercises(
      [planWith(group('bench', 'chest'), group('row', 'back')), planWith(group('bench', 'chest'), group('squat', 'quads'))],
      [{ id: 'fly', muscleGroup: 'chest' }, { id: 'row', muscleGroup: 'back' }],
    )
    expect(out).toEqual([
      { id: 'fly', muscleGroup: 'chest' },
      { id: 'row', muscleGroup: 'back' },
      { id: 'bench', muscleGroup: 'chest' },
      { id: 'squat', muscleGroup: 'quads' },
    ])
  })

  it('where a log and a plan row name one exercise, the read\'s group counts: the plan\'s joined copy can be minutes old', () => {
    const out = volumeExercises([planWith(group('pushdown', 'triceps'))], [{ id: 'pushdown', muscleGroup: 'biceps' }])
    expect(out).toEqual([{ id: 'pushdown', muscleGroup: 'biceps' }])
  })

  it('a plan row whose exercise wasn\'t joined names nothing (it is counted under Other); a logged exercise fills the gap', () => {
    const bare = pe('row-x', 'swapped', 0)
    delete (bare as { exercise?: unknown }).exercise
    expect(volumeExercises([planWith(bare)], [])).toEqual([])
    expect(volumeExercises([planWith(bare)], [{ id: 'swapped', muscleGroup: 'back' }])).toEqual([{ id: 'swapped', muscleGroup: 'back' }])
  })
})

describe('lastWeekIsEmpty (P1.2-2): nothing planned and nothing done', () => {
  const planned = { sets: [wset('s-1', 'row-1', 1)] }
  const hollow = { sets: [] }

  it('no plan row and no session: empty (a week nobody planned, DECISIONS 131)', () => {
    expect(lastWeekIsEmpty([], 0)).toBe(true)
  })

  it('plan rows with no set in any of them and no session: empty', () => {
    expect(lastWeekIsEmpty([hollow, hollow], 0)).toBe(true)
  })

  it('a planned week nobody started is not empty: it counts what it counts, with its notes', () => {
    expect(lastWeekIsEmpty([planned], 0)).toBe(false)
    expect(lastWeekIsEmpty([hollow, planned], 0)).toBe(false)
  })

  it('a week with a session is not empty, whatever its plan holds', () => {
    expect(lastWeekIsEmpty([hollow], 1)).toBe(false)
    expect(lastWeekIsEmpty([], 1)).toBe(false)
  })
})

describe('muscleName: the board writes the group as a word', () => {
  it('all twelve groups, `Chest` to `Other`', () => {
    expect(MUSCLE_GROUPS.map(muscleName)).toEqual(['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Other'])
  })
})

describe('volumeFooter: last week\'s name and the rule\'s own fraction', () => {
  it('board 3\'s words under the default rule (a drop counts as ½ set)', () => {
    expect(volumeFooter({ unit: 'week', lastWeek: 1, rule: 'half' })).toBe(
      "Week 1 counts the sets you actually did. Warmups don't count. A drop counts as ½ set — you can change that in Settings.",
    )
  })

  it('each drop = 1: "as 1 set"; whole set = 1: "doesn\'t count"', () => {
    expect(volumeFooter({ unit: 'week', lastWeek: 2, rule: 'each' })).toBe(
      "Week 2 counts the sets you actually did. Warmups don't count. A drop counts as 1 set — you can change that in Settings.",
    )
    expect(volumeFooter({ unit: 'week', lastWeek: 2, rule: 'whole' })).toBe(
      "Week 2 counts the sets you actually did. Warmups don't count. A drop doesn't count — you can change that in Settings.",
    )
  })

  it('a sequence run says Cycle', () => {
    expect(volumeFooter({ unit: 'cycle', lastWeek: 2, rule: 'half' })).toMatch(/^Cycle 2 counts the sets you actually did\./)
  })
})
