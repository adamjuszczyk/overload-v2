// The workout's session hooks over the prototype's in-memory session (demo/workoutFixture.ts). Every other export is the real one.
export * from '@app/features/gym/useSession'
import { useWorkoutSession, referenceSessions } from '../../demo/workoutFixture'
import type { SetLog } from '@app/types'

let n = 0
const now = () => new Date().toISOString()
const setLogs = (f: (logs: SetLog[]) => SetLog[]) =>
  useWorkoutSession.setState((s) => ({ session: { ...s.session, setLogs: f(s.session.setLogs ?? []) } }))

export function useActiveSession(_id: string | null) {
  return { data: useWorkoutSession((s) => s.session) }
}
export function useSessionSwaps(_id: string | null) { return { data: [] } }
export function useRecordExerciseSwap(_id: string) { return { mutate: () => {}, mutateAsync: async () => {}, isPending: false } }
export function useExerciseReferenceSessions(..._args: unknown[]) {
  return { data: referenceSessions, isLoading: false, isError: false, isFromCache: false, retry: () => {} }
}
export function useLogSet(_sessionId: string) {
  const mutateAsync = async (p: any) => {
    const log = { userId: 'u1', sessionId: 'session-1', loggedAt: now(), setSeconds: null, formRating: null, addedPlace: null, isWarmup: false, ...p, id: p.id ?? `proto-${++n}` } as SetLog
    setLogs((logs) => [...logs, log])
    return log
  }
  return { mutateAsync, mutate: (p: any) => void mutateAsync(p), isPending: false }
}
export function useUpdateSetLog(_sessionId: string) {
  const mutateAsync = async ({ id, changes }: { id: string; changes: Partial<SetLog> }) => setLogs((logs) => logs.map((l) => (l.id === id ? { ...l, ...changes } : l)))
  return { mutateAsync, mutate: (v: any) => void mutateAsync(v), isPending: false }
}
export function useDeleteSetLog(_sessionId: string) {
  const mutateAsync = async ({ id }: { id: string }) => setLogs((logs) => logs.filter((l) => l.id !== id && l.parentSetId !== id))
  return { mutateAsync, mutate: (v: any) => void mutateAsync(v), isPending: false }
}
