import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import type { Exercise, MuscleGroup } from '../../types'
import { useExercises, useCreateExercise } from '../library/useExercises'

// Coach Personalization — swap exercise for this session only (SPEC v1.1
// "Part C"). Lives one level up from SetRow's per-set `▼ MORE` drawer: this
// is an exercise-level action, and ExerciseHeader.tsx (name + muscle group +
// the existing History icon) is the one place on the workout screen that
// already represents "this whole exercise", not one set of it — so the
// trigger lives there (see ExerciseHeader.tsx), and this sheet does the
// actual picking.
//
// Deliberately session-only, not a template change: GymSession.tsx never
// writes anything to v2_program_exercises/v2_week_plan_sets for the chosen
// replacement — it renders it as an extra, unplanned exercise (the same
// "extra set" concept ADD SET already uses, one level up: a whole extra
// exercise card instead of one extra set). See GymSession.tsx's own
// comments for how that card gets composed and how it survives a refresh.
//
// Two-step flow in one sheet — pick (or create new), then confirm — because
// unlike ExercisePicker.tsx's instant-add (adding a program exercise is
// freely reversible, a one-row delete), confirming a swap also skips the
// original exercise's remaining sets for today (ExerciseCard.tsx's own
// handleSkipExercise, reused unchanged) — a real, if easily-undone, side
// effect worth a plain confirmation step before it fires.

interface SwapExerciseSheetProps {
  currentExerciseId: string
  currentExerciseName: string
  muscleGroup: MuscleGroup
  remainingSetCount: number
  onConfirm: (exercise: Exercise) => void
  onClose: () => void
}

export default function SwapExerciseSheet({
  currentExerciseId,
  currentExerciseName,
  muscleGroup,
  remainingSetCount,
  onConfirm,
  onClose,
}: SwapExerciseSheetProps) {
  const { data: allExercises = [] } = useExercises(false)
  const createExercise = useCreateExercise()

  const [pending, setPending] = useState<Exercise | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')

  // Same muscle_group only (SPEC v1.1 — the coarse field every exercise has,
  // not muscle_subgroup, which not all exercises are tagged with yet),
  // excluding the exercise currently being swapped and any archived rows.
  const candidates = allExercises
    .filter((ex) => ex.id !== currentExerciseId && ex.muscleGroup === muscleGroup)
    .sort((a, b) => a.name.localeCompare(b.name))

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    const created = await createExercise.mutateAsync({ name: trimmed, muscleGroup })
    setShowCreateForm(false)
    setNewName('')
    setPending(created)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full rounded-t-2xl px-4 pt-4 pb-10 flex flex-col"
        style={{ backgroundColor: 'var(--base)', maxHeight: '80dvh' }}
      >
        <div
          className="mx-auto mb-4 rounded-full shrink-0"
          style={{ width: 36, height: 4, backgroundColor: 'var(--border-strong)' }}
        />

        <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
          <p
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
          >
            {pending ? 'CONFIRM SWAP' : 'SWAP EXERCISE'}
          </p>
          <button
            onClick={onClose}
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: 'var(--surface-overlay)',
              color: 'var(--text-secondary)',
            }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {pending ? (
          <div className="overflow-y-auto">
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Swap <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{currentExerciseName}</span> for{' '}
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{pending.name}</span> — for today's
              session only. Next week's plan is unaffected.
            </p>
            {remainingSetCount > 0 && (
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {remainingSetCount} remaining {remainingSetCount === 1 ? 'set' : 'sets'} of {currentExerciseName} will
                be marked SKIPPED for today.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setPending(null)}
                className="flex-1 py-3 rounded-xl text-xs font-bold tracking-widest"
                style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                BACK
              </button>
              <button
                onClick={() => onConfirm(pending)}
                className="flex-1 py-3 rounded-xl text-xs font-bold tracking-widest"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)' }}
              >
                CONFIRM SWAP
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            {showCreateForm ? (
              <form onSubmit={handleCreate} className="mb-4">
                <p
                  className="text-xs font-bold tracking-widest mb-2"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  NEW {muscleGroup.toUpperCase()} EXERCISE
                </p>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Exercise name"
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-3"
                  style={{
                    backgroundColor: 'var(--surface-raised)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-primary)',
                  }}
                />
                {createExercise.isError && (
                  <p className="text-xs mb-3" style={{ color: 'var(--error)' }}>
                    {(createExercise.error as Error).message}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                    style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    disabled={createExercise.isPending || !newName.trim()}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                    style={{
                      backgroundColor: 'var(--accent)',
                      color: 'var(--base)',
                      fontFamily: 'var(--font-mono)',
                      opacity: createExercise.isPending || !newName.trim() ? 0.5 : 1,
                    }}
                  >
                    {createExercise.isPending ? '...' : 'CREATE'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowCreateForm(true)}
                className="w-full flex items-center justify-center gap-2 rounded-lg text-xs font-bold tracking-widest mb-3"
                style={{
                  minHeight: 44,
                  border: '1px dashed var(--border)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <Plus size={12} />
                CREATE NEW {muscleGroup.toUpperCase()} EXERCISE
              </button>
            )}

            {candidates.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>
                No other {muscleGroup} exercises yet — create one above.
              </p>
            ) : (
              <div className="space-y-2">
                {candidates.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => setPending(ex)}
                    className="w-full text-left px-3 py-3 rounded-xl"
                    style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
                  >
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                      {ex.name}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
