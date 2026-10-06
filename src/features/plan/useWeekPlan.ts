import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { WeekPlan } from '../../types'
import {
  fetchWeekPlans,
  fetchAllWeekPlansForMeso,
  fetchWeekPlanById,
  createWeekPlan,
  setDeload,
  addSet,
  addStage,
  updateSet,
  removeSet,
  copyFromPreviousWeek,
  copyWorkoutFromPreviousWeek,
  planWeek,
  swapWeekExercise,
  addWeekExercise,
  removeWeekExercise,
  reorderWeekExercises,
} from './weekPlanService'

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
// v2_plan_week. Callers: PlanPage.tsx, on every week it shows ("the first
// time it's opened in Plan"); TodayPage.tsx/MissedSessionPrompt.tsx, right
// before starting a session ("or when it starts, whichever comes first" —
// see planWeekThenFindId below, which both use). Safe to call on an
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

// Shared by TodayPage.tsx (starting/redoing today's session) and
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
export async function planWeekThenFindId(
  mesoId: string,
  weekNumber: number,
  workoutDayId: string,
  fallback: string | null,
  planWeekMutation: { mutateAsync: (vars: { mesoId: string; weekNumber: number }) => Promise<number> },
  fetchPlans: (mesoId: string, weekNumber: number) => Promise<{ id: string; workoutDayId: string }[]> = fetchWeekPlans,
): Promise<string | null> {
  try {
    await planWeekMutation.mutateAsync({ mesoId, weekNumber })
    const plans = await fetchPlans(mesoId, weekNumber)
    return plans.find((p) => p.workoutDayId === workoutDayId)?.id ?? fallback
  } catch {
    return fallback
  }
}

export function useSetDeload(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: ({ weekPlanId, isDeload }: { weekPlanId: string; isDeload: boolean }) =>
      setDeload(weekPlanId, isDeload),
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

export function useAddSet(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: async ({
      workoutDayId,
      weekPlanId,
      programExerciseId,
      setNumber,
    }: {
      workoutDayId: string
      weekPlanId?: string
      programExerciseId: string
      setNumber: number
    }) => {
      let planId = weekPlanId
      if (!planId) {
        const plan = await createWeekPlan(user!.id, mesoId, workoutDayId, weekNumber)
        planId = plan.id
      }
      return addSet(user!.id, planId, programExerciseId, setNumber)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

export function useUpdateSet(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: string
      changes: { targetRir?: number | null }
    }) => updateSet(id, changes),
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
                }
              : s,
          ),
        })),
      )
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

// Phase 3.1's stage-authoring mutation — ADD STAGE on a specific existing
// set, passing its id directly as the new stage's parent (TASKS.md §4 item
// 10). See weekPlanService.ts's addStage() for why this retires the old
// DROP-toggle inference entirely rather than keeping it as a fallback.
export function useAddStage(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: ({
      weekPlanId,
      programExerciseId,
      parentId,
      setNumber,
      stageIndex,
    }: {
      weekPlanId: string
      programExerciseId: string
      parentId: string
      setNumber: number
      stageIndex: number
    }) => addStage(user!.id, weekPlanId, programExerciseId, parentId, setNumber, stageIndex),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

export function useRemoveSet(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

export function useCopyFromPreviousWeek(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: () => copyFromPreviousWeek(user!.id, mesoId, weekNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      // Scheduler's missed-session detection reads useAllWeekPlans (same
      // reasoning as useSetDeload/useAddSet/useAddStage above) — a
      // whole-week copy is exactly the kind of bulk plan mutation that
      // needs this too. Found missing by Phase 3.7's adversarial review:
      // its new sibling, useCopyWorkoutFromPreviousWeek, already had it.
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

// Phase 3.7's scoped copy (TASKS.md §4 item 31 / SPEC §5) — same shape as
// useCopyFromPreviousWeek but filtered to one workout day. weekPlanId is
// passed through when a (possibly empty) plan row already exists for this
// workout/week, so copyWorkoutFromPreviousWeek reuses it instead of creating
// a duplicate — same optional-id pattern useAddSet already uses.
export function useCopyWorkoutFromPreviousWeek(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: ({
      workoutDayId,
      weekPlanId,
    }: {
      workoutDayId: string
      weekPlanId?: string
    }) => copyWorkoutFromPreviousWeek(user!.id, mesoId, weekNumber, workoutDayId, weekPlanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
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

// ─── Week actions — swap, reorder, add, remove (chunk 9) ───────────────────
// Each invalidates this week's own plans (exercises AND sets both live on
// the same WeekPlan query) and the meso-wide history (the copy-forward
// buttons' own source search reads it, same as every other plan-mutating
// hook above).

export function useSwapWeekExercise(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: (params: { weekPlanId: string; programExerciseId: string; replacementExerciseId: string; onlyThisWeek: boolean }) =>
      swapWeekExercise({ userId: user!.id, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

export function useAddWeekExercise(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: (params: { weekPlanId: string; workoutDayId: string; exerciseId: string; position: number }) =>
      addWeekExercise({ userId: user!.id, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

export function useRemoveWeekExercise(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: ({ weekPlanId, programExerciseId }: { weekPlanId: string; programExerciseId: string }) =>
      removeWeekExercise(weekPlanId, programExerciseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}

export function useReorderWeekExercises(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: ({
      weekPlanId,
      moves,
      onlyThisWeek,
    }: {
      weekPlanId: string
      moves: { programExerciseId: string; oldPosition: number; newPosition: number }[]
      onlyThisWeek: boolean
    }) => reorderWeekExercises(weekPlanId, moves, onlyThisWeek),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk })
      queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] })
    },
  })
}
