import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, ChevronRight } from 'lucide-react'
import {
  usePrograms,
  useUpdateProgramName,
  useWorkoutDays,
  useCreateWorkoutDay,
  useDeleteWorkoutDay,
} from './usePrograms'
import WeeklyScheduleGrid from './WeeklyScheduleGrid'

export default function ProgramBuilderPage() {
  const { programId } = useParams<{ programId: string }>()
  const navigate = useNavigate()

  const { data: programs = [], isLoading: programsLoading } = usePrograms()
  const program = programs.find((p) => p.id === programId)
  const { data: workoutDays = [], isLoading: daysLoading } = useWorkoutDays(programId ?? '')

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [showAddDay, setShowAddDay] = useState(false)
  const [newDayName, setNewDayName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  const updateName = useUpdateProgramName()
  const createDay = useCreateWorkoutDay(programId ?? '')
  const deleteDay = useDeleteWorkoutDay(programId ?? '')

  useEffect(() => {
    if (editingName) nameRef.current?.focus()
  }, [editingName])

  if (programsLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="animate-spin" style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

  if (!program) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
          PROGRAM NOT FOUND
        </p>
        <button
          onClick={() => navigate('/program')}
          style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
        >
          ← Back to programs
        </button>
      </div>
    )
  }

  async function saveName() {
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== program!.name) {
      await updateName.mutateAsync({ id: program!.id, name: trimmed })
    }
    setEditingName(false)
  }

  async function handleCreateDay(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newDayName.trim()
    if (!trimmed) return
    await createDay.mutateAsync({ name: trimmed, position: workoutDays.length })
    setNewDayName('')
    setShowAddDay(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => navigate('/program')}
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 9, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
        >
          <ArrowLeft size={16} />
        </button>

        {editingName ? (
          <input
            ref={nameRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') nameRef.current?.blur() }}
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', padding: '4px 0', outline: 'none' }}
          />
        ) : (
          <button
            onClick={() => { setNameValue(program.name); setEditingName(true) }}
            style={{ flex: 1, background: 'transparent', border: 'none', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {program.name}
          </button>
        )}
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* Weekly schedule */}
        <div style={{ paddingTop: 20, paddingBottom: 4 }}>
          <p style={{ paddingLeft: 20, paddingRight: 20, marginBottom: 12, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}>
            WEEKLY SCHEDULE
          </p>
          <WeeklyScheduleGrid program={program} workoutDays={workoutDays} />
        </div>

        {/* Workout days */}
        <div style={{ padding: '24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}>
              WORKOUT DAYS
            </span>
            <button
              onClick={() => { setNewDayName(''); setShowAddDay(true) }}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <Plus size={14} />
            </button>
          </div>

          {daysLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
            </div>
          )}

          {!daysLoading && workoutDays.length === 0 && (
            <p style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              NO DAYS YET
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workoutDays.map((day) => {
              const assignedLabels = Object.entries(program.schedule)
                .filter(([, v]) => v === day.id)
                .map(([k]) => k.slice(0, 3).toUpperCase())

              return (
                <div key={day.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                  <button
                    onClick={() => navigate(`/program/${programId}/day/${day.id}`)}
                    style={{ width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: assignedLabels.length > 0 ? 4 : 0 }}>
                        {day.name}
                      </div>
                      {assignedLabels.length > 0 && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)' }}>
                          {assignedLabels.join(' · ')}
                        </span>
                      )}
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  </button>

                  <div style={{ height: 1, background: 'var(--border-subtle)' }} />

                  <button
                    onClick={() => deleteDay.mutate({ id: day.id, schedule: program.schedule })}
                    disabled={deleteDay.isPending}
                    style={{ width: '100%', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: deleteDay.isPending ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px' }}
                  >
                    <Trash2 size={11} />
                    DELETE DAY
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Add day sheet */}
      {showAddDay && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddDay(false) }}
        >
          <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', border: '1px solid var(--border)', borderBottom: 'none' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, letterSpacing: '1px', marginBottom: 20, color: 'var(--text-primary)' }}>
              ADD WORKOUT DAY
            </div>
            <form onSubmit={handleCreateDay}>
              <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 8 }}>
                DAY NAME
              </label>
              <input
                type="text"
                value={newDayName}
                onChange={(e) => setNewDayName(e.target.value)}
                placeholder="e.g. Push Day"
                autoFocus
                style={{ width: '100%', height: 52, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '0 16px', fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: 20 }}
              />
              <button
                type="submit"
                disabled={createDay.isPending}
                style={{ width: '100%', height: 56, background: createDay.isPending ? 'var(--border-strong)' : 'var(--accent)', border: 'none', borderRadius: 11, cursor: createDay.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 15, letterSpacing: '2px', color: createDay.isPending ? 'var(--text-muted)' : 'var(--base)' }}
              >
                {createDay.isPending ? '…' : 'ADD DAY'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
