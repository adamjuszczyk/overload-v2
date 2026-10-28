import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { WeekPlan } from '../../types'
import type { DeloadRules } from '../../lib/deloadRules'
import {
  fetchWeekPlans,
  fetchAllWeekPlansForMeso,
  fetchWeekPlanById,
  markSessionDeload,
  unmarkSessionDeload,
  markWeekDeload,
  unmarkWeekDeload,
  addSet,
  applySetTypeOps,
  updateSet,
  removeSet,
  planWeek,
} from './weekPlanService'
import type { SetChanges, SetTypeOp } from './planSetRows'
import type { NewSetDefaults } from './weekPlanning'

function key(mesoId: string, weekNumber: number) {
  return ['v2_weekPlans', mesoId, weekNumber] as const
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useWeekPlans(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  return useQuery({
    queryKey: key(mesoId, weekNumber),
    queryFn: () => fetchWeekPlans(mesoId, weekNumber),
    enabled: !!user && !!mesoId,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

// Chunk 8 (TASKS.md "Weeks plan themselves, from the right source") — calls
// v2_plan_week. Callers: PlanPage.tsx, for the CURRENT week (cycle) only and
// only when it has no rows (chunk 52; before it Plan planned every week it
// showed, SPEC [1.2] "Opening it doesn't plan it"); TodayPage.tsx/
// MissedSessionPrompt.tsx, right before starting a session ("or when it
// starts, whichever comes first" — see planWeekThenFindId below, which both
// use); usePlanForward.ts, for the one week PLAN FORWARD names. Safe to call on an
// already-planned week — it is atomic and idempotent, so this hook carries
// no guard of its own against calling it more than once; invalidates the
// two query keys a successful plan can change (this exact week's plans,
// and the meso-wide list the scheduler/missed-session detection and the
// Plan screen's copy-button history both read), using the mutation's own
// variables rather than a closed-over mesoId/weekNumber, so one shared
// hook instance can be reused for different weeks.
//
// networkMode: 'always' (CONTEXT.md: "all write mutations use
// networkMode: 'always'"; useSession.ts's useDeleteSetLog states the same
// reasoning) — under the default 'online', TanStack Query PAUSES an
// offline mutation indefinitely rather than running it, so mutateAsync
// never settles. Found in review: that left TodayPage/MissedSessionPrompt's
// "plan then start" hanging forever on "STARTING…" offline, when TASKS.md
// explicitly says a week started offline just starts without a plan, as
// today. 'always' attempts the call regardless of connectivity, so an
// offline attempt fails fast with a normal network error instead — which
// planWeekThenFindId below catches and falls back from, never blocking or
// failing the start itself.
export function usePlanWeek() {
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ mesoId, weekNumber }: { mesoId: string; weekNumber: number }) => planWeek(mesoId, weekNumber),
    onSuccess: (_count, { mesoId, weekNumber }) => {
      queryClient.invalidateQueries({ queryKey: key(mesoId, weekNumber) })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

// Shared by TodayPage.tsx (starting today's session) and
// MissedSessionPrompt.tsx (DO IT NOW on a missed session) — "or when it
// starts, whichever comes first" (TASKS.md), made best-effort: planning is
// never allowed to block or fail the start itself. If the plan call or the
// re-read rejects (offline, a real error, anything), this falls back to
// whatever weekPlanId the caller already had — createSession then runs
// exactly as it does today, unplanned, per TASKS.md's own "a week started
// offline — that session starts without a plan, as today". `fetchPlans` is
// the real fetchWeekPlans by default; injectable so a test can supply a
// fake without a network round trip, the same seam weekPlanService.ts's
// insertPlanSet/upsertPlanExercises already use. `planWeek` is typed to the
// one method actually used (mutateAsync), so a test fake needs nothing
// else — but a real usePlanWeek() result satisfies it too.
// Chunk 25 — `sequencePosition` (optional, defaults to null) disambiguates
// a repeated workout's two slots in one cycle (R16): without it, `.find`
// would always return whichever occurrence comes first in `plans`,
// regardless of which slot the caller actually means. Every pre-chunk-25
// caller omits it and keeps matching exactly as before (every weekday
// row's own sequencePosition is null/undefined — `(p.sequencePosition ??
// null) === null` is true for all of them, same as a bare workoutDayId
// match when there's only ever one row per workout).
export async function planWeekThenFindId(
  mesoId: string,
  weekNumber: number,
  workoutDayId: string,
  fallback: string | null,
  planWeekMutation: { mutateAsync: (vars: { mesoId: string; weekNumber: number }) => Promise<number> },
  fetchPlans: (mesoId: string, weekNumber: number) => Promise<{ id: string; workoutDayId: string; sequencePosition?: number | null }[]> = fetchWeekPlans,
  sequencePosition: number | null = null,
): Promise<string | null> {
  try {
    await planWeekMutation.mutateAsync({ mesoId, weekNumber })
    const plans = await fetchPlans(mesoId, weekNumber)
    const match = plans.find(
      (p) => p.workoutDayId === workoutDayId && (p.sequencePosition ?? null) === sequencePosition,
    )
    return match?.id ?? fallback
  } catch {
    return fallback
  }
}

// Chunk 22 — extends chunk 21's flag-only toggle: `rules` is the EFFECTIVE
// rules already resolved by the caller (PlanPage.tsx — the Settings rules,
// else none: programs have no override since chunk 48; see deloadRules.ts's
// resolveEffectiveDeloadRules), handed straight to the executor
// (weekPlanService.ts's markSessionDeload/unmarkSessionDeload), which
// alone decides flag-only vs. calculated/restored vs. the started guard.
// networkMode: 'always' (chunk 22 — same offline-doesn't-hang reasoning as
// every other write mutation touched this chunk; this hook predates chunk
// 21's own 'always' siblings and is being substantially rewritten here
// regardless, so it now carries the same posture rather than being the one
// write path still left on the default).
//
// Returns the executor's own outcome ('flagOnly' | 'calculated' |
// 'restored' | 'alreadyStarted') so the caller can show reviewer's note 5's
// one-line notice — read via the mutate() call's own onSuccess, not this
// hook's return value, so a caller that doesn't care about it needn't look.
export function useSetDeload(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    networkMode: 'always',
    mutationFn: ({
      weekPlanId,
      isDeload,
      rules,
    }: {
      weekPlanId: string
      isDeload: boolean
      rules: DeloadRules | null
    }) =>
      isDeload ? markSessionDeload(user!.id, weekPlanId, rules) : unmarkSessionDeload(user!.id, weekPlanId),
    onMutate: async ({ weekPlanId, isDeload }) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: WeekPlan[] | undefined) =>
        old?.map((wp) => (wp.id === weekPlanId ? { ...wp, isDeload } : wp)),
      )
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      // Scheduler's missed-session detection reads useAllWeekPlans — without
      // this it keeps deload/plan data stale until an unrelated refetch.
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

// Chunk 21 — "Mark this week as deload" / its counterpart "Unmark this
// week" (SPEC "Deload": "'Mark this week as deload' marks every session in
// that week"). Reviewer's note 1: networkMode 'always' (same offline-
// doesn't-hang reasoning as usePlanWeek/useUpdateSet above) and optimistic
// the same way useSetDeload above is — onMutate patches every row already
// in this week's own cache entry to the new value; a row this week doesn't
// have yet simply isn't in the optimistic patch, and onSettled's invalidate
// corrects whatever the optimistic patch couldn't.
//
// Chunk 52 (TASKS-1.2 "WEEK ⋯ marks the week through useSetWeekDeload
// without planning"; SPEC Weeks and copying [1.2]: "Opening it doesn't plan
// it"): this no longer plans the week first. WEEK ⋯ exists only on a week
// that is planned (Plan shows it for the current week, which it plans as it
// opens, and for weeks planned ahead), so the week is planned by definition
// and marking it never creates one. Until chunk 52 this called planWeek
// before marking, which planned any week it was asked about.
//
// Chunk 22 — `rules` (the same resolved effective rules useSetDeload above
// takes) is handed to markWeekDeload/unmarkWeekDeload, which run the exact
// per-session executor once per row of the week (reviewer's note 6: "the
// calculation and snapshot happen once for that row") — never a single
// bulk UPDATE once rules are on, since each row can resolve a DIFFERENT
// base occurrence. The mutationFn's own return value carries whether ANY
// row hit the started guard, for the same one-line notice useSetDeload's
// own caller shows.
export function useSetWeekDeload(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ isDeload, rules }: { isDeload: boolean; rules: DeloadRules | null }) =>
      isDeload ? markWeekDeload(user!.id, mesoId, weekNumber, rules) : unmarkWeekDeload(user!.id, mesoId, weekNumber),
    onMutate: async ({ isDeload }) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: WeekPlan[] | undefined) => old?.map((wp) => ({ ...wp, isDeload })))
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      // Same reasoning as useSetDeload's own onSettled above — the
      // scheduler's missed-session detection and Plan's own copy-history
      // check both read useAllWeekPlans.
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

