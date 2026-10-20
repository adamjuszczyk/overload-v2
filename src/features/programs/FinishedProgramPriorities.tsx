import type { CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { errorReason } from '../../components/exercisePickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import StepPriorities from '../planner/StepPriorities'
import { useMesos } from './useMesos'
import { finishedProgramPath } from './programsTabLogic'

// A finished program's priorities, editable (chunk 66; SPEC Programs and runs [1.2]: "A finished program's priorities stay editable, from its
// PRIORITIES row (PR14). It shows and edits the run's own priorities (the ones copied at its start)"; TASKS 66: "an editable priorities editor
// over the run copy (the planner's `StepPriorities` writer reused on the finished run's program id)"). It is PR14's PRIORITIES row for a run whose
// marks are in the new table, at `/program/finished/:id/priorities`: the header of the view-only priorities screen of chunk 65 (the back arrow, the
// run's name over PRIORITIES), and under it the planner's step 1 on the run's own program, the copy made when it started (`run.programId`), never
// the saved program it came from (`sourceProgramId`), whose marks the planner may have changed since. Every mark is the planner's own write
// (`useSetPriorityMark`: one row per group or subgroup, "normal" deleting it).
//
// A run that isn't found, or isn't finished, has no editor here: a running program's priorities are view-only (PR5) and are reached from Plan.

const SPINNER_RING: CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: 'var(--accent)',
  borderRightColor: 'var(--border-strong)',
  borderBottomColor: 'var(--border-strong)',
  borderLeftColor: 'var(--border-strong)',
}

export default function FinishedProgramPriorities() {
  const { mesocycleId = '' } = useParams<{ mesocycleId: string }>()
  const navigate = useNavigate()
  const mesosRead = useMesos()
  const run = mesosRead.data?.find((m) => m.id === mesocycleId && m.status === 'completed') ?? null
  const failed = mesosRead.isError === true && mesosRead.data === undefined
  const loading = !failed && mesosRead.data === undefined
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
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
        {failed && (
          <div role="alert" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 60 }}>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--error)' }}>COULDN'T LOAD PRIORITIES</p>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{errorReason(mesosRead.error, offline)}</p>
          </div>
        )}
        {!loading && !failed && !run && <div style={{ textAlign: 'center', paddingTop: 60, fontSize: 15, color: 'var(--text-secondary)' }}>No finished program here</div>}
        {run && <StepPriorities programId={run.programId} showOptionalNote={false} />}
      </div>
    </div>
  )
}
