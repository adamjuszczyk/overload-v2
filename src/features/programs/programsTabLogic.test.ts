import { describe, it, expect } from 'vitest'
import { addDays, format, getDay, parseISO } from 'date-fns'
import type { StoredMark } from '../../lib/priorityMarks'
import {
  CHANGE_PROGRAM_PATH,
  CHOOSE_TYPES_HINT,
  NAME_IT_HINT,
  NO_SCHEDULE_REASON,
  PLAN_WEEK_ONE_PATH,
  PRIORITIES_PATH,
  createState,
  finishedMeta,
  finishedProgramPath,
  finishedPrioritiesPath,
  legacyPrioritiesPath,
  markLine,
  markSummary,
  finishedWeekCount,
  plannerPath,
  programTypesLine,
  runNameFor,
  startFailedLine,
  startNote,
  startSheetTitle,
  startedLine,
  weekOfRun,
} from './programsTabLogic'

// The words of the PROGRAMS tab (chunk 65), at the pure layer. Dates are derived from one Monday and printed by the first test (Checks that
// lied #21: a hand-typed date on the wrong weekday made three scheduler scenarios fail for a reason the scheduler hadn't caused); a count
// that turns on the end of a week is tested on both sides of the Sunday / Monday boundary (RULES: Monday-anchored calendar weeks).

const MONDAY = '2026-10-12'
const day = (offset: number) => format(addDays(parseISO(MONDAY), offset), 'yyyy-MM-dd')

describe('the fixture dates', () => {
  it('are derived from a Monday, and the queue is printed', () => {
    expect(format(parseISO(MONDAY), 'EEEE')).toBe('Monday')
    const queue = [0, 2, 6, 7, 13, 14, 20, 21].map((offset) => `${day(offset)} ${format(parseISO(day(offset)), 'EEE')}`)
    expect(queue).toEqual(['2026-10-12 Mon', '2026-10-14 Wed', '2026-10-18 Sun', '2026-10-19 Mon', '2026-10-25 Sun', '2026-10-26 Mon', '2026-11-01 Sun', '2026-11-02 Mon'])
    for (const offset of [0, 7, 14, 21]) expect(getDay(parseISO(day(offset)))).toBe(1)
  })
})

describe('weekOfRun', () => {
  it('counts calendar weeks from the Monday of the week the run started in, whatever weekday it started on', () => {
    // started on a Wednesday: that whole week is week 1, through its Sunday; the next Monday is week 2
    expect(weekOfRun(day(2), day(2))).toBe(1)
    expect(weekOfRun(day(6), day(2))).toBe(1)
    expect(weekOfRun(day(7), day(2))).toBe(2)
    expect(weekOfRun(day(13), day(2))).toBe(2)
    expect(weekOfRun(day(14), day(2))).toBe(3)
  })

  it('a run that starts after today has no current week yet: week 1, never 0 or a negative', () => {
    expect(weekOfRun(day(0), day(7))).toBe(1)
    expect(weekOfRun(day(0), day(21))).toBe(1)
  })
})

describe('programTypesLine', () => {
  const MONDAY_WORKOUT = { monday: 'wd-1', tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
  const FIVE_DAYS = { monday: 'wd-1', tuesday: 'wd-2', wednesday: null, thursday: 'wd-1', friday: 'wd-3', saturday: 'wd-4', sunday: null }
  const NO_DAYS = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }

  it('PR1: "Weekdays · stable · 5 days a week", counting weekdays that have a workout (a workout on two of them counts both)', () => {
    expect(programTypesLine({ scheduleType: 'weekday', planningType: 'stable', schedule: FIVE_DAYS })).toBe('Weekdays · stable · 5 days a week')
  })

  it('a row of YOUR PROGRAMS says it in capitals', () => {
    expect(programTypesLine({ scheduleType: 'weekday', planningType: 'stable', schedule: FIVE_DAYS }, true)).toBe('WEEKDAYS · STABLE · 5 DAYS A WEEK')
    expect(programTypesLine({ scheduleType: 'weekday', planningType: 'week_dependent', schedule: FIVE_DAYS }, true)).toBe('WEEKDAYS · WEEK-DEPENDENT · 5 DAYS A WEEK')
  })

  it('one day is "1 day a week"', () => {
    expect(programTypesLine({ scheduleType: 'weekday', planningType: 'stable', schedule: MONDAY_WORKOUT })).toBe('Weekdays · stable · 1 day a week')
  })

  it('a weekday program with no workout on any weekday says nothing about days (an unset feature shows nothing)', () => {
    expect(programTypesLine({ scheduleType: 'weekday', planningType: 'stable', schedule: NO_DAYS })).toBe('Weekdays · stable')
  })

  it('a sequence program says nothing about days, even when a weekday map is left under it (the switch converts nothing)', () => {
    expect(programTypesLine({ scheduleType: 'sequence', planningType: 'week_dependent', schedule: FIVE_DAYS })).toBe('Sequence · week-dependent')
    expect(programTypesLine({ scheduleType: 'sequence', planningType: 'stable', schedule: NO_DAYS }, true)).toBe('SEQUENCE · STABLE')
  })

  it('a program whose types were never stored reads as the columns\' own defaults: weekdays, week-dependent', () => {
    expect(programTypesLine({ schedule: NO_DAYS })).toBe('Weekdays · week-dependent')
  })
})

