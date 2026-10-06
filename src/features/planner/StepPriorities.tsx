import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { MuscleGroup } from '../../types'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags.js'
import { buildGroupMarkEntries, MARK_LABELS } from '../../lib/priorityMarks.js'
import { useProgramPriorities, useSetPriorityMark } from '../plan/useProgramPriorities'
import { useToastStore } from '../notifications/toastStore'
import MarkSelector from '../plan/MarkSelector'

// Step 1 — Priorities (SPEC.md "Stepped program planner" step 1; TASKS.md
// "step 1 uses the chunk 10 editor on the saved program"). Skippable:
// nothing here blocks moving on to step 2 (no required value at all).
//
// Reuses chunk 10's own editor machinery, not a re-implementation: the same
// hooks (useProgramPriorities / useSetPriorityMark), the same MarkSelector
// chip row and the same buildGroupMarkEntries grouping PrioritiesEditor.tsx
// (the run's own equivalent screen, reached from Plan's header) already
// uses — parameterised by this step's own `programId` (any saved program)
// instead of PrioritiesEditor's hardcoded "the active run" lookup, and with
// no page header/back button of its own (the planner's own shell already
// provides one — see PlannerPage.tsx).
export default function StepPriorities({ programId }: { programId: string }) {
  const showToast = useToastStore((s) => s.show)
  const { data: rows, isLoading, isError } = useProgramPriorities(programId)
  const setMark = useSetPriorityMark(programId)

  // Page-local view state, same precedent as PrioritiesEditor.tsx's own
  // `expanded` — doesn't outlive this component.
  const [expanded, setExpanded] = useState<Set<MuscleGroup>>(new Set())

  function toggleExpanded(group: MuscleGroup) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  function handleSetMark(
    tagType: 'muscle_group' | 'muscle_subgroup',
    tagValue: string,
    mark: 'focus' | 'dont_care' | null,
  ) {
    setMark.mutate({ tagType, tagValue, mark }, { onError: () => showToast('Could not update priorities') })
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
        <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 60 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--error)' }}>
          COULDN'T LOAD PRIORITIES
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 8 }}>
          Check your connection and try again.
        </p>
      </div>
    )
  }

  const groupEntries = rows ? buildGroupMarkEntries(rows) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
        OPTIONAL — SKIP IF YOU DON'T NEED IT
      </p>

      {MUSCLE_GROUPS.map((group) => {
        const isExpanded = expanded.has(group)
        const entry = groupEntries.find((e) => e.tagValue === group)
        if (!entry) return null

        // "The summary is phrased from the group" (SPEC) — shown only when
        // it says something beyond the plain label.
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

            {/* The group's own selector stays visible whether expanded or
                not — SPEC §3 makes the group the ceiling, so it's the thing
                read first. */}
            <MarkSelector
              value={entry.ownMark}
              disabled={setMark.isPending}
              onChange={(mark) => handleSetMark('muscle_group', group, mark)}
            />

            {isExpanded && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {entry.subgroups.map((sub) => {
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
  )
}
