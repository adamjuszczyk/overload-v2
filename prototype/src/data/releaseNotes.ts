// Shipped with the app: each version carries its own notes (1.2.1, settled
// 2026-10-29). Newest first. 1.2.1's notes are SAMPLE text until its release.
export interface ReleaseNoteGroup { title: string; items: string[] }
export interface Release { version: string; date: string; groups: ReleaseNoteGroup[] }

export const APP_VERSION = '1.2.1'

export const RELEASES: Release[] = [
  {
    version: '1.2.1',
    date: '2026-11-05',
    groups: [
      { title: 'Programs', items: ['Delete a saved program from YOUR PROGRAMS.', 'Deleting a finished program now removes its sessions and logged sets too.'] },
      { title: 'The app', items: ["What's new, here in Settings.", 'A maintenance screen while an update is applied.', 'Old versions ask to update before they can be used.'] },
    ],
  },
  {
    version: '1.2',
    date: '2026-10-28',
    groups: [
      { title: 'Plan, rebuilt', items: [
        'One week view per week.',
        'A week is planned when it starts, or a week ahead with PLAN FORWARD: structure, volume and set types, and no weights, reps or RIR. A stable run takes its default’s rep targets.',
        'Numbers come only with COPY, which has its own fields and an overwrite switch.',
        'REVIEW goes through what went differently last week, and VOLUME shows last week → this week per muscle.',
        'Change marks show what changed since the week the plan came from.',
        'Done sessions and past weeks are read-only.',
        'Rep and RIR target pickers everywhere, a RIR range (“1–2”), and one set type picker for every kind of set.',
      ] },
      { title: 'Programs', items: [
        'PLAN | PROGRAMS at the top of the Plan tab.',
        'The PROGRAMS tab: the current program, your programs, finished ones.',
        'CHANGE THE PROGRAM, for everything about a running program: exercises, sets, supersets, rest, tempo, the warmup routine, weekdays and the name.',
        'START lands on Plan, week 1. FINISH keeps the program saved.',
        'A finished program shows its dates, weeks, deloads, priorities and how its structure changed.',
      ] },
      { title: 'The workout', items: [
        'Logged, current and upcoming rows. The plan’s targets sit in the boxes, with “last time” and “earlier this week”.',
        'A pinned rest bar.',
        'The log lock (“Log sets in order”).',
        'A pen on a logged set opens the edit panel: its numbers, SET TYPE, UNLOG and DELETE.',
        'The set type can change during a workout. Stage rows open by themselves, and + ADD ROUND adds a set to every member of a superset.',
        'Swap for today moves only the remaining sets.',
        'The finish warning about unlogged sets is back.',
        'Logging, unlog and delete work offline.',
      ] },
      { title: 'Settings', items: ['“Drops and stages count as” (default ½) and “Log sets in order” (default on). The deload rules live here only. “New week starts” is gone.'] },
      { title: 'Words', items: ['“Program” everywhere (never meso or mesocycle), “cues” (never tags), “change the program”.'] },
    ],
  },
]
