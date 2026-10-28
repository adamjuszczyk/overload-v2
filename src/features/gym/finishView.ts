// Chunk 64 — what the finish screen says (boards W18 and W19; SPEC [1.2] "Finishing (11, C6)"), as pure functions. The screen hands them what it has.
import type { Session, SetLog } from '../../types'
import { countCompletedSets } from './countCompletedSets'

export interface FinishTiles {
  working: number
  skipped: number
  warmups: number
}

/**
 * The three tiles, "as today" (SPEC G51: History, Progress and the finish screen count as they do today; TASKS 64: "`countCompletedSets` and the skipped count").
 * WORKING SETS and SKIPPED are `countCompletedSets`: every log that is not a warmup, a drop's included, done or skipped. WARMUPS are the warmup logs that were done
 * (a warmup is never skipped in practice; one that was is in neither tile, as `countCompletedSets` leaves it out of both). The old screen counted every log that
 * wasn't skipped under SETS LOGGED, warmups and drops among them: the board gives warmups a tile of their own.
 */
export function finishTiles(logs: SetLog[]): FinishTiles {
  const { total, skipped } = countCompletedSets(logs)
  return { working: total, skipped, warmups: logs.filter((log) => log.isWarmup && !log.isSkipped).length }
}

/**
 * Whether the session is a reopened one, which finishes through W19 (SPEC 11: "A reopened session finishes through W19"; no warning box, "a reopened session's planned
 * sets are what they were"). SPEC names no marker for it and 1.2 adds no column (TASKS 64: Migration none), so the screen reads what the earlier COMPLETE left on
 * the session: its note and its energy and pump ratings, the three values `SessionComplete` has always prefilled for "a session that was already completed once".
 * A session completed with none of the three, then reopened, reads as a new one (DECISIONS: a reading, listed in chunk 64's report).
 */
export function isReopened(session: Pick<Session, 'note' | 'energyRating' | 'pumpRating'> | undefined): boolean {
  return session !== undefined && (Boolean(session.note) || session.energyRating != null || session.pumpRating != null)
}

/** The title: "FINISH PULL 1" (board W18). */
export function finishTitle(workoutName: string): string {
  return `FINISH ${workoutName.toUpperCase()}`
}