describe('finishedMeta', () => {
  it('PR1: dates then weeks, in capitals, the year said once when both dates are in it', () => {
    // Monday 12 Oct to Sunday 1 Nov: three calendar weeks
    expect(finishedMeta({ startDate: day(0), endDate: day(20) })).toBe('OCT 12 – NOV 1, 2026 · 3 WEEKS')
  })

  it('the weeks are Monday-anchored: the Sunday ends the third week and the next Monday opens a fourth', () => {
    expect(finishedMeta({ startDate: day(0), endDate: day(20) })).toContain('3 WEEKS')
    expect(finishedMeta({ startDate: day(0), endDate: day(21) })).toContain('4 WEEKS')
    // started on a Sunday, ended the next day: two calendar weeks, though it ran two days
    expect(finishedMeta({ startDate: day(6), endDate: day(7) })).toContain('2 WEEKS')
  })

  it('a run that ended the week it started is "1 WEEK", singular', () => {
    expect(finishedMeta({ startDate: day(0), endDate: day(3) })).toBe('OCT 12 – OCT 15, 2026 · 1 WEEK')
    expect(finishedMeta({ startDate: day(2), endDate: day(2) })).toContain('1 WEEK')
  })

  it('an end date before the start (bad data) never says 0 weeks or a negative number: 1 WEEK', () => {
    // the end two Mondays before the start: the calendar weeks between them count -2, +1 is -1
    expect(finishedMeta({ startDate: day(14), endDate: day(0) })).toBe('OCT 26 – OCT 12, 2026 · 1 WEEK')
    // the end one Monday before the start: -1 + 1 = 0
    expect(finishedMeta({ startDate: day(7), endDate: day(0) })).toContain('· 1 WEEK')
  })

  it('dates in two years carry both', () => {
    expect(finishedMeta({ startDate: '2025-12-29', endDate: '2026-01-11' })).toBe('DEC 29, 2025 – JAN 11, 2026 · 2 WEEKS')
  })

  it('a run with no end date says only when it started, and no weeks', () => {
    expect(finishedMeta({ startDate: day(0), endDate: null })).toBe('OCT 12, 2026')
  })
})

describe('startedLine', () => {
  it('PR1: "Started Oct 5, 2026"', () => {
    expect(startedLine('2026-10-05')).toBe('Started Oct 5, 2026')
  })
})

// Chunk 66: PR14's PRIORITIES row says the two halves of PR1's FOCUS and DON'T CARE rows on one line.
describe('markLine (PR14)', () => {
  const mark = (tagType: StoredMark['tagType'], tagValue: string, value: StoredMark['mark']): StoredMark => ({ tagType, tagValue, mark: value, updatedAt: '2026-01-01T00:00:00Z' })

  it('"Focus: chest, back · Don\'t care: calves": each half in lower case after its label, joined with a dot', () => {
    const rows = [mark('muscle_group', 'back', 'focus'), mark('muscle_group', 'chest', 'focus'), mark('muscle_group', 'calves', 'dont_care')]
    expect(markLine(rows)).toBe("Focus: chest, back · Don't care: calves")
  })

  it('a half with nothing in it is left out, and a run with no marks has no line at all (an unset feature shows nothing)', () => {
    expect(markLine([mark('muscle_group', 'chest', 'focus')])).toBe('Focus: chest')
    expect(markLine([mark('muscle_group', 'calves', 'dont_care')])).toBe("Don't care: calves")
    expect(markLine([])).toBeNull()
  })

  it('a group with a subgroup marked otherwise reads as the planner says it, in lower case', () => {
    const rows = [mark('muscle_group', 'chest', 'focus'), mark('muscle_subgroup', 'upper_chest', 'dont_care')]
    expect(markLine(rows)).toBe("Focus: chest without upper chest · Don't care: upper chest")
  })
})