// "+ ADD SET" (chunk 54a). The week plan row is given: a week is planned before it is shown (chunk 52), so nothing here makes one. `defaults`
// is what the new set holds (weekPlanning.ts's `addSetDefaults`: the previous set's rep target, no weight, no RIR) and `setNumber` the next
// head number (planSetRows.ts's `nextSetNumber`); both are the caller's, so the write is exactly what the screen showed it would add.
export function useAddSet(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    networkMode: 'always',
    mutationFn: ({
      weekPlanId,
      programExerciseId,
      setNumber,
      defaults,
    }: {
      weekPlanId: string
      programExerciseId: string
      setNumber: number
      defaults: NewSetDefaults
    }) => addSet(user!.id, weekPlanId, programExerciseId, setNumber, defaults),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

// Chunk 31 (SPEC Plan screen [P1.1]: "A week is compared with its source as it is
// now"). Plan reads a source week's content from the meso-wide list
// (useAllWeekPlans), and an edit of a set's numbers or the removal of a set changes
// what every LATER week is compared with, so the list is refreshed after it. Only
// when a later week is planned: those are the weeks this one is the source of (a week
// not planned yet is planned from the server's copy of this one, and planning it
// refreshes the list: usePlanWeek). The list is the whole meso, every set of every
// week, too heavy to refetch on every tap of an RIR stepper when nothing reads the
// change. A list that hasn't been read yet is invalidated anyway (nothing to refetch).
function refreshWeeksComparedWithThisOne(mesoId: string, weekNumber: number) {
  const all = queryClient.getQueryData<WeekPlan[]>(['v2_allWeekPlans', mesoId])
  if (all && !all.some((wp) => wp.weekNumber > weekNumber)) return
  queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
}

export function useUpdateSet(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    // Chunk 19 (reviewer's note: "Every write uses networkMode: 'always',
    // optimistic where the existing RIR stepper is") — this one mutation now
    // also carries the week's weight/rep-target/tags edits, so it needs the
    // same offline-doesn't-hang behaviour usePlanWeek's own comment explains
    // (default 'online' pauses an offline mutation indefinitely rather than
    // running it). Scope note: this also changes the EXISTING targetRir/
    // stageKind/isWarmup writes this same mutation already made — a widening
    // (they now attempt offline and fail fast instead of hanging forever),
    // never a narrowing, so no existing behaviour is removed.
    networkMode: 'always',
    mutationFn: ({ id, changes }: { id: string; changes: SetChanges }) => updateSet(id, changes),
    onMutate: async ({ id, changes }) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: WeekPlan[] | undefined) =>
        old?.map((wp) => ({
          ...wp,
          sets: wp.sets.map((s) =>
            s.id === id
              ? {
                  ...s,
                  ...('targetRir' in changes ? { targetRir: changes.targetRir } : {}),
                  ...('targetRirMax' in changes ? { targetRirMax: changes.targetRirMax } : {}),
                  ...('stageKind' in changes ? { stageKind: changes.stageKind } : {}),
                  ...('isWarmup' in changes ? { isWarmup: changes.isWarmup } : {}),
                  ...('targetWeight' in changes ? { targetWeight: changes.targetWeight } : {}),
                  ...('repMin' in changes ? { repMin: changes.repMin } : {}),
                  ...('repMax' in changes ? { repMax: changes.repMax } : {}),
                  ...('isAmrap' in changes ? { isAmrap: changes.isAmrap } : {}),
                  ...('tags' in changes ? { tags: changes.tags } : {}),
                }
              : s,
          ),
        })),
      )
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      refreshWeeksComparedWithThisOne(mesoId, weekNumber)
    },
  })
}

