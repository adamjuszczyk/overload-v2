export * from '@app/features/planner/usePlanner'
export function useProgramSets(_ids: readonly string[]) { return { data: [] } }
const noop = () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false })
export const useAssignWorkoutWeekday = noop
