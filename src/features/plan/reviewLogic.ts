import type { ReviewAction } from './review'

// Chunk 56 (TASKS-1.2 "REVIEW"; SPEC [1.2] Review (13); board 4, board 1's line). The words of REVIEW's line and sheet that chunk 43's
// `reviewItemText` doesn't hold (it words the items), as pure functions so the screens only draw them.

export type ReviewUnit = 'week' | 'cycle'

const LAST: Record<ReviewUnit, string> = { week: 'LAST WEEK', cycle: 'LAST CYCLE' }

const things = (count: number): string => `${count} ${count === 1 ? 'thing' : 'things'}`

/** The line under the action row (board 1): its small caption and its text. P1.2-3: exactly one thing reads "1 thing went differently". */
export function reviewLineText(count: number, unit: ReviewUnit): { caption: string; text: string; link: string } {
  return { caption: LAST[unit], text: `${things(count)} went differently`, link: 'REVIEW →' }
}

/** The sheet's small line over its title (board 4: "LAST WEEK · 3 THINGS"). */
export function reviewEyebrow(count: number, unit: ReviewUnit): string {
  return `${LAST[unit]} · ${things(count).toUpperCase()}`
}

/** The sentence under the title (board 4). */
export const reviewExplanation = (unit: ReviewUnit): string => `Where last ${unit} went differently from its plan. Take it over or leave it.`

/** What the pressed button says while its request is out (the app's pending pattern: MARKING…, COPYING…). */
export function reviewPendingLabel(action: ReviewAction): string {
  switch (action) {
    case 'ignore':
      return 'IGNORING…'
    case 'use':
      return 'USING…'
    case 'add_set':
    case 'add_exercise':
      return 'ADDING…'
    case 'remove_set':
      return 'REMOVING…'
    case 'swap':
      return 'SWAPPING…'
  }
}

/** The headline of an item's error; the line under it is the real reason (SPEC Errors (15)). */
export const reviewFailureHeadline = (action: ReviewAction): string => (action === 'ignore' ? "Couldn't ignore this." : "Couldn't take this over.")
