// What each release says about itself (SPEC.md 1.2.1, "Release notes"; TASKS.md, Data model). Not in the database: the notes ship inside
// the app, one entry per version, so a version's notes always match the code running and work offline. This file is the source of truth
// (Adam, 2026-10-30, TASKS question 16, DECISIONS 265); `docs/release-1.2.1-notes.md`, the longer form, is written from it. Settings'
// WHAT'S NEW lists the entries, newest first; the sheet after an update opens the running version's.
//
// An entry: the version, its date (ISO, the day it was released) and groups of short lines. Add the next release at the top; a test
// (releaseNotes.test.ts) keeps the versions falling and the dates real, and scripts/release-version.test.mjs keeps the first entry's
// version equal to package.json's and to the `min_version` migration 048 seeds.
export interface ReleaseNoteGroup {
  title: string
  items: string[]
}
export interface Release {
  version: string
  /** ISO date, `2026-10-28`. */
  date: string
  groups: ReleaseNoteGroup[]
}

export const RELEASES: Release[] = [
  // 1.2.1: Adam's own text (2026-10-31; DECISIONS 265, 275), in place of the lines drafted from what was built. The "What's new"
  // section of docs/release-1.2.1-notes.md is this entry word for word (releaseNotes.test.ts reads that file and compares), so an edit
  // is made in both.
  {
    version: '1.2.1',
    date: '2026-11-01', // DATE: Adam may move it; one line here and the docs file (run sheet, step 0)
    groups: [
      {
        title: 'Programs',
        items: [
          "Delete a saved program from YOUR PROGRAMS. The one you're running can't be deleted until you finish it. Its finished programs stay in History.",
          'Deleting a finished program now removes everything in it: sessions, sets and its Coach notes. You see what goes before you confirm.',
          "Both deletes need a connection and can't be undone.",
          'A finished program opens on week 1, and its PRIORITIES are read-only.',
        ],
      },
      {
        title: 'The workout',
        items: [
          'PREVIEW SESSION now looks like the workout itself.',
          'Once every set is logged or skipped, the rest bar says WORKOUT COMPLETE with a FINISH button.',
          'The LAST line also shows the same set from earlier this week.',
          'Warmup rows work like any other row: ⋯ on an open one, the pen on a logged one.',
          'The history icon is gone: tap the LAST line, or ⋯ → HISTORY.',
        ],
      },
      {
        title: 'Planner',
        items: [
          'Supersets move as one with ↑ ↓.',
          'TEMPO has a picker: four boxes, 0–20 or X. No more typing dashes.',
          'In CHANGE THE PROGRAM, a split superset can be joined again.',
        ],
      },
      {
        title: 'The app',
        items: [
          "WHAT'S NEW in Settings lists every release. A new version's notes open once.",
          'A BACK SOON screen while Overload is updated. Offline changes are kept and sent after.',
          'Old versions ask you to update before you continue. Unsent changes are kept.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Unlogging, deleting or renumbering a set offline shows as done right away.',
          'A planned set deleted offline stays gone.',
          "A finished program's week strip no longer disappears on long weeks.",
          '"N days a week" on CURRENT PROGRAM counts this week\'s days.',
        ],
      },
    ],
  },
  // 1.2: the "What's new" section of docs/release-1.2-notes.md, line for line (releaseNotes.test.ts reads that file and compares). Two
  // lines are reworded, and only those two: the notes said "run" once and "meso", "mesocycle" and "tags" in their last line, words the
  // UI never says (scripts/check-wording.test.mjs; DECISIONS 251). The test names both.
  {
    version: '1.2',
    date: '2026-10-28',
    groups: [
      {
        title: 'Plan, rebuilt',
        items: [
          'One week view per week.',
          "A week is planned when it starts, or a week ahead with PLAN FORWARD: structure, volume and set types, and no weights, reps or RIR. A stable program takes its default's rep targets.",
          'Numbers come only with COPY, which has its own fields and an overwrite switch.',
          'REVIEW goes through what went differently last week, and VOLUME shows last week → this week per muscle.',
          'Change marks show what changed since the week the plan came from.',
          'Done sessions and past weeks are read-only.',
          'Rep and RIR target pickers everywhere, a RIR range ("1–2"), and one set type picker for every kind of set.',
        ],
      },
      {
        title: 'Programs',
        items: [
          'PLAN | PROGRAMS at the top of the Plan tab.',
          'The PROGRAMS tab: the current program, your programs, finished ones.',
          'CHANGE THE PROGRAM, for everything about a running program: exercises, sets, supersets, rest, tempo, the warmup routine, weekdays and the name.',
          'START lands on Plan, week 1. FINISH keeps the program saved.',
          'A finished program shows its dates, weeks, deloads, priorities and how its structure changed.',
        ],
      },
      {
        title: 'The workout',
        items: [
          'Logged, current and upcoming rows. The plan\'s targets sit in the boxes, with "last time" and "earlier this week".',
          'A pinned rest bar.',
          'The log lock ("Log sets in order").',
          'A pen on a logged set opens the edit panel: its numbers, SET TYPE, UNLOG and DELETE.',
          'The set type can change during a workout. Stage rows open by themselves, and + ADD ROUND adds a set to every member of a superset.',
          'Swap for today moves only the remaining sets.',
          'The finish warning about unlogged sets is back.',
          'Logging, unlog and delete work offline.',
        ],
      },
      {
        title: 'Settings',
        items: ['"Drops and stages count as" (default ½) and "Log sets in order" (default on). The deload rules live here only. "New week starts" is gone.'],
      },
      {
        title: 'Words',
        items: ['"Program" everywhere, "cues", "change the program".'],
      },
    ],
  },
]
