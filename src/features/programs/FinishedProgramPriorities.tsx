import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import type { MuscleGroup } from '../../types'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags.js'
import { buildGroupMarkEntries, MARK_LABELS } from '../../lib/priorityMarks.js'
import type { PriorityMark } from '../../lib/priorityMarks.js'
import { errorReason } from '../../components/exercisePickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import { usePriorityContext } from '../coach/usePriorityContext'
import { useProgramPriorities } from '../plan/useProgramPriorities'
import { useMesos } from './useMesos'
import { finishedProgramMarks, finishedProgramPath } from './programsTabLogic'

// A finished program's priorities, READ-ONLY (chunk 76; SPEC 1.2.1 Screens → Finished program · PRIORITIES, read-only [1]; prototype "Finished
// program · PRIORITIES": Marks (1.1 and later), Old marks (pre-1.1), None set). It is the screen PR14's PRIORITIES row opens for every finished
// program, at `/program/finished/:id/priorities`, and it replaces chunk 66's editor (the planner's `StepPriorities` over the run copy): nothing on
// it writes, and nothing here imports a write (`useSetPriorityMark`, the planner's step, Coach's setters). It is the view-only screen of the
// running program (`plan/PrioritiesEditor.tsx`, PR5) for a run that is finished: the back arrow (to the finished program, replacing this entry),
// the run's name over PRIORITIES, the groups with the mark each one carries, a tap on a group to unfold its subgroups, and, with nothing marked,
// "No priorities were set for this program."
//
// What it shows is the run copy's own marks (`v2_program_priorities` on `run.programId`: the marks copied when the run started, never the saved
// program's, which the planner may have changed since) or, when the copy holds none, the old table's (`v2_coach_meso_tag_priorities`, a run
// finished before 1.1: Coach's `usePriorityContext`, read as it is) through migration 033's mapping (top → FOCUS, low → DON'T CARE; high and
// normal nothing): `finishedProgramMarks`, the one function the finished program's header line asks too. The old table is read only when the run
// copy holds no marks.
//
// Standing UI rule (RULES, Adam 2026-10-10): a group or subgroup shows its mark as a compact read-only label only where a mark is stored, and one
// without a mark shows just its name. A subgroup that only inherits its group's mark shows nothing: the group's label and its "… without …"
// summary carry that.
//
// Display choices no board settles, provisional under D31: the three states PrioritiesEditor draws (the spinner, "COULDN'T LOAD PRIORITIES" with the
// real reason under it (SPEC Errors (15)), and "No finished program here" for an id that is no finished program) are the screen's own, and the
// groups' cards are PR5's as built (the prototype's `FinishedPriorities`).

// A mark, as text on its row: the compact accent label the Plan rows already use for a set's kind (WARMUP, DROPSET, …). Not a control.
function MarkLabel({ mark }: { mark: PriorityMark }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--accent)', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {MARK_LABELS[mark]}
    </span>
  )
}

// The spinner's ring, one side at a time: a captured render drops a `border` shorthand with `var()` (RULES, jsdom), so a picture would show no ring.
const SPINNER_RING: CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: 'var(--accent)',
  borderRightColor: 'var(--border-strong)',
  borderBottomColor: 'var(--border-strong)',
  borderLeftColor: 'var(--border-strong)',
}

const GROUP_CARD: CSSProperties = { background: 'var(--surface)', ...hairline('var(--border)'), borderRadius: 12, padding: '12px 14px' }

export default function FinishedProgramPriorities() {
  const { mesocycleId = '' } = useParams<{ mesocycleId: string }>()
  const navigate = useNavigate()

  const mesosRead = useMesos()
  // A finished program only: the id of a running program, or of nothing, is not one, and nothing is read for it.
  const run = mesosRead.data?.find((m) => m.id === mesocycleId && m.status === 'completed') ?? null
  const marksRead = useProgramPriorities(run?.programId ?? null)
  const ownMarks = marksRead.data
  // The old table is asked only when the run copy holds no marks of its own.
  const legacyRead = usePriorityContext(run && ownMarks !== undefined && ownMarks.length === 0 ? run.id : null)
  const marks = finishedProgramMarks(ownMarks, legacyRead.data?.entries)

  // TanStack keeps the data a later failing read leaves: only a read that never answered is a failure here.
  const failedRead = [mesosRead, marksRead, legacyRead].find((read) => read.isError === true && read.data === undefined)
  const loading = failedRead === undefined && (mesosRead.data === undefined || (run !== null && marks === undefined))
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  // Which groups are unfolded: this screen's own view state, gone with it.
  const [expanded, setExpanded] = useState<Set<MuscleGroup>>(new Set())
  function toggleExpanded(group: MuscleGroup) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const groupEntries = marks ? buildGroupMarkEntries(marks) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header: the back arrow, the run's name over PRIORITIES (boards PR5 and 12) */}
      <div style={{ padding: '16px 16px 14px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          type="button"
          onClick={() => navigate(finishedProgramPath(mesocycleId), { replace: true })}
          aria-label="Back to the finished program"
          style={{ flex: '0 0 auto', width: 44, height: 44, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-raised)', ...hairline('var(--border-strong)'), borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {run && (
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{run.name.toUpperCase()}</span>
          )}
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, lineHeight: 1.05, color: 'var(--text-primary)' }}>PRIORITIES</h1>
        </div>
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px', minHeight: 0 }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
            <div role="status" aria-label="Loading" className="animate-spin" style={{ width: 22, height: 22, borderRadius: '50%', ...SPINNER_RING }} />
          </div>
        )}

        {failedRead && (
          <div role="alert" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 60 }}>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--error)' }}>COULDN'T LOAD PRIORITIES</p>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{errorReason(failedRead.error, offline)}</p>
          </div>
        )}

        {!loading && !failedRead && !run && <div style={{ textAlign: 'center', paddingTop: 60, fontSize: 15, color: 'var(--text-secondary)' }}>No finished program here</div>}

        {run && marks && marks.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, fontSize: 15, color: 'var(--text-secondary)' }}>No priorities were set for this program.</div>
        )}

        {run && marks && marks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {MUSCLE_GROUPS.map((group) => {
              const entry = groupEntries.find((e) => e.tagValue === group)
              if (!entry) return null
              const isExpanded = expanded.has(group)

              // "The summary is phrased from the group" (SPEC): shown only when it says something beyond the plain label, i.e. there is a real
              // exception to name (`summarizeGroup` returns the bare label when the group has a mark and no subgroup differs).
              const hasException = !!entry.summary && entry.summary !== MUSCLE_GROUP_LABELS[group].toLowerCase()

              return (
                <div key={group} data-group={group} style={GROUP_CARD}>
                  {/* The group's row: its name (and the "without …" summary when a subgroup differs), its mark where one is set, visible whether
                      unfolded or not, and the chevron. The whole row is the unfold toggle. */}
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpanded(group)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'transparent', borderWidth: 0, padding: 0, cursor: 'pointer' }}
                  >
                    <div style={{ textAlign: 'left', minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>{MUSCLE_GROUP_LABELS[group]}</span>
                      {hasException && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', marginTop: 2 }}>{entry.summary!.toUpperCase()}</div>
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
                        // A subgroup shows a label only for a mark of its own: one that inherits its group's has nothing stored.
                        <div key={sub.tagValue} data-subgroup={sub.tagValue} style={{ paddingLeft: 14, borderLeft: '1px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)' }}>{MUSCLE_SUBGROUP_LABELS[sub.tagValue]}</span>
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