// Chunk 66: the weeks of a finished program (P1.2-4), the number the FINISHED row and PR14's header both say.
describe('finishedWeekCount', () => {
  it('calendar weeks from the start date to the end date, Monday-anchored: a Monday to the Sunday after next is 2 weeks, to the Monday after that 3, and a Sunday to the next Monday is 2', () => {
    expect(finishedWeekCount({ startDate: day(0), endDate: day(13) })).toBe(2)
    expect(finishedWeekCount({ startDate: day(0), endDate: day(14) })).toBe(3)
    expect(finishedWeekCount({ startDate: day(6), endDate: day(7) })).toBe(2)
    expect(finishedWeekCount({ startDate: day(0), endDate: day(0) })).toBe(1)
  })

  it('never fewer than one, even for dates the wrong way round', () => {
    expect(finishedWeekCount({ startDate: day(14), endDate: day(0) })).toBe(1)
  })
})

describe('markSummary', () => {
  const mark = (tagType: StoredMark['tagType'], tagValue: string, value: StoredMark['mark']): StoredMark => ({ tagType, tagValue, mark: value, updatedAt: '2026-01-01T00:00:00Z' })

  it('PR1: the groups marked so, in the planner\'s order, capitalised once: "Chest, back"', () => {
    // stored back first: the order comes from the planner's list, not from the rows
    const rows = [mark('muscle_group', 'back', 'focus'), mark('muscle_group', 'chest', 'focus'), mark('muscle_group', 'calves', 'dont_care'), mark('muscle_group', 'forearms', 'dont_care')]
    expect(markSummary(rows, 'focus')).toBe('Chest, back')
    // (the planner lists forearms before calves; the board's sample row reads "Calves, forearms" because it was typed by hand)
    expect(markSummary(rows, 'dont_care')).toBe('Forearms, calves')
  })

  it('only the marks of the kind asked for: a group marked the other way is not in the row', () => {
    const rows = [mark('muscle_group', 'chest', 'focus'), mark('muscle_group', 'calves', 'dont_care')]
    expect(markSummary(rows, 'focus')).toBe('Chest')
    expect(markSummary(rows, 'dont_care')).toBe('Calves')
  })

  it('a group with a subgroup marked otherwise says so the planner\'s way ("chest without upper chest"), and the subgroup is in the other row', () => {
    const rows = [mark('muscle_group', 'chest', 'focus'), mark('muscle_subgroup', 'upper_chest', 'dont_care'), mark('muscle_group', 'back', 'focus')]
    expect(markSummary(rows, 'focus')).toBe('Chest without upper chest, back')
    expect(markSummary(rows, 'dont_care')).toBe('Upper chest')
  })

  it('two subgroups marked otherwise are both named after "without", joined with commas as the planner\'s own summary joins them', () => {
    // priorityMarks.test.ts pins the planner's phrase: 'chest without upper chest, lower chest'
    const rows = [mark('muscle_group', 'chest', 'focus'), mark('muscle_subgroup', 'lower_chest', 'dont_care'), mark('muscle_subgroup', 'upper_chest', 'dont_care')]
    expect(markSummary(rows, 'focus')).toBe('Chest without upper chest, lower chest')
    // (in the planner's order, not the order they were stored in)
    expect(markSummary(rows, 'dont_care')).toBe('Upper chest, lower chest')
  })

  it('a subgroup marked under a group with no mark is listed by its own name', () => {
    expect(markSummary([mark('muscle_subgroup', 'side_delt', 'focus')], 'focus')).toBe('Side delt')
  })

  it('a subgroup marked the same as its group is no exception and is not named twice', () => {
    expect(markSummary([mark('muscle_group', 'chest', 'focus'), mark('muscle_subgroup', 'upper_chest', 'focus')], 'focus')).toBe('Chest')
  })

  it('null when nothing is marked so (no marks at all, or only the other kind): the card draws no row', () => {
    expect(markSummary([], 'focus')).toBeNull()
    expect(markSummary([], 'dont_care')).toBeNull()
    expect(markSummary([mark('muscle_group', 'chest', 'focus')], 'dont_care')).toBeNull()
  })
})

