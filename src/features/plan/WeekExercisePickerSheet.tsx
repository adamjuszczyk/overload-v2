// Chunk 9 (TASKS.md "Edit a week's exercises") — picks an exercise for a
// week's own ADD or SWAP action. Presentational only: it hands the picked
// Exercise back via onPick and performs no mutation itself, since add and
// swap need different writes (weekPlanService.ts's addWeekExercise /
// swapWeekExercise) — the same separation of "pick" from "act" SwapExerciseSheet.tsx
// (GymSession's own session-only swap) keeps, but built fresh here rather
// than reused: that component's confirm step has copy hardcoded to the
// session-swap case ("for today's session only... Next week's plan is
// unaffected"), which would misdescribe a week-level, possibly permanent
// change — and it is one of this build's explicitly frozen screens (D30).
// Same bottom-sheet shell, muscle-group filter chips and instant-tap list
// as programs/ExercisePicker.tsx (the planner's own picker), the existing
// pattern for "pick one exercise from a filtered list" in this app.
import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import type { Exercise, MuscleGroup } from '../../types'
import { useExercises } from '../library/useExercises'

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]

interface Props {
  title: string
  excludeExerciseIds: string[]
  onPick: (exercise: Exercise) => void
  onClose: () => void
}

export default function WeekExercisePickerSheet({ title, excludeExerciseIds, onPick, onClose }: Props) {
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | 'all'>('all')
  const { data: allExercises = [] } = useExercises(false)

  const excluded = new Set(excludeExerciseIds)
  const available = allExercises.filter((ex) => !excluded.has(ex.id))
  const filtered =
    muscleFilter === 'all' ? available : available.filter((ex) => ex.muscleGroup === muscleFilter)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', border: '1px solid var(--border)', borderBottom: 'none', height: '82dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, letterSpacing: '1px', color: 'var(--text-primary)' }}>
              {title}
            </span>
            <button
              onClick={onClose}
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

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

        <div
          className="hide-scrollbar"
          style={{ flex: 1, overflowY: 'auto', paddingLeft: 20, paddingRight: 20, paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
        >
          {filtered.length === 0 && (
            <p style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              {available.length === 0 ? 'NO OTHER EXERCISES' : 'NONE IN THIS GROUP'}
            </p>
          )}

          {filtered.map((ex) => (
            <button
              key={ex.id}
              onClick={() => onPick(ex)}
              style={{ width: '100%', padding: '14px 0', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ex.name}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 3 }}>
                  {ex.muscleGroup?.toUpperCase() ?? 'OTHER'}
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

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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
