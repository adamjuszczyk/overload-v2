import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import type { MuscleGroup } from '../../types'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags.js'
import { buildGroupMarkEntries, MARK_LABELS } from '../../lib/priorityMarks.js'
import { useMesos } from '../programs/useMesos'
import { usePrograms } from '../programs/usePrograms'
import { useProgramPriorities, useSetPriorityMark } from './useProgramPriorities'
import { useToastStore } from '../notifications/toastStore'
import MarkSelector from './MarkSelector'

// The new priority-marks screen (chunk 10: TASKS.md "Priorities: focus /
// don't care"), routed at /plan/priorities — always the ACTIVE run's own
// program copy (SPEC "Plan screen": the Program tab's own priorities),
// reached only from the Plan header's PRIORITIES link (PlanPage.tsx), so
// unlike MesoPrioritiesPage.tsx (meso-scoped by a route param, for any meso
// including a completed one) this needs no id in its URL: it looks up the
// active meso the same way PlanPage itself does. A completed run's old-
// style marks stay on MesoPrioritiesPage (reached from ProgramPage, per
// TASKS.md) — not this screen, and not this table.
//
// Same page shape as MesoPrioritiesPage.tsx (header, loading/error/empty
// states, groups unfolding to subgroups) and the same chip-row idiom
// (MarkSelector, PrioritySelector's own sibling) — "use the app's existing
// components" read as "the same design language", not a literal re-import,
// since the value contract (nullable, 2-way, toggle-off) differs (see
// MarkSelector.tsx's own header).

export default function PrioritiesEditor() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)

  const { data: mesos = [], isLoading: mesosLoading, isError: mesosError } = useMesos()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null

  const { data: programs = [] } = usePrograms()
  const program = programs.find((p) => p.id === activeMeso?.programId)

  const {
    data: rows,
    isLoading: rowsLoading,
    isError: rowsError,
  } = useProgramPriorities(activeMeso?.programId ?? null)
  const setMark = useSetPriorityMark(activeMeso?.programId ?? '')

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

  function handleSetMark(tagType: 'muscle_group' | 'muscle_subgroup', tagValue: string, mark: 'focus' | 'dont_care' | null) {
    setMark.mutate(
      { tagType, tagValue, mark },
      { onError: () => showToast('Could not update priorities') },
    )
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
                  <button
                    onClick={() => toggleExpanded(group)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: 0, marginBottom: 10, cursor: 'pointer' }}
                  >
                    <div style={{ textAlign: 'left' }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>
                        {MUSCLE_GROUP_LABELS[group]}
                      </span>
                      {hasException && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', marginTop: 2 }}>
                          {entry.summary!.toUpperCase()}
                        </div>
                      )}
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                    ) : (
                      <ChevronDown size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                    )}
                  </button>

                  {/* The group's own selector stays visible whether expanded
                      or not — SPEC §3 makes the group the ceiling, so it's
                      the thing read first. */}
                  <MarkSelector
                    value={entry.ownMark}
                    disabled={setMark.isPending}
                    onChange={(mark) => handleSetMark('muscle_group', group, mark)}
                  />

                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {entry.subgroups.map((sub) => {
                        // A subgroup that merely inherits (no row of its
                        // own) still shows what applies to it — SPEC's own
                        // "Chest marked focus covers upper chest unless
                        // upper chest is marked otherwise" example is
                        // exactly this: nothing stored on upper_chest, but
                        // FOCUS still applies.
                        const inherited = sub.ownMark === null && sub.effectiveMark !== null
                        return (
                          <div key={sub.tagValue} style={{ paddingLeft: 14, borderLeft: '1px dashed var(--border-strong)' }}>
                            <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginBottom: 8 }}>
                              {MUSCLE_SUBGROUP_LABELS[sub.tagValue]}
                            </span>
                            <MarkSelector
                              value={sub.ownMark}
                              disabled={setMark.isPending}
                              onChange={(mark) => handleSetMark('muscle_subgroup', sub.tagValue, mark)}
                            />
                            {inherited && (
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)', marginTop: 6 }}>
                                INHERITED: {MARK_LABELS[sub.effectiveMark!]}
                              </div>
                            )}
                          </div>
                        )
                      })}
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
