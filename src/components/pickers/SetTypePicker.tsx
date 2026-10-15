import type { CSSProperties } from 'react'
import { ChevronRight, Tag } from 'lucide-react'
import BottomSheet from '../BottomSheet'
import { CAPTION_STYLE, StepperPill, hairline } from './pickerControls'
import {
  SET_TYPE_TEXT,
  applySetType,
  cuesSummary,
  restAfterText,
  sameSetType,
  setTypeEyebrow,
  setTypeId,
  setTypeOptionsFor,
  setTypePickerRows,
  stageRestText,
  stepRest,
  stepStageCount,
  stepStageRest,
  type SetType,
  type SetTypeId,
  type SetTypePickerContext,
} from './pickerLogic'

// The one set type picker (TASKS-1.2 chunk 39; boards 5, PP3c, W7a; SPEC "Set types and staged sets
// [1.2]"): "What is this set?" with Normal, Warmup, Dropset, Rest-pause, Myo-reps and Cluster, the
// stage stepper (DROPS, PAUSES, MINI-SETS or CLUSTERS) under a picked staged kind, and, by variant,
// REST BETWEEN, "Rest after this set", Cues, REMOVE THIS SET or the workout's one-line note. Plan,
// CHANGE THE PROGRAM, the stepped planner and the workout all use this one; none of them draws its own.
//
// It writes nothing. `value` is what the set is now and every tap asks `onChange` for the next value
// (a tap on the row already picked asks for nothing); the caller writes it and passes the new value
// back, or doesn't, and the sheet keeps showing what is true (a workout asks before it deletes logged
// drops, so an answer of "no" leaves the old type drawn). The caller mounts the sheet to open it and
// unmounts it to close it (BottomSheet's contract; mount it outside clickable parents: React events from
// inside its portal still bubble to whatever rendered it); `onClose` is asked for by ×, the scrim and Escape.
//
// Which rows a variant shows is `setTypePickerRows` (the rule, tested); a row that needs a handler
// (Rest after this set, Cues, REMOVE THIS SET) is drawn only when the caller gave one, so no control
// is ever a dead one.
export interface SetTypePickerProps {
  context: SetTypePickerContext
  /** The eyebrow's `[EXERCISE] · SET NN`. */
  exerciseName: string
  setNumber: number
  /** The eyebrow's `WEEK N` in Plan (CYCLE N with `isCycle`); the planner's pickers and the workout's have none to give. */
  weekNumber?: number
  isCycle?: boolean
  value: SetType
  onChange: (next: SetType) => void
  /** Asked for by ×, a tap on the scrim and Escape. */
  onClose: () => void
  /** The rows offered; all six by default. A warmup row in Plan offers Normal and Warmup only (G55). */
  allowedKinds?: readonly SetTypeId[]
  /**
   * Plan, week-dependent: the set names a program set of its own exercise, so REST BETWEEN and "Rest
   * after this set" have somewhere to write (G45 c). Without it neither is drawn (SPEC "Rest [P1.1]").
   * No other variant reads it.
   */
  canEditRest?: boolean
  /** The set's own rest after it, in seconds; null (or none given) reads DEFAULT. */
  restAfterSeconds?: number | null
  onRestAfterChange?: (seconds: number | null) => void
  /** The set's cues, for the Cues row's second line. */
  cues?: readonly string[]
  onCues?: () => void
  onRemove?: () => void
}

const SECTIONS_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 }

const LIST_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

const OPTION_BUTTON_STYLE: CSSProperties = {
  minHeight: 52,
  boxSizing: 'border-box',
  padding: '8px 12px',
  borderWidth: 0,
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  textAlign: 'left',
  cursor: 'pointer',
}

const RADIO_DOT_STYLE: CSSProperties = { width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }

const TEXT_COLUMN_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }

const NAME_STYLE: CSSProperties = { fontWeight: 700, fontSize: 15, lineHeight: 1.2, color: 'var(--text-primary)' }

const DESCRIPTION_STYLE: CSSProperties = { fontSize: 12, lineHeight: 1.4, color: 'var(--text-secondary)' }

const STAGE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  padding: '0 12px 12px 42px',
}

const STAGE_CAPTION_STYLE: CSSProperties = { ...CAPTION_STYLE, color: 'var(--text-secondary)' }

const REST_AFTER_STYLE: CSSProperties = {
  minHeight: 56,
  boxSizing: 'border-box',
  padding: '6px 12px',
  borderRadius: 10,
  ...hairline('var(--border)'),
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
}

const CUES_ROW_STYLE: CSSProperties = {
  minHeight: 52,
  boxSizing: 'border-box',
  padding: '0 12px',
  borderRadius: 10,
  ...hairline('var(--border)'),
  background: 'var(--surface)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  textAlign: 'left',
  cursor: 'pointer',
}

const REMOVE_SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderTopWidth: 1,
  borderTopStyle: 'solid',
  borderTopColor: 'var(--border-subtle)',
}

const REMOVE_BUTTON_STYLE: CSSProperties = {
  height: 48,
  padding: '0 2px',
  borderWidth: 0,
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: 'var(--error)',
  cursor: 'pointer',
}

const NOTE_STYLE: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }

