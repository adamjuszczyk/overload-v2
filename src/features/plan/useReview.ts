import { useMutation, useQuery } from '@tanstack/react-query'
import type { WeekPlan } from '../../types'
import { useAuth } from '../auth/useAuth'
import { useSettingsStore } from '../settings/settingsStore'
import { reviewItems, type ReviewAction, type ReviewEntry, type ReviewGroup } from './review'
import { REVIEW_DECISIONS_KEY, decideReviewItem, fetchReviewDecisions, fetchReviewSessions, type DecideArgs } from './reviewService'
import { DONE_WEEK_PLANS_KEY } from './useDoneWeekPlanIds'

// Chunk 56 (TASKS-1.2 "REVIEW"; SPEC [1.2] Review (13)): REVIEW's items for the week Plan shows, and the one mutation every action goes
// through. The page owns the plan rows (the open week's own query and the run's every-week list) and hands them in; what this reads is
// last week's sessions with their logs, swaps and set changes (`reviewService.ts`), and this week's decisions.

export interface ReviewReadArgs {
  /** The week (cycle) shown: 2 or more, week 1 has no REVIEW. */
  weekNumber: number
  /** This week's plan rows that can take a write: a row whose session is done is locked in Plan (SPEC 3), so it isn't here. */
  thisWeek: readonly WeekPlan[]
  /** The plan rows of week N−1; none for a week nobody planned (DECISIONS 131). */
  lastWeek: readonly WeekPlan[]
  /** Names for the headings ("TUE · UPPER A"). */
  workouts: ReadonlyArray<{ id: string; name: string }>
}

export interface ReviewRead {
  /** `loading` until both reads answer; `failed` when one failed or is paused offline (the line then isn't drawn, and nothing is decided). */
  status: 'loading' | 'failed' | 'ready'
  groups: ReviewGroup[]
  /** The items still to decide, over every group: what the line says. */
  count: number
  error: unknown
}

const NOTHING: ReviewRead = { status: 'ready', groups: [], count: 0, error: null }

const idsOf = (plans: readonly WeekPlan[]): string[] => [...new Set(plans.map((p) => p.id))].sort()

export function useReview(args: ReviewReadArgs): ReviewRead {
  const { user } = useAuth()
  const weightUnit = useSettingsStore((s) => s.weightUnit)
  const lastIds = idsOf(args.lastWeek)
  const thisIds = idsOf(args.thisWeek)
  // No plan row last week (a missed week) or none this week that can take a write: nothing to read, nothing to decide.
  const nothing = lastIds.length === 0 || thisIds.length === 0
  // The sessions' key sits under the done list's prefix, so every writer that refreshes that list (a start, a finish, a reopen, a skip, a
  // move) refreshes this one too; neither read is ever fresh, so each time Plan opens they read again.
  const sessions = useQuery({
    queryKey: [DONE_WEEK_PLANS_KEY, 'review', lastIds],
    queryFn: () => fetchReviewSessions(lastIds),
    enabled: !!user && !nothing,
    staleTime: 0,
  })
  const decisions = useQuery({
    queryKey: [REVIEW_DECISIONS_KEY, thisIds],
    queryFn: () => fetchReviewDecisions(thisIds),
    enabled: !!user && !nothing,
    staleTime: 0,
  })
  if (nothing) return NOTHING
  if (sessions.data === undefined || decisions.data === undefined) {
    // A read TanStack pauses offline is neither loading nor failed (RULES, chunk 55): it never ends, so it reads as failed.
    const failed = sessions.isError || decisions.isError || sessions.fetchStatus === 'paused' || decisions.fetchStatus === 'paused'
    return { status: failed ? 'failed' : 'loading', groups: [], count: 0, error: sessions.error ?? decisions.error }
  }
  const groups = reviewItems({
    weekNumber: args.weekNumber,
    lastWeek: { sessions: sessions.data, plan: args.lastWeek },
    thisWeek: args.thisWeek,
    decisions: decisions.data,
    workouts: args.workouts,
    weightUnit,
  })
  return { status: 'ready', groups, count: groups.reduce((n, g) => n + g.items.length, 0), error: null }
}

export interface ReviewActionVars {
  entry: ReviewEntry
  action: ReviewAction
  /** The item's plan row of this week, as Plan holds it now. */
  weekPlan: WeekPlan
}

/**
 * One action on one item (`decideReviewItem`). `networkMode: 'always'` (every write mutation): offline the request fails and the item
 * shows the error. It settles only after the plans and the decisions it made stale are read again, so the item is gone when it does.
 */
export function useReviewAction(program: DecideArgs['program']) {
  const { user } = useAuth()
  const weightUnit = useSettingsStore((s) => s.weightUnit)
  return useMutation({
    networkMode: 'always',
    mutationFn: (vars: ReviewActionVars) => {
      if (!user) throw new Error('You are signed out.')
      return decideReviewItem({ ...vars, userId: user.id, program, weightUnit })
    },
  })
}
