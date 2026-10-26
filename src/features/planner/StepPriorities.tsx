import { useState } from 'react'
import { ChevronDown, ChevronUp, CircleAlert } from 'lucide-react'
import type { MuscleGroup } from '../../types'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags.js'
import { buildGroupMarkEntries, MARK_LABELS } from '../../lib/priorityMarks.js'
import type { PriorityMark } from '../../lib/priorityMarks.js'
import { errorReason } from '../../components/exercisePickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import { useProgramPriorities, useSetPriorityMark } from '../plan/useProgramPriorities'
import { CAPTION, CARD, ErrorLine, MONO, Spinner, ruleBelow } from './plannerChrome'

// Step 1 — Priorities (SPEC.md "Stepped program planner" step 1; TASKS.md "step 1 uses the chunk 10 editor on the saved program"; boards PP1 and
// PP5/PP5b). Skippable: nothing here blocks moving on to step 2 (no required value at all).
//
// Reuses chunk 10's own editor machinery, not a re-implementation: the same hooks (useProgramPriorities / useSetPriorityMark) and the same
// buildGroupMarkEntries grouping PrioritiesEditor.tsx (the run's own equivalent screen, reached from Plan's header) already uses — parameterised
// by this step's own `programId` (any saved program) instead of PrioritiesEditor's hardcoded "the active run" lookup, and with no page header/back
// button of its own (the planner's own shell already provides one — see PlannerPage.tsx).
//
// Chunk 68 draws it as PP1 does: one card of rows, each group with its chevron, its name and its FOCUS | DON'T CARE segment (a tap on the mark that
// is on clears it, as the chip row did), the summary under a group whose subgroups differ ("CHEST WITHOUT LOWER CHEST"), and under an unfolded
// group each subgroup with the same segment and, where it takes its group's mark, "INHERITED: FOCUS". The write is the one it was
// (`useSetPriorityMark`, one mutate per tap, same arguments). A mark that doesn't save says so on the screen, over the list: "Couldn't update
// priorities." and the server's own message under it (PP5b; SPEC Errors (15)); it stays until the next tap. A read that fails says the same way
// why (PP5: "Couldn't load priorities" and the real reason, where the board's "Check your connection and try again." follows Errors (15) instead).
//
// Chunk 66 reuses it as a finished program's priorities editor (SPEC Programs and runs [1.2]: "A finished program's priorities stay editable",
// TASKS 66: "the planner's StepPriorities writer reused on the finished run's program id"), where `programId` is the run's own copy and the
// planner's "OPTIONAL — SKIP IF YOU DON'T NEED IT" line has nothing to say: `showOptionalNote={false}` leaves it out. Nothing else differs; the
// planner passes nothing and reads as before.
const MARKS: readonly PriorityMark[] = ['focus', 'dont_care']

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// A subgroup's name as PP1 draws it: "Upper chest", where the app's own label is the capitals "UPPER CHEST".
function sentenceCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase()
}

// PP1's segment: two marks in one outlined box, the one that is on drawn in the muted accent.
function MarkSegment({ label, value, disabled, onChange }: { label: string; value: PriorityMark | null; disabled: boolean; onChange: (mark: PriorityMark | null) => void }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ flex: '0 0 auto', display: 'grid', gridTemplateColumns: 'auto auto', height: 44, boxSizing: 'border-box', borderRadius: 8, ...hairline('var(--border)'), background: 'var(--surface)', overflow: 'hidden' }}
    >
      {MARKS.map((mark) => {
        const on = value === mark
        return (
          <button
            key={mark}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? null : mark)}
            style={{ ...MONO, height: 42, boxSizing: 'border-box', padding: '0 12px', borderRadius: 7, ...hairline(on ? 'var(--accent)' : 'transparent'), background: on ? 'var(--accent-muted)' : 'transparent', color: on ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 10, letterSpacing: '0.1em', opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}
          >
            {MARK_LABELS[mark]}
          </button>
        )
      })}
    </div>
  )
}

