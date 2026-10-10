import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import type { MuscleGroup } from '../../types'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags.js'
import { buildGroupMarkEntries, MARK_LABELS } from '../../lib/priorityMarks.js'
import type { PriorityMark } from '../../lib/priorityMarks.js'
import { useMesos } from '../programs/useMesos'
import { usePrograms } from '../programs/usePrograms'
import { useProgramPriorities } from './useProgramPriorities'

// The active run's priorities, VIEW-ONLY (chunk 28; SPEC.md Programs and runs
// [P1.1]: "Priorities are a property of the program. They're set in the
// planner when the program is built, and copied to a run when it starts.
// They can't be changed during a run. Plan shows them view-only."). Routed at
// /plan/priorities and reached from the Plan header's PRIORITIES link
// (PlanPage.tsx) — always the ACTIVE run's own program copy, so unlike
// MesoPrioritiesPage.tsx (meso-scoped by a route param, for any meso
// including a completed one) it needs no id in its URL: it looks up the
// active meso the way PlanPage itself does. A completed run's old-style
// marks stay on MesoPrioritiesPage (reached from the Programs page) — not
// this screen, and not this table.
//
// Nothing here writes: no mark chips and no write hook. A run's marks are set
// on the saved program in the planner (StepPriorities, now the only screen
// that writes marks) and copied onto the run's copy by v2_start_run →
// v2_copy_program (live definition: migration 034), so they have no write
// path from Plan.
//
// Standing UI rule (CONTEXT.md, Adam 2026-10-10): "A feature that's set shows
// a small marker on its row... An unset feature shows nothing: no empty
// fields, chips or placeholders." So a group or subgroup shows its mark as a
// compact read-only label only where a mark is stored, and a group or
// subgroup without one shows just its name. Groups still unfold to their
// subgroups, as before.

// A mark, as text on its row: the compact accent label the Plan rows already
// use for a set's kind (WARMUP, DROPSET, …). Not a control.
function MarkLabel({ mark }: { mark: PriorityMark }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--accent)', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {MARK_LABELS[mark]}
    </span>
  )
}

export default function PrioritiesEditor() {
  const navigate = useNavigate()

  const { data: mesos = [], isLoading: mesosLoading, isError: mesosError } = useMesos()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null

  const { data: programs = [] } = usePrograms()
  const program = programs.find((p) => p.id === activeMeso?.programId)

  const {
    data: rows,
    isLoading: rowsLoading,
    isError: rowsError,
  } = useProgramPriorities(activeMeso?.programId ?? null)

  // Which groups are expanded — page-local view state, same precedent as
  // MesoPrioritiesPage.tsx's own `expanded` (and PlanPage.tsx's
  // selectedDow/compact): doesn't outlive this component.
  const [expanded, setExpanded] = useState<Set<MuscleGroup>>(new Set())

  function toggleExpanded(group: MuscleGroup) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  function handleDone() {
    // Same "pop back to wherever this was entered from" as
    // MesoPrioritiesPage.tsx's handleDone — this screen has one entry point
    // (Plan's header), but a hard reload has no in-app history to pop into.
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate('/plan')
    }
  }

  const loading = mesosLoading || rowsLoading
  const failed = mesosError || rowsError
  const groupEntries = rows ? buildGroupMarkEntries(rows) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 14px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={handleDone}
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 9, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
        >
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeMeso?.name ?? 'PRIORITIES'}
          </div>
          {program && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {program.name}
            </div>
          )}
        </div>
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px', minHeight: 0 }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
            <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
          </div>
        )}

        {!loading && failed && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--error)' }}>
              COULDN'T LOAD PRIORITIES
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 8 }}>
              Check your connection and try again.
            </p>
          </div>
        )}

        {!loading && !failed && !activeMeso && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              NO ACTIVE MESOCYCLE
            </p>
          </div>
        )}

        {!loading && !failed && activeMeso && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {MUSCLE_GROUPS.map((group) => {
              const isExpanded = expanded.has(group)
              const entry = groupEntries.find((e) => e.tagValue === group)
              if (!entry) return null

              // "The summary is phrased from the group" (SPEC) — shown only
              // when it says something beyond the plain label, i.e. there's
              // a real exception to name (summarizeGroup returns the bare
              // label itself when the group has a mark but no subgroup
              // differs — nothing worth repeating under the group's own
              // name).
              const groupLabel = MUSCLE_GROUP_LABELS[group].toLowerCase()
              const hasException = !!entry.summary && entry.summary !== groupLabel

              return (
                <div
                  key={group}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}
                >
                  {/* The group's row: its name (and the "without …" summary
                      when a subgroup differs), its mark where one is set —
                      visible whether expanded or not, SPEC §3 makes the
                      group the ceiling, so it's the thing read first — and
                      the chevron. The whole row is the unfold toggle. */}
                  <button
                    onClick={() => toggleExpanded(group)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <div style={{ textAlign: 'left', minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>
                        {MUSCLE_GROUP_LABELS[group]}
                      </span>
                      {hasException && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', marginTop: 2 }}>
                          {entry.summary!.toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {entry.ownMark && <MarkLabel mark={entry.ownMark} />}
                      {isExpanded ? (
                        <ChevronUp size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                      ) : (
                        <ChevronDown size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {entry.subgroups.map((sub) => (
                        // A subgroup shows a label only for a mark of its own.
                        // One that merely inherits its group's mark (SPEC:
                        // "A subgroup with no mark of its own takes its
                        // group's mark") has nothing stored, so it shows
                        // nothing here — the group's own label and its
                        // "… without …" summary carry that.
                        <div
                          key={sub.tagValue}
                          style={{ paddingLeft: 14, borderLeft: '1px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                        >
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
                            {MUSCLE_SUBGROUP_LABELS[sub.tagValue]}
                          </span>
                          {sub.ownMark && <MarkLabel mark={sub.ownMark} />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
