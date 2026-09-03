import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import type { MuscleGroup } from '../../types'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags.js'
import { PRIORITY_TREE } from '../../lib/priorityTags.js'
import { useMesos } from '../programs/useMesos'
import { usePriorityContext, useSetTagPriority, usePreviousMeso, useCopyPrioritiesFromMeso } from './usePriorityContext'
import PrioritySelector from './PrioritySelector'

// The priority-planning screen (PRIORITY-CONTEXT-TASKS.md §5.2), routed at
// /meso/:mesocycleId/priorities — meso-scoped rather than active-only, so it
// works both right after creation and later, for any meso including a
// completed one (§5.3's two entry points). Nothing here is modal or
// one-shot: priorities stay editable for the whole meso's life.

function fmtDate(iso: string): string {
  return format(parseISO(iso), 'MMM d, yyyy')
}

export default function MesoPrioritiesPage() {
  const { mesocycleId } = useParams<{ mesocycleId: string }>()
  const navigate = useNavigate()

  const { data: mesos = [], isLoading: mesosLoading, isError: mesosError } = useMesos()
  const meso = mesos.find((m) => m.id === mesocycleId) ?? null

  const {
    data: context,
    isLoading: contextLoading,
    isError: contextError,
  } = usePriorityContext(mesocycleId ?? null)
  const setPriority = useSetTagPriority(mesocycleId ?? '')
  const previousMeso = usePreviousMeso(mesocycleId ?? null)
  // §5.8's deliberate tightening over COPY WEEK's own precedent: gate on the
  // *source* having rows too, not just existing, so the button never offers
  // a tap that silently copies nothing (copyPrioritiesFromMeso returns early
  // on an empty source — found by Phase 3's live check reproducing exactly
  // that COPY WEEK gap this tightening exists to avoid).
  const { data: previousContext } = usePriorityContext(previousMeso?.id ?? null)
  const copyFrom = useCopyPrioritiesFromMeso(mesocycleId ?? '')

  // Which groups are expanded — page-local view state that doesn't outlive
  // this component, so useState rather than Zustand (§5.5; PlanPage.tsx's
  // selectedDow/compact are the same kind of state).
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
    // "Returns to wherever the screen was entered from" (§5.2) — creation
    // and the completed-meso row both push from /program, PlanPage's header
    // link pushes from /plan. A plain history pop covers all three without
    // hardcoding a destination by meso status. The idx guard only matters on
    // a hard reload, which has no in-app history entry to pop back into.
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate('/program')
    }
  }

  const loading = mesosLoading || contextLoading
  const failed = mesosError || contextError
  const showCopyButton = !!context && !context.anyExplicit && !!previousMeso && !!previousContext?.anyExplicit

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header — names the meso, its program, its start date (the same
          three facts ActiveMesoCard shows), so this screen can never be
          mistaken for a program-level or global setting. */}
      <div style={{ padding: '16px 20px 14px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={handleDone}
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 9, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
        >
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meso?.name ?? 'PRIORITIES'}
          </div>
          {meso && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meso.program?.name && `${meso.program.name} · `}SINCE {fmtDate(meso.startDate).toUpperCase()}
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

        {/* Offline / fetch failure (§5.7) — fails visibly rather than a
            silent blank, the one place this feature does better than the
            surrounding meso mutations. */}
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

        {!loading && !failed && !meso && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              MESOCYCLE NOT FOUND
            </p>
          </div>
        )}

        {!loading && !failed && meso && context && (
          <>
            {/* COPY FROM «previous meso» (§5.8) — same full-width dashed
                style as PlanPage's COPY WEEK. Only ever offered into an
                empty destination, so there's no overwrite path to design. */}
            {showCopyButton && (
              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={() => copyFrom.mutate({ fromMesocycleId: previousMeso!.id })}
                  disabled={copyFrom.isPending}
                  style={{ width: '100%', height: 48, background: 'var(--surface)', border: '1px dashed var(--border-strong)', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: copyFrom.isPending ? 'not-allowed' : 'pointer', opacity: copyFrom.isPending ? 0.6 : 1 }}
                >
                  <Copy size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-secondary)' }}>
                    {copyFrom.isPending ? 'COPYING…' : `COPY FROM «${previousMeso!.name}»`}
                  </span>
                </button>
                {copyFrom.isError && (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: 'var(--error)', marginTop: 6 }}>
                    {(copyFrom.error as Error).message}
                  </p>
                )}
              </div>
            )}

            {/* §5.7: this feature's own selector should surface its
                mutation error rather than appearing to succeed. */}
            {setPriority.isError && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: 'var(--error)', marginBottom: 12 }}>
                {(setPriority.error as Error).message}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {MUSCLE_GROUPS.map((group) => {
                const isExpanded = expanded.has(group)
                const groupEntry = context.muscleGroups[group]
                const subgroups = PRIORITY_TREE[group]

                return (
                  <div
                    key={group}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}
                  >
                    <button
                      onClick={() => toggleExpanded(group)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: 0, marginBottom: 10, cursor: 'pointer' }}
                    >
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>
                        {MUSCLE_GROUP_LABELS[group]}
                      </span>
                      {isExpanded ? (
                        <ChevronUp size={16} style={{ color: 'var(--text-dim)' }} />
                      ) : (
                        <ChevronDown size={16} style={{ color: 'var(--text-dim)' }} />
                      )}
                    </button>

                    {/* The group's own selector stays visible whether
                        expanded or not — SPEC §3 makes the group the
                        ceiling, so it's the thing read first. */}
                    <PrioritySelector
                      value={groupEntry.priority}
                      disabled={copyFrom.isPending}
                      onChange={(priority) =>
                        setPriority.mutate({ tagType: 'muscle_group', tagValue: group, priority })
                      }
                    />

                    {isExpanded && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {subgroups.map((subgroup) => {
                          const subEntry = context.muscleSubgroups[subgroup]
                          return (
                            <div key={subgroup} style={{ paddingLeft: 14, borderLeft: '1px dashed var(--border-strong)' }}>
                              <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginBottom: 8 }}>
                                {MUSCLE_SUBGROUP_LABELS[subgroup]}
                              </span>
                              <PrioritySelector
                                value={subEntry.priority}
                                disabled={copyFrom.isPending}
                                onChange={(priority) =>
                                  setPriority.mutate({ tagType: 'muscle_subgroup', tagValue: subgroup, priority })
                                }
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
