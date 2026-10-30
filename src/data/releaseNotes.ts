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
  // PLACEHOLDER (chunk 71): the lines and the date below are the prototype's sample text, so the screens can be built and checked
  // before the release. TASKS.md, "Release", step 1: the whole entry is replaced with the real notes (and the real date) in a docs-and-data
  // PR into `staging` before the release checklist. `grep -n PLACEHOLDER src/data/releaseNotes.ts` finds it.
  {
    version: '1.2.1',
    date: '2026-11-05',
    groups: [
      { title: 'Programs', items: ['Delete a saved program from YOUR PROGRAMS.', 'Deleting a finished program now removes its sessions and logged sets too.'] },
      { title: 'The app', items: ["What's new, here in Settings.", 'A maintenance screen while an update is applied.', 'Old versions ask to update before they can be used.'] },
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