// One set type change from the set type picker (chunk 54a), which replaces ADD STAGE, the STAGE KIND chips and the warmup toggle:
// `ops` is planSetRows.ts's `planSetTypeChange`, applied in order by weekPlanService.ts's `applySetTypeOps` (stages off before a switch to
// Normal or Warmup, the head's kind before its stages are added). Nothing is patched into the cache first: the change is several rows, so
// the week is read again when it ends, a failed or part-done one included, and what the screen then shows is what the database holds.
export function useChangeSetType(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ ops }: { ops: SetTypeOp[] }) => applySetTypeOps(user!.id, ops),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      refreshWeeksComparedWithThisOne(mesoId, weekNumber)
    },
  })
}

export function useRemoveSet(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: string) => removeSet(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: WeekPlan[] | undefined) =>
        old?.map((wp) => ({ ...wp, sets: wp.sets.filter((s) => s.id !== id) })),
      )
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      refreshWeeksComparedWithThisOne(mesoId, weekNumber)
    },
  })
}

export function useAllWeekPlans(mesoId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_allWeekPlans', mesoId],
    queryFn: () => fetchAllWeekPlansForMeso(mesoId),
    enabled: !!user && !!mesoId,
  })
}

export function useWeekPlanById(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_weekPlan', id],
    queryFn: () => fetchWeekPlanById(id!),
    enabled: !!user && !!id,
  })
}
