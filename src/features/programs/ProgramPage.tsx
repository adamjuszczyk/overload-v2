import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Trash2, X, CheckCircle } from 'lucide-react'
import { differenceInCalendarWeeks, parseISO, format } from 'date-fns'
import type { Mesocycle } from '../../types'
import { usePrograms, useCreateProgram } from './usePrograms'
import { useMesos, useCreateMeso, useCompleteMeso, useDeleteMeso } from './useMesos'

function weekNumber(startDate: string): number {
  return differenceInCalendarWeeks(new Date(), parseISO(startDate), { weekStartsOn: 1 }) + 1
}

function fmtDate(iso: string): string {
  return format(parseISO(iso), 'MMM d, yyyy')
}

export default function ProgramPage() {
  const navigate = useNavigate()

  const { data: mesos = [], isLoading: mesosLoading } = useMesos()
  const { data: programs = [], isLoading: programsLoading } = usePrograms()

  const activeMeso = mesos.find((m) => m.status === 'active') ?? null
  const completedMesos = mesos.filter((m) => m.status === 'completed')

  // Sheet state
  const [showStartMeso, setShowStartMeso] = useState(false)
  const [mesoName, setMesoName] = useState('')
  const [selectedProgramId, setSelectedProgramId] = useState('')
  const [confirmCompleteId, setConfirmCompleteId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showCreateProgram, setShowCreateProgram] = useState(false)
  const [newProgramName, setNewProgramName] = useState('')

  const createMeso = useCreateMeso()
  const completeMeso = useCompleteMeso()
  const deleteMeso = useDeleteMeso()
  const createProgram = useCreateProgram()

  function openStartMeso() {
    setMesoName('')
    setSelectedProgramId(programs[0]?.id ?? '')
    setShowStartMeso(true)
  }

  async function handleStartMeso(e: React.FormEvent) {
    e.preventDefault()
    const name = mesoName.trim() || programs.find((p) => p.id === selectedProgramId)?.name || 'Mesocycle'
    if (!selectedProgramId) return
    const created = await createMeso.mutateAsync({ name, programId: selectedProgramId })
    setShowStartMeso(false)
    // Create-then-configure (TASKS §5.1), mirroring handleCreateProgram just
    // below: the meso row is real before any priority row references it, so
    // no client-minted uuid is needed.
    navigate(`/meso/${created.id}/priorities`)
  }

  async function handleComplete() {
    if (!confirmCompleteId) return
    await completeMeso.mutateAsync(confirmCompleteId)
    setConfirmCompleteId(null)
    // Prompt to start a new meso right after completing
    openStartMeso()
  }

  async function handleDelete() {
    if (!confirmDeleteId) return
    await deleteMeso.mutateAsync(confirmDeleteId)
    setConfirmDeleteId(null)
  }

  async function handleCreateProgram(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newProgramName.trim()
    if (!trimmed) return
    const created = await createProgram.mutateAsync(trimmed)
    setNewProgramName('')
    setShowCreateProgram(false)
    navigate(`/program/${created.id}`)
  }

  const isLoading = mesosLoading || programsLoading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header */}
      <div style={{ padding: '20px 20px 16px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2.5px', color: 'var(--text-muted)', marginBottom: 6 }}>
          OVERLOAD v2
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 28, letterSpacing: '-0.5px', color: 'var(--text-primary)', lineHeight: 1 }}>
          PROGRAM
        </h1>
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ─── Active Meso Section ─── */}
        <div style={{ padding: '20px 20px 0' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 12 }}>
            ACTIVE MESOCYCLE
          </p>

          {isLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
            </div>
          )}

          {!isLoading && !activeMeso && (
            <button
              onClick={openStartMeso}
              style={{ width: '100%', height: 72, background: 'var(--accent-muted)', border: '1px dashed var(--accent)', borderRadius: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, letterSpacing: '2px', color: 'var(--accent)' }}
            >
              + START MESOCYCLE
            </button>
          )}

          {!isLoading && activeMeso && (
            <ActiveMesoCard
              meso={activeMeso}
              onComplete={() => setConfirmCompleteId(activeMeso.id)}
              onNewMeso={openStartMeso}
            />
          )}
        </div>

        {/* ─── Completed Mesos ─── */}
        {completedMesos.length > 0 && (
          <div style={{ padding: '24px 20px 0' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 12 }}>
              COMPLETED
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {completedMesos.map((m) => (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/meso/${m.id}/priorities`)}
                  // Space as well as Enter: this is the codebase's only
                  // role="button", so it carries that role's whole keyboard
                  // contract itself rather than inheriting a real <button>'s.
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(`/meso/${m.id}/priorities`)
                    }
                  }}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 3 }}>
                      {m.program?.name && `${m.program.name} · `}{fmtDate(m.startDate)}{m.endDate ? ` → ${fmtDate(m.endDate)}` : ''}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(m.id) }}
                    style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── My Programs ─── */}
        <div style={{ padding: '24px 20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}>
              MY PROGRAMS
            </span>
            <button
              onClick={() => { setNewProgramName(''); setShowCreateProgram(true) }}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent)', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 18, color: 'var(--base)', lineHeight: 1 }}
            >
              +
            </button>
          </div>

          {!programsLoading && programs.length === 0 && (
            <p style={{ textAlign: 'center', padding: '20px 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              NO PROGRAMS YET
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {programs.map((program) => {
              const trainingDays = Object.values(program.schedule).filter(Boolean).length
              return (
                <button
                  key={program.id}
                  onClick={() => navigate(`/program/${program.id}`)}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: trainingDays > 0 ? 3 : 0 }}>
                      {program.name}
                    </div>
                    {trainingDays > 0 && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
                        {trainingDays} DAY{trainingDays !== 1 ? 'S' : ''} / WEEK
                      </span>
                    )}
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ─── Start Meso Sheet ─── */}
      {showStartMeso && (
        <BottomSheet onClose={() => setShowStartMeso(false)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, letterSpacing: '1px', color: 'var(--text-primary)' }}>
              {activeMeso ? 'NEW MESOCYCLE' : 'START MESOCYCLE'}
            </span>
            <button onClick={() => setShowStartMeso(false)} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <X size={15} />
            </button>
          </div>

          {programs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)', marginBottom: 12 }}>
                CREATE A PROGRAM FIRST
              </p>
              <button
                onClick={() => { setShowStartMeso(false); setNewProgramName(''); setShowCreateProgram(true) }}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 9, padding: '10px 20px', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, letterSpacing: '1.5px', color: 'var(--base)', cursor: 'pointer' }}
              >
                CREATE PROGRAM
              </button>
            </div>
          ) : (
            <form onSubmit={handleStartMeso}>
              <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 8 }}>
                MESO NAME <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                value={mesoName}
                onChange={(e) => setMesoName(e.target.value)}
                placeholder={programs.find((p) => p.id === selectedProgramId)?.name || 'e.g. Summer Block'}
                style={{ width: '100%', height: 48, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '0 14px', fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: 20, outline: 'none' }}
              />

              <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 10 }}>
                PROGRAM
              </label>
              <div className="hide-scrollbar" style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                {programs.map((p) => {
                  const selected = selectedProgramId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProgramId(p.id)}
                      style={{ width: '100%', padding: '12px 14px', textAlign: 'left', background: selected ? 'var(--accent-muted)' : 'var(--surface)', border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 9, cursor: 'pointer', fontWeight: 700, fontSize: 14, color: selected ? 'var(--accent)' : 'var(--text-primary)' }}
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>

              {activeMeso && (
                <div style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 9, padding: '10px 14px', marginBottom: 16 }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    Starting a new mesocycle will automatically complete the current one.
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={!selectedProgramId || createMeso.isPending}
                style={{ width: '100%', height: 54, background: (!selectedProgramId || createMeso.isPending) ? 'var(--border-strong)' : 'var(--accent)', border: 'none', borderRadius: 11, cursor: (!selectedProgramId || createMeso.isPending) ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, letterSpacing: '2px', color: (!selectedProgramId || createMeso.isPending) ? 'var(--text-muted)' : 'var(--base)' }}
              >
                {createMeso.isPending ? '…' : 'START MESOCYCLE'}
              </button>
            </form>
          )}
        </BottomSheet>
      )}

      {/* ─── Confirm Complete Sheet ─── */}
      {confirmCompleteId && (
        <BottomSheet onClose={() => setConfirmCompleteId(null)}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
            <CheckCircle size={22} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', marginBottom: 6 }}>
                Complete mesocycle?
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                This mesocycle will be marked complete and you can start a new one.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setConfirmCompleteId(null)}
              style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', color: 'var(--text-secondary)' }}
            >
              CANCEL
            </button>
            <button
              onClick={handleComplete}
              disabled={completeMeso.isPending}
              style={{ flex: 1, height: 50, background: 'var(--accent)', border: 'none', borderRadius: 10, cursor: completeMeso.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: 'var(--base)' }}
            >
              {completeMeso.isPending ? '…' : 'COMPLETE'}
            </button>
          </div>
        </BottomSheet>
      )}

      {/* ─── Confirm Delete Sheet ─── */}
      {confirmDeleteId && (
        <BottomSheet onClose={() => setConfirmDeleteId(null)}>
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', marginBottom: 8 }}>
              Delete mesocycle?
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              This cannot be undone. Any linked session history will remain.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setConfirmDeleteId(null)}
              style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', color: 'var(--text-secondary)' }}
            >
              CANCEL
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteMeso.isPending}
              style={{ flex: 1, height: 50, background: '#cc3333', border: 'none', borderRadius: 10, cursor: deleteMeso.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: '#fff' }}
            >
              {deleteMeso.isPending ? '…' : 'DELETE'}
            </button>
          </div>
        </BottomSheet>
      )}

      {/* ─── Create Program Sheet ─── */}
      {showCreateProgram && (
        <BottomSheet onClose={() => setShowCreateProgram(false)}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, letterSpacing: '1px', marginBottom: 20, color: 'var(--text-primary)' }}>
            NEW PROGRAM
          </p>
          <form onSubmit={handleCreateProgram}>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 8 }}>
              PROGRAM NAME
            </label>
            <input
              type="text"
              value={newProgramName}
              onChange={(e) => setNewProgramName(e.target.value)}
              placeholder="e.g. Hypertrophy Block"
              autoFocus
              style={{ width: '100%', height: 52, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '0 16px', fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: 20, outline: 'none' }}
            />
            <button
              type="submit"
              disabled={createProgram.isPending}
              style={{ width: '100%', height: 56, background: createProgram.isPending ? 'var(--border-strong)' : 'var(--accent)', border: 'none', borderRadius: 11, cursor: createProgram.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 15, letterSpacing: '2px', color: createProgram.isPending ? 'var(--text-muted)' : 'var(--base)' }}
            >
              {createProgram.isPending ? '…' : 'CREATE PROGRAM'}
            </button>
          </form>
        </BottomSheet>
      )}
    </div>
  )
}

// ─── Active Meso Card ──────────────────────────────────────────────────────────

function ActiveMesoCard({
  meso,
  onComplete,
  onNewMeso,
}: {
  meso: Mesocycle
  onComplete: () => void
  onNewMeso: () => void
}) {
  const week = weekNumber(meso.startDate)

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '16px 16px 14px' }}>
        {/* Week badge + name row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div style={{ background: 'var(--accent)', borderRadius: 6, padding: '3px 10px', flexShrink: 0, alignSelf: 'center' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 11, letterSpacing: '1.5px', color: 'var(--base)' }}>
              WEEK {week}
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meso.name}
            </div>
          </div>
        </div>

        {/* Program name + start date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {meso.program?.name && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meso.program.name}
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)', flexShrink: 0 }}>
            SINCE {fmtDate(meso.startDate).toUpperCase()}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={onComplete}
          style={{ flex: 1, padding: '11px 0', background: 'transparent', border: 'none', borderRight: '1px solid var(--border-subtle)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}
        >
          COMPLETE MESO
        </button>
        <button
          onClick={onNewMeso}
          style={{ flex: 1, padding: '11px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: 'var(--accent)' }}
        >
          NEW MESO
        </button>
      </div>
    </div>
  )
}

// ─── Bottom Sheet wrapper ──────────────────────────────────────────────────────

function BottomSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', border: '1px solid var(--border)', borderBottom: 'none', maxHeight: '85dvh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  )
}
