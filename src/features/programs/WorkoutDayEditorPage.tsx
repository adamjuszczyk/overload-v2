import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'
import type { ProgramExercise } from '../../types'
import { queryClient } from '../../lib/queryClient'
import {
  useWorkoutDays,
  useUpdateWorkoutDayName,
  useProgramExercises,
  useUpdateProgramExerciseReps,
  useDeleteProgramExercise,
  useReorderProgramExercises,
} from './usePrograms'
import ExercisePicker from './ExercisePicker'

export default function WorkoutDayEditorPage() {
  const { programId, dayId } = useParams<{ programId: string; dayId: string }>()
  const navigate = useNavigate()

  const { data: workoutDays = [] } = useWorkoutDays(programId ?? '')
  const day = workoutDays.find((d) => d.id === dayId)
  const { data: exercises = [], isLoading } = useProgramExercises(dayId ?? '')

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [showPicker, setShowPicker] = useState(false)

  const updateName = useUpdateWorkoutDayName(programId ?? '')
  const updateReps = useUpdateProgramExerciseReps(dayId ?? '')
  const deleteExercise = useDeleteProgramExercise(dayId ?? '')
  const reorder = useReorderProgramExercises(dayId ?? '')

  function handleRepsStepper(pe: ProgramExercise, delta: number) {
    let newVal: number | null
    if (pe.targetReps === null) {
      newVal = delta > 0 ? 8 : null
    } else {
      newVal = pe.targetReps + delta
      if (newVal < 1) newVal = null
    }

    // Optimistic update
    queryClient.setQueryData(
      ['v2_programExercises', dayId],
      (old: ProgramExercise[] | undefined) =>
        old?.map((e) => (e.id === pe.id ? { ...e, targetReps: newVal } : e)),
    )

    updateReps.mutate({ id: pe.id, targetReps: newVal })
  }

  function moveExercise(index: number, direction: 'up' | 'down') {
    const swapIdx = direction === 'up' ? index - 1 : index + 1
    if (swapIdx < 0 || swapIdx >= exercises.length) return
    const next = [...exercises]
    ;[next[index], next[swapIdx]] = [next[swapIdx], next[index]]
    queryClient.setQueryData(
      ['v2_programExercises', dayId],
      next.map((ex, i) => ({ ...ex, position: i })),
    )
    reorder.mutate(next.map((ex, i) => ({ id: ex.id, position: i })))
  }

  const dayName = day?.name ?? '…'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => navigate(`/program/${programId}`)}
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 9, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
        >
          <ArrowLeft size={16} />
        </button>

        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={async () => {
              const trimmed = nameValue.trim()
              if (trimmed && trimmed !== dayName) {
                await updateName.mutateAsync({ id: dayId!, name: trimmed })
              }
              setEditingName(false)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', padding: '4px 0', outline: 'none' }}
          />
        ) : (
          <button
            onClick={() => { setNameValue(dayName); setEditingName(true) }}
            style={{ flex: 1, background: 'transparent', border: 'none', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {dayName}
          </button>
        )}
      </div>

      {/* Exercise list */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', minHeight: 0 }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
            <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
          </div>
        )}

        {!isLoading && exercises.length === 0 && (
          <p style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
            NO EXERCISES YET
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {exercises.map((pe, index) => (
            <ExerciseRow
              key={pe.id}
              pe={pe}
              index={index}
              total={exercises.length}
              onMoveUp={() => moveExercise(index, 'up')}
              onMoveDown={() => moveExercise(index, 'down')}
              onDelete={() => deleteExercise.mutate(pe.id)}
              onStepper={(delta) => handleRepsStepper(pe, delta)}
            />
          ))}
        </div>

        <button
          onClick={() => setShowPicker(true)}
          style={{ width: '100%', height: 52, background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 12, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13, letterSpacing: '1.5px' }}
        >
          <Plus size={16} style={{ color: 'var(--accent)' }} />
          ADD EXERCISE FROM LIBRARY
        </button>
      </div>

      {showPicker && (
        <ExercisePicker
          workoutDayId={dayId ?? ''}
          existingExerciseIds={exercises.map((e) => e.exerciseId)}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

// ─── Exercise Row ──────────────────────────────────────────────────────────────

interface ExerciseRowProps {
  pe: ProgramExercise
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onStepper: (delta: number) => void
}

function ExerciseRow({ pe, index, total, onMoveUp, onMoveDown, onDelete, onStepper }: ExerciseRowProps) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Name row */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, color: 'var(--text-dim)', flexShrink: 0, minWidth: 24 }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pe.exercise?.name ?? '—'}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 2 }}>
            {pe.exercise?.muscleGroup.toUpperCase() ?? ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          <IconBtn onClick={onMoveUp} disabled={index === 0}><ChevronUp size={14} /></IconBtn>
          <IconBtn onClick={onMoveDown} disabled={index === total - 1}><ChevronDown size={14} /></IconBtn>
          <IconBtn onClick={onDelete}><Trash2 size={13} /></IconBtn>
        </div>
      </div>

      {/* Suggested reps row */}
      <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flexShrink: 0 }}>
          SUGGESTED REPS
        </span>
        <div style={{ display: 'flex', alignItems: 'center', height: 34, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8 }}>
          <button
            onClick={() => onStepper(-1)}
            style={{ width: 28, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1, flexShrink: 0 }}
          >
            −
          </button>
          <span style={{ width: 36, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: pe.targetReps === null ? 'var(--text-dim)' : 'var(--text-primary)', flexShrink: 0 }}>
            {pe.targetReps === null ? '—' : pe.targetReps}
          </span>
          <button
            onClick={() => onStepper(1)}
            style={{ width: 28, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1, flexShrink: 0 }}
          >
            +
          </button>
        </div>
        {pe.targetReps !== null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)' }}>
            SUGGESTION ONLY
          </span>
        )}
      </div>
    </div>
  )
}

function IconBtn({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', borderRadius: 6, flexShrink: 0 }}
    >
      {children}
    </button>
  )
}
