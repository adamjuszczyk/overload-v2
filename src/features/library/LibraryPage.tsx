import { useState } from 'react'
import { Plus, Download } from 'lucide-react'
import type { Exercise, MuscleGroup } from '../../types'
import { useExercises, useImportDefaultExercises } from './useExercises'
import { useToastStore } from '../notifications/toastStore'
import ExerciseList from './ExerciseList'
import ExerciseForm from './ExerciseForm'

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]

type FormState = null | { mode: 'create' } | { mode: 'edit'; exercise: Exercise }

export default function LibraryPage() {
  const [filter, setFilter] = useState<MuscleGroup | 'all'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [formState, setFormState] = useState<FormState>(null)

  const { data: exercises = [], isLoading, error } = useExercises(showArchived)
  const importDefaults = useImportDefaultExercises()
  const showToast = useToastStore((s) => s.show)

  const filtered =
    filter === 'all' ? exercises : exercises.filter((ex) => ex.muscleGroup === filter)

  function handleImportDefaults() {
    importDefaults.mutate(undefined, {
      onSuccess: ({ added, skipped }) => {
        showToast(
          added === 0
            ? `All ${skipped} default exercises already in your library`
            : `Added ${added} default exercise${added === 1 ? '' : 's'} · ${skipped} already there`,
        )
      },
      onError: () => showToast('Could not import default exercises'),
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--base)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 20px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: '1px',
            color: 'var(--text-primary)',
          }}
        >
          LIBRARY
        </span>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {/* Import default exercises (SPEC §9 / post-launch fix,
              2026-08-10) — the seeded default list used to be reachable
              only automatically, once, on a brand-new account. This inserts
              whatever's missing by name and reports the result via toast,
              safe to tap on any account at any time. */}
          <button
            onClick={handleImportDefaults}
            disabled={importDefaults.isPending}
            aria-label="Import default exercises"
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface-overlay)',
              border: '1px solid var(--border-strong)',
              borderRadius: 11,
              cursor: importDefaults.isPending ? 'default' : 'pointer',
              color: 'var(--text-secondary)',
              opacity: importDefaults.isPending ? 0.6 : 1,
            }}
          >
            <Download size={18} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => setFormState({ mode: 'create' })}
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 11,
              cursor: 'pointer',
              color: 'var(--base)',
              flexShrink: 0,
            }}
          >
            <Plus size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Muscle group filter — horizontal scroll */}
      <div
        className="hide-scrollbar"
        style={{ overflowX: 'auto', flexShrink: 0, padding: '16px 0 12px' }}
      >
        <div style={{ display: 'flex', gap: 6, paddingLeft: 20, paddingRight: 20 }}>
          <FilterChip
            label="ALL"
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          {MUSCLE_GROUPS.map((mg) => (
            <FilterChip
              key={mg}
              label={mg.toUpperCase()}
              active={filter === mg}
              onClick={() => setFilter(filter === mg ? 'all' : mg)}
            />
          ))}
        </div>
      </div>

      {/* Exercise list */}
      <div
        className="hide-scrollbar"
        style={{ flex: 1, overflowY: 'auto', padding: '0 20px', minHeight: 0 }}
      >
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 48 }}>
            <div
              className="animate-spin"
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: '2px solid var(--border-strong)',
                borderTopColor: 'var(--accent)',
              }}
            />
          </div>
        )}

        {error && !isLoading && (
          <p
            style={{
              textAlign: 'center',
              paddingTop: 48,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '1.5px',
              color: 'var(--error)',
            }}
          >
            FAILED TO LOAD
          </p>
        )}

        {!isLoading && !error && (
          <ExerciseList
            exercises={filtered}
            onEdit={(ex) => setFormState({ mode: 'edit', exercise: ex })}
          />
        )}

        {!isLoading && !error && (
          <div style={{ padding: '20px 0 32px', textAlign: 'center' }}>
            <button
              onClick={() => setShowArchived((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '2px',
                color: 'var(--text-dim)',
                padding: '8px 12px',
              }}
            >
              {showArchived ? 'HIDE ARCHIVED' : 'SHOW ARCHIVED'}
            </button>
          </div>
        )}
      </div>

      {formState && (
        <ExerciseForm
          exercise={formState.mode === 'edit' ? formState.exercise : undefined}
          onClose={() => setFormState(null)}
        />
      )}
    </div>
  )
}

interface FilterChipProps {
  label: string
  active: boolean
  onClick: () => void
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 30,
        padding: '0 12px',
        flexShrink: 0,
        background: active ? 'var(--accent-muted)' : 'var(--surface)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '1.5px',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {label}
    </button>
  )
}
