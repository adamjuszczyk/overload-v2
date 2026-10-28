import { vi } from 'vitest'

// The planner hooks Plan's week view calls (chunk 54a; they were `structureHooks.testutil.ts`'s `quietPlannerHooks` while Plan had a STRUCTURE
// view): the run copy's program sets, which the week-diff gate reads for a week compared with the run's copy and the set type picker reads
// for a week-dependent set's own rest, and the two mutations that write a set's rest and a staged set's rest between stages. A test file
// that doesn't test those mocks the page's data hooks, as every PlanPage test does, and spreads this in: no program sets, and mutations that
// do nothing. Nothing in this file asserts anything. A file that tests the rest rows themselves (PlanPage.setTypeSheet.test.tsx) defines its
// own, so it can see every call.
//
//   vi.mock('../planner/usePlanner', async (importOriginal) => ({
//     ...(await importOriginal<typeof import('../planner/usePlanner')>()),
//     ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
//   }))
const idleMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })

export const quietPlannerHooks = {
  useProgramSets: () => ({ data: [] }),
  useUpdateProgramSetRest: idleMutation,
  useUpdateProgramSetStageRest: idleMutation,
}