export default function SetTypePicker({
  context,
  exerciseName,
  setNumber,
  weekNumber,
  isCycle,
  value,
  onChange,
  onClose,
  allowedKinds,
  canEditRest = false,
  restAfterSeconds,
  onRestAfterChange,
  cues,
  onCues,
  onRemove,
}: SetTypePickerProps) {
  const rows = setTypePickerRows(context, { canEditRest })
  const picked = setTypeId(value)
  const restAfter = restAfterSeconds ?? null

  function choose(id: SetTypeId) {
    const next = applySetType(value, id)
    if (!sameSetType(next, value)) onChange(next)
  }

  const showRestAfter = rows.restAfter && onRestAfterChange !== undefined
  const showCues = rows.cues && onCues !== undefined
  const showRemove = rows.remove && onRemove !== undefined

  return (
    <BottomSheet
      eyebrow={setTypeEyebrow(context, { exerciseName, setNumber, weekNumber, isCycle })}
      title={SET_TYPE_TEXT.title}
      onClose={onClose}
      footer={rows.workoutNote ? <p style={NOTE_STYLE}>{SET_TYPE_TEXT.workoutNote}</p> : undefined}
    >
      <div style={SECTIONS_STYLE}>
        <div role="group" aria-label="Set type" style={LIST_STYLE}>
          {setTypeOptionsFor(allowedKinds).map((option) => {
            const on = option.id === picked
            return (
              <div
                key={option.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 10,
                  ...hairline(on ? 'var(--accent)' : 'var(--border)'),
                  background: on ? 'var(--accent-muted)' : 'var(--surface)',
                }}
              >
                <button type="button" aria-pressed={on} onClick={() => choose(option.id)} style={OPTION_BUTTON_STYLE}>
                  <span
                    aria-hidden="true"
                    style={{
                      flex: '0 0 auto',
                      boxSizing: 'border-box',
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      borderWidth: 2,
                      borderStyle: 'solid',
                      borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on ? <span style={RADIO_DOT_STYLE} /> : null}
                  </span>
                  <span style={TEXT_COLUMN_STYLE}>
                    <span style={NAME_STYLE}>{option.name}</span>
                    <span style={DESCRIPTION_STYLE}>{option.description}</span>
                  </span>
                </button>
                {on && value.kind === 'staged' && option.stageLabel !== null ? (
                  <>
                    <div style={STAGE_ROW_STYLE}>
                      <span style={STAGE_CAPTION_STYLE}>{option.stageLabel}</span>
                      <StepperPill
                        lessLabel={`Fewer ${option.stageLabel.toLowerCase()}`}
                        moreLabel={`More ${option.stageLabel.toLowerCase()}`}
                        onLess={() => onChange(stepStageCount(value, -1))}
                        onMore={() => onChange(stepStageCount(value, 1))}
                        lessDisabled={stepStageCount(value, -1) === value}
                        moreDisabled={stepStageCount(value, 1) === value}
                        valueText={String(value.stageCount)}
                        valueStyle={{ width: 24, fontSize: 15 }}
                      />
                    </div>
                    {rows.restBetween ? (
                      <div style={STAGE_ROW_STYLE}>
                        <span style={STAGE_CAPTION_STYLE}>{SET_TYPE_TEXT.restBetween}</span>
                        <StepperPill
                          lessLabel="Rest between: less"
                          moreLabel="Rest between: more"
                          onLess={() => onChange(stepStageRest(value, -1))}
                          onMore={() => onChange(stepStageRest(value, 1))}
                          lessDisabled={value.stageRestSeconds === null}
                          moreDisabled={stepStageRest(value, 1) === value}
                          valueText={stageRestText(value.stageKind, value.stageRestSeconds)}
                          valueStyle={{ minWidth: 72, fontSize: 12 }}
                        />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            )
          })}
        </div>

        {showRestAfter ? (
          <div style={REST_AFTER_STYLE}>
            <span style={TEXT_COLUMN_STYLE}>
              <span style={NAME_STYLE}>{SET_TYPE_TEXT.restAfter}</span>
              <span style={DESCRIPTION_STYLE}>{SET_TYPE_TEXT.restAfterNote}</span>
            </span>
            <StepperPill
              lessLabel="Rest after this set: less"
              moreLabel="Rest after this set: more"
              onLess={() => onRestAfterChange(stepRest(restAfter, -1))}
              onMore={() => onRestAfterChange(stepRest(restAfter, 1))}
              lessDisabled={restAfter === null}
              moreDisabled={stepRest(restAfter, 1) === restAfter}
              valueText={restAfterText(restAfter)}
              valueStyle={{ minWidth: 72, fontSize: 12 }}
            />
          </div>
        ) : null}

        {showCues ? (
          <button type="button" onClick={onCues} style={CUES_ROW_STYLE}>
            <Tag size={16} strokeWidth={2} aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--text-secondary)' }} />
            <span style={{ ...TEXT_COLUMN_STYLE, flex: 1 }}>
              <span style={NAME_STYLE}>{SET_TYPE_TEXT.cues}</span>
              {cues && cuesSummary(cues) !== '' ? <span style={DESCRIPTION_STYLE}>{cuesSummary(cues)}</span> : null}
            </span>
            <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--text-muted)' }} />
          </button>
        ) : null}

        {showRemove ? (
          <div style={REMOVE_SECTION_STYLE}>
            <button type="button" onClick={onRemove} style={REMOVE_BUTTON_STYLE}>
              {SET_TYPE_TEXT.remove}
            </button>
          </div>
        ) : null}
      </div>
    </BottomSheet>
  )
}
