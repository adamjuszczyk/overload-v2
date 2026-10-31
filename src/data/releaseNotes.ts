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
  // 1.2.1: drafted from what was built (SPEC.md 1.2.1, "Screens" and "Rules"; HISTORY.md, the 1.2.1 sections), for Adam to edit
  // (DECISIONS 265, 275). The "What's new" section of docs/release-1.2.1-notes.md is this entry word for word (releaseNotes.test.ts
  // reads that file and compares), so an edit here is made in both.
  {
    version: '1.2.1',
    date: '2026-11-02', // DATE: Adam sets the release date
    groups: [
      {
        title: 'Programs',
        items: [
          "Delete a saved program from YOUR PROGRAMS, beside OPEN and START. A program you are running can't be deleted: its DELETE is greyed out (FINISH IT FIRST). Its finished programs stay in History.",
          'Deleting a finished program now removes it in full: its sessions and logged sets, and the Coach analyses and notes that belong to it. The confirmation counts what goes first, and its results leave History, Progress and every stat.',
          "Both deletes need a connection and can't be undone.",
          'A finished program opens on week 1 and shows no superset labels on its exercises.',
          "A finished program's PRIORITIES are read-only: its marks, an older program's included.",
        ],
      },
      {
        title: 'The workout',
        items: [
          'PREVIEW SESSION looks like the workout: the same exercise headers with the LAST line, each set as an upcoming row (targets, W for warmups, ↳ for drops, cues), supersets as the workout draws them, and START SESSION pinned at the foot. The old targets panel is gone.',
          'The history icon beside ⋯ is gone: the LAST line and ⋯ → HISTORY open the same sheet.',
          'Once every working set and stage is logged or skipped, the rest bar says WORKOUT COMPLETE with a FINISH button. An added set brings the timer back.',
          'A working set\'s LAST line also shows the same set from earlier this week ("MON 32.5 × 8 @ 1").',
          'An open warmup is drawn like any open row, with its own ⋯: SET TYPE and DELETE SET.',
          "A logged warmup has no ✕: the pen's panel has UNLOG and DELETE, and unticking one unlogs it.",
          'UNLOG\'s note says "Unlog its drops first".',
        ],
      },
      {
        title: 'Planner',
        items: [
          "A superset has its own row in the planner's exercise step, with ↑ ↓ that move the whole superset. A member's ↑ ↓ move it only inside the superset.",
          'TEMPO opens a picker, in the planner and in CHANGE THE PROGRAM: four boxes (DOWN · BOTTOM · UP · TOP), each 0–20 or X for as fast as you can. No more typing dashes.',
          "In CHANGE THE PROGRAM, SUPERSET is offered on a superset's last member too, so a split superset can be joined again before SAVE.",
        ],
      },
      {
        title: 'The app',
        items: [
          "WHAT'S NEW replaces ABOUT in Settings: every release with its date and notes, newest first. A new version's notes open once, the first time you open it.",
          'A maintenance screen (BACK SOON) while Overload is updated. Changes you made offline are kept and sent afterwards.',
          'Old versions ask to update before they can be used (UPDATE TO CONTINUE), and unsent changes are kept and sent after the update. The RELOAD banner is gone.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'An UNLOG, a deleted set or a renumber made offline now reads as done at once, even when its first send failed. In 1.2 it read as undone until the next sync; nothing was lost.',
          "A planned set deleted offline stays gone at once, and a LOG can't land on it.",
          "A finished program's week strip no longer disappears when a week's cards are taller than the screen.",
          '"N days a week" on the CURRENT PROGRAM card counts this week\'s weekdays, not ones that start next week.',
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
