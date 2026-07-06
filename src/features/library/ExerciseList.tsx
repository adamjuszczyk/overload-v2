import { Archive, ArchiveRestore, Pencil } from 'lucide-react'
import type { Exercise, MuscleGroup } from '../../types'
import { useSetExerciseArchived } from './useExercises'

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'CHEST',
  back: 'BACK',
  shoulders: 'SHOULDERS',
  biceps: 'BICEPS',
  triceps: 'TRICEPS',
  forearms: 'FOREARMS',
  quads: 'QUADS',
  hamstrings: 'HAMSTRINGS',
  glutes: 'GLUTES',
  calves: 'CALVES',
  core: 'CORE',
  other: 'OTHER',
}

interface Props {
  exercises: Exercise[]
  onEdit: (exercise: Exercise) => void
}

export default function ExerciseList({ exercises, onEdit }: Props) {
  const setArchived = useSetExerciseArchived()

  if (exercises.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '2px',
            color: 'var(--text-dim)',
          }}
        >
          NO EXERCISES
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {exercises.map((ex) => (
        <div
          key={ex.id}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            opacity: ex.isArchived ? 0.5 : 1,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 16,
                color: 'var(--text-primary)',
                marginBottom: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {ex.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '1.5px',
                  color: 'var(--text-muted)',
                }}
              >
                {MUSCLE_LABELS[ex.muscleGroup]}
              </span>
              {ex.isArchived && (
                <>
                  <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>·</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '1.5px',
                      color: 'var(--text-dim)',
                    }}
                  >
                    ARCHIVED
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            onClick={() => onEdit(ex)}
            title="Edit"
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: 8,
              flexShrink: 0,
            }}
          >
            <Pencil size={15} />
          </button>

          <button
            onClick={() => setArchived.mutate({ id: ex.id, archived: !ex.isArchived })}
            title={ex.isArchived ? 'Unarchive' : 'Archive'}
            disabled={setArchived.isPending}
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: setArchived.isPending ? 'not-allowed' : 'pointer',
              borderRadius: 8,
              flexShrink: 0,
            }}
          >
            {ex.isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </button>
        </div>
      ))}
    </div>
  )
}
