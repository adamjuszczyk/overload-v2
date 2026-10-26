// A test stand-in for what GymSession hands one ExerciseCard (chunk 58a): the session's rows through `useWorkoutRows` over one card, the
// logs the test says the session holds, and spies for what the card writes. Re-render with `setLogs` to play the server's answer.
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import ExerciseCard from './ExerciseCard'
import { useWorkoutRows } from './useWorkoutRows'
import type { AddedSet } from './workoutRules'
import { groupSetLogs } from './setGroupLogic'
import type { ReferenceSession } from './sessionService'
import type { ProgramExercise, ProgramSet, SetLog, WeekPlanSet } from '../../types'
import { spyWriters } from './setWriters.testutil'

export const exerciseOf = (over: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'u1', exerciseId: 'ex-1', position: 0, weightUnit: null,
  exercise: {
    id: 'ex-1', userId: 'u1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
  },
  ...over,
})

export const plannedSet = (n: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id: `set-${n}`, weekPlanId: 'wp-1', userId: 'u1', programExerciseId: 'pe-1', setNumber: n, targetRir: 2, isDropset: false,
  parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...over,
})

export const plannedDrop = (head: number, index: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet =>
  plannedSet(head, { id: `set-${head}-drop-${index}`, isDropset: true, parentWeekPlanSetId: `set-${head}`, stageIndex: index, targetRir: 0, ...over })

export const logOf = (over: Partial<SetLog> & { id: string }): SetLog => ({
  userId: 'u1', sessionId: 'session-1', exerciseId: 'ex-1', weekPlanSetId: null, setNumber: 1, weight: 60, reps: 8, rir: null, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2026-01-05T10:00:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})

/** A planned head's log, as the screen writes it. */
export const headLogOf = (n: number, over: Partial<SetLog> = {}): SetLog => logOf({ id: `log-${n}`, weekPlanSetId: `set-${n}`, setNumber: n, ...over })

/** A reference session as the exercise's panel gets it (grouped, in set order): what the rows' LAST line reads. */
export const referenceSessionOf = (sessionId: string, date: string, logs: SetLog[], over: Partial<ReferenceSession> = {}): ReferenceSession => ({
  sessionId, date, completedAt: `${date}T11:00:00Z`, mesocycleId: 'meso-1',
  logs: groupSetLogs([...logs].sort((a, b) => a.setNumber - b.setNumber)),
  ...over,
})

type CardProps = Partial<ComponentProps<typeof ExerciseCard>>

interface HarnessProps {
  plannedSets: WeekPlanSet[]
  logs: SetLog[]
  programSets?: ProgramSet[]
  props?: CardProps
  /** The card's list of the sets added in the session as it stands when the screen mounts (chunk 59's tests: sets of a type the screen can't make yet). */
  initialAdded?: readonly AddedSet[]
}

function Harness({ plannedSets, logs, programSets = [], props = {}, initialAdded }: HarnessProps) {
  const programExercise = props.programExercise ?? exerciseOf()
  const workout = useWorkoutRows({
    cards: [{ key: programExercise.id, programExercise, plannedSets }],
    blocks: [],
    logs,
    ...(initialAdded === undefined ? {} : { initialAdded: { [programExercise.id]: initialAdded } }),
  })
  return (
    <MemoryRouter>
      <ExerciseCard
        cardKey={programExercise.id}
        programExercise={programExercise}
        plannedSets={plannedSets}
        programSets={programSets}
        workout={workout}
        logs={logs}
        referenceSessions={[]}
        referenceLoading={false}
        referenceMesocycleId={null}
        referenceIsError={false}
        referenceIsFromCache={false}
        onRetryReference={() => {}}
        today="2026-01-05"
        onLog={() => Promise.resolve({} as SetLog)}
        onUpdateSet={() => {}}
        onDeleteSet={async () => {}}
        writers={spyWriters()}
        onSwap={async () => {}}
        {...props}
      />
    </MemoryRouter>
  )
}

export function renderCard(input: { plannedSets: WeekPlanSet[]; logs?: SetLog[]; programSets?: ProgramSet[]; props?: CardProps; initialAdded?: readonly AddedSet[] }) {
  const base = { plannedSets: input.plannedSets, programSets: input.programSets, props: input.props, initialAdded: input.initialAdded }
  const view = render(<Harness {...base} logs={input.logs ?? []} />)
  return { ...view, setLogs: (logs: SetLog[]) => view.rerender(<Harness {...base} logs={logs} />) }
}

/** The number cell of every row of a card, in the order they are drawn. */
export const rowLabels = (container: Element): Array<string | null | undefined> =>
  Array.from(container.querySelectorAll('[data-row-key]')).map((el) => el.querySelector('span')?.textContent)
/** What state each row of a card is in: current, upcoming, logged, locked, skipped, unlogged (a warmup). */
export const rowStates = (container: Element): Array<string | undefined> =>
  Array.from(container.querySelectorAll('[data-row-key]')).map((el) => (el.hasAttribute('data-current-set') ? 'current' : (el as HTMLElement).dataset.rowState))
