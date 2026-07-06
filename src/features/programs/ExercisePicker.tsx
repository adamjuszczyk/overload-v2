import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import type { MuscleGroup } from '../../types'
import { useExercises } from '../library/useExercises'
import { useAddProgramExercise, useProgramExercises } from './usePrograms'

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]

interface Props {
  workoutDayId: string
  existingExerciseIds: string[]
  onClose: () => void
}

export default function ExercisePicker({ workoutDayId, existingExerciseIds, onClose }: Props) {
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | 'all'>('all')

  const { data: allExercises = [] } = useExercises(false)
  const { data: currentExercises = [] } = useProgramExercises(workoutDayId)
  const add = useAddProgramExercise(workoutDayId)

  // Combines snapshot IDs from prop with live query so additions mid-session hide immediately
  const addedIds = new Set([
    ...existingExerciseIds,
    ...currentExercises.map((e) => e.exerciseId),
  ])

  const available = allExercises.filter((ex) => !addedIds.has(ex.id))
  const filtered =
    muscleFilter === 'all'
      ? available
      : available.filter((ex) => ex.muscleGroup === muscleFilter)

  async function handleAdd(exerciseId: string) {
    await add.mutateAsync({ exerciseId, position: currentExercises.length })
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', border: '1px solid var(--border)', borderBottom: 'none', height: '82dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, letterSpacing: '1px', color: 'var(--text-primary)' }}>
              ADD EXERCISE
            </span>
            <button
              onClick={onClose}
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Muscle group filter chips */}
        <div className="hide-scrollbar" style={{ overflowX: 'auto', flexShrink: 0, padding: '0 0 12px' }}>
          <div style={{ display: 'flex', gap: 6, paddingLeft: 20, paddingRight: 20 }}>
            <FilterChip label="ALL" active={muscleFilter === 'all'} onClick={() => setMuscleFilter('all')} />
            {MUSCLE_GROUPS.map((mg) => (
              <FilterChip
                key={mg}
                label={mg.toUpperCase()}
                active={muscleFilter === mg}
                onClick={() => setMuscleFilter(muscleFilter === mg ? 'all' : mg)}
              />
            ))}
          </div>
        </div>

        {/* Exercise list */}
        <div
          className="hide-scrollbar"
          style={{ flex: 1, overflowY: 'auto', paddingLeft: 20, paddingRight: 20, paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
        >
          {filtered.length === 0 && (
            <p style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              {available.length === 0 ? 'ALL EXERCISES ADDED' : 'NONE IN THIS GROUP'}
            </p>
          )}

          {filtered.map((ex) => (
            <button
              key={ex.id}
              onClick={() => handleAdd(ex.id)}
              disabled={add.isPending}
              style={{ width: '100%', padding: '14px 0', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: add.isPending ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: add.isPending ? 0.5 : 1 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ex.name}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 3 }}>
                  {ex.muscleGroup.toUpperCase()}
                </div>
              </div>
              <Plus size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28,
        padding: '0 10px',
        flexShrink: 0,
        background: active ? 'var(--accent-muted)' : 'var(--surface)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '1px',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {label}
    </button>
  )
}