export default function StepPriorities({ programId, showOptionalNote = true }: { programId: string; showOptionalNote?: boolean }) {
  const { data: rows, isLoading, isError, error } = useProgramPriorities(programId)
  const setMark = useSetPriorityMark(programId)

  // Page-local view state, same precedent as PrioritiesEditor.tsx's own `expanded` — doesn't outlive this component.
  const [expanded, setExpanded] = useState<Set<MuscleGroup>>(new Set())
  // The last mark that didn't save (PP5b); cleared by the next tap.
  const [markFailure, setMarkFailure] = useState<{ reason: unknown } | null>(null)

  function toggleExpanded(group: MuscleGroup) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  function handleSetMark(tagType: 'muscle_group' | 'muscle_subgroup', tagValue: string, mark: PriorityMark | null) {
    setMarkFailure(null)
    setMark.mutate({ tagType, tagValue, mark }, { onError: (reason: unknown) => setMarkFailure({ reason }) })
  }

  if (isLoading) return <Spinner label="Loading priorities" padding="60px 0" />

  if (isError) {
    return (
      <div role="alert" style={{ textAlign: 'center', padding: '48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 16, color: 'var(--error)' }}>
          <CircleAlert size={16} aria-hidden="true" />
          Couldn&apos;t load priorities
        </p>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{errorReason(error, offline())}</p>
      </div>
    )
  }

  const groupEntries = rows ? buildGroupMarkEntries(rows) : []
  const shown = MUSCLE_GROUPS.filter((group) => groupEntries.some((e) => e.tagValue === group))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {showOptionalNote && <span style={CAPTION}>OPTIONAL — SKIP IF YOU DON&apos;T NEED IT</span>}

      {markFailure && <ErrorLine headline="Couldn't update priorities." reason={errorReason(markFailure.reason, offline())} />}

      <div style={{ ...CARD, padding: '0 12px 0 4px' }}>
        {shown.map((group, index) => {
          const isExpanded = expanded.has(group)
          const entry = groupEntries.find((e) => e.tagValue === group)!
          const name = MUSCLE_GROUP_LABELS[group]

          // "The summary is phrased from the group" (SPEC) — shown only when it says something beyond the plain label.
          const hasException = !!entry.summary && entry.summary !== name.toLowerCase()

          return (
            <div key={group} style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 4, ...(index < shown.length - 1 ? ruleBelow() : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${name.toUpperCase()}`}
                  onClick={() => toggleExpanded(group)}
                  style={{ flex: 1, minWidth: 0, height: 44, padding: 0, borderWidth: 0, background: 'transparent', display: 'flex', alignItems: 'center', gap: 4, textAlign: 'left', cursor: 'pointer' }}
                >
                  <span style={{ flex: '0 0 auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    {isExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 15, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{name}</span>
                </button>
                {/* The group's own selector stays visible whether unfolded or not — SPEC §3 makes the group the ceiling, so it's the thing read first. */}
                <MarkSegment label={`Priority for ${name.toUpperCase()}`} value={entry.ownMark} disabled={setMark.isPending} onChange={(mark) => handleSetMark('muscle_group', group, mark)} />
              </div>

              {hasException && (
                <span style={{ ...MONO, margin: '-2px 0 2px 48px', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-secondary)', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>{entry.summary}</span>
              )}

              {isExpanded && (
                <div style={{ margin: '4px 0 2px 21px', paddingLeft: 26, borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: 'var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {entry.subgroups.map((sub) => {
                    const inherited = sub.ownMark === null && sub.effectiveMark !== null
                    const subName = sentenceCase(MUSCLE_SUBGROUP_LABELS[sub.tagValue])
                    return (
                      <div key={sub.tagValue} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 }}>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{subName}</span>
                          {inherited && (
                            <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>INHERITED: {MARK_LABELS[sub.effectiveMark!]}</span>
                          )}
                        </div>
                        <MarkSegment label={`Priority for ${subName}`} value={sub.ownMark} disabled={setMark.isPending} onChange={(mark) => handleSetMark('muscle_subgroup', sub.tagValue, mark)} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
