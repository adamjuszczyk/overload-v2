import { vi } from 'vitest'

// Plan's STRUCTURE view (chunk 30, StructureFields.tsx) calls these hooks: the
// run-wide fields' mutations, the superset blocks' rests, the set's program sets and
// the warmup routine. A test file that opens the view for some other reason —
// swapping an exercise, adding a stage, a past week's read-only controls — mocks
// the page's data hooks, as every PlanPage test does, and spreads these in: no
// program sets, no blocks, an empty routine, and mutations that do nothing. Nothing
// in this file asserts anything. The file that tests the run-wide fields themselves
// (PlanPage.structureFields.test.tsx) defines its own, so it can see every call.
//
//   vi.mock('../programs/usePrograms', async () => ({
//     ...(await import('./structureHooks.testutil')).quietProgramsHooks,
//     usePrograms: () => ({ ... }),
//   }))
//   vi.mock('../planner/usePlanner', async (importOriginal) => ({
//     ...(await importOriginal<typeof import('../planner/usePlanner')>()),
//     ...(await import('./structureHooks.testutil')).quietPlannerHooks,
//   }))
const idleMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })

export const quietProgramsHooks = {
  useUpdateProgramExerciseRest: idleMutation,
  useUpdateProgramExerciseTempo: idleMutation,
  useUpdateProgramExerciseWeightUnit: idleMutation,
  useToggleSupersetLink: idleMutation,
  useSupersetBlockRests: () => ({ data: [] }),
  useUpdateSupersetBlockRest: idleMutation,
  useWarmupRoutineItems: () => ({ data: [], isLoading: false }),
  useAddWarmupItem: idleMutation,
  useUpdateWarmupItemBody: idleMutation,
  useRemoveWarmupItem: idleMutation,
  useReorderWarmupItems: idleMutation,
}

export const quietPlannerHooks = {
  useProgramSets: () => ({ data: [] }),
  useUpdateProgramSetRest: idleMutation,
  useUpdateProgramSetStageRest: idleMutation,
}