describe('the start sheet\'s words', () => {
  it('PR8 and PR9: the title says "new" only when a program is running', () => {
    expect(startSheetTitle(false)).toBe('Start a program')
    expect(startSheetTitle(true)).toBe('Start a new program')
  })

  it('PR9: starting finishes the running program, by its own name, and its weeks stay in History', () => {
    expect(startNote('Push Pull Legs')).toBe('Starting it finishes Push Pull Legs. Its weeks stay in History.')
  })

  it('PR11: the reason ends in a full stop (the planner\'s line, in hasSchedule.ts, doesn\'t)', () => {
    expect(NO_SCHEDULE_REASON).toBe('Schedule at least one workout to start.')
  })

  it('PR8: the run is named what was typed, trimmed, else the program\'s own name', () => {
    expect(runNameFor('  My Block  ', { name: 'Upper / Lower' })).toBe('My Block')
    expect(runNameFor('', { name: 'Upper / Lower' })).toBe('Upper / Lower')
    expect(runNameFor('   ', { name: 'Upper / Lower' })).toBe('Upper / Lower')
  })

  it('PR10: "Couldn\'t start [name]."', () => {
    expect(startFailedLine('Upper / Lower')).toBe("Couldn't start Upper / Lower.")
  })
})

describe('createState — CREATE PROGRAM and the line under it (PR13, PR13b)', () => {
  it('nothing chosen, or only one type: disabled, and the line says to choose both (the board\'s words)', () => {
    expect(createState({ name: 'Block', scheduleType: null, planningType: null })).toEqual({ canCreate: false, hint: 'Choose a schedule and a planning type to create it.' })
    expect(createState({ name: 'Block', scheduleType: 'weekday', planningType: null })).toEqual({ canCreate: false, hint: CHOOSE_TYPES_HINT })
    expect(createState({ name: 'Block', scheduleType: null, planningType: 'stable' })).toEqual({ canCreate: false, hint: CHOOSE_TYPES_HINT })
  })

  it('both chosen and a name: enabled, and the line says both can be changed later', () => {
    expect(createState({ name: 'Block', scheduleType: 'sequence', planningType: 'week_dependent' })).toEqual({ canCreate: true, hint: 'You can change both later in the program.' })
  })

  it('both chosen and no name (blank, or only spaces): disabled, and the line says to name it (ours)', () => {
    expect(createState({ name: '', scheduleType: 'weekday', planningType: 'stable' })).toEqual({ canCreate: false, hint: 'Name the program to create it.' })
    expect(createState({ name: '   ', scheduleType: 'weekday', planningType: 'stable' })).toEqual({ canCreate: false, hint: NAME_IT_HINT })
  })

  it('the types are said first: with neither chosen and no name, it is the board\'s line, not the name\'s', () => {
    expect(createState({ name: '', scheduleType: null, planningType: null }).hint).toBe(CHOOSE_TYPES_HINT)
  })
})

describe('where the tab\'s links go', () => {
  it('FOCUS and DON\'T CARE open the view-only priorities, EDIT PROGRAM opens CHANGE THE PROGRAM, OPEN the planner on that program', () => {
    expect(PRIORITIES_PATH).toBe('/plan/priorities')
    expect(CHANGE_PROGRAM_PATH).toBe('/plan/change')
    expect(plannerPath('prog-9')).toBe('/program/prog-9')
  })

  it('START lands on Plan with the week forced to 1', () => {
    expect(PLAN_WEEK_ONE_PATH).toBe('/plan?week=1')
  })

  it('a FINISHED row opens the finished program (chunk 66); its PRIORITIES row opens the editor, or for a pre-1.1 run the completed-run page as it is (G50)', () => {
    expect(finishedProgramPath('meso-3')).toBe('/program/finished/meso-3')
    expect(finishedPrioritiesPath('meso-3')).toBe('/program/finished/meso-3/priorities')
    expect(legacyPrioritiesPath('meso-3')).toBe('/meso/meso-3/priorities')
  })
})
