import { useState } from 'react'
import { X } from 'lucide-react'
import type { Program, WorkoutDay, DayOfWeek, WeeklySchedule } from '../../types'
import { useUpdateSchedule } from './usePrograms'

const DAYS: { key: DayOfWeek; label: string }[] = [
  { key: 'monday',    label: 'MON' },
  { key: 'tuesday',   label: 'TUE' },
  { key: 'wednesday', label: 'WED' },
  { key: 'thursday',  label: 'THU' },
  { key: 'friday',    label: 'FRI' },
  { key: 'saturday',  label: 'SAT' },
  { key: 'sunday',    label: 'SUN' },
]

interface Props {
  program: Program
  workoutDays: WorkoutDay[]
}

export default function WeeklyScheduleGrid({ program, workoutDays }: Props) {
  const [pickerDay, setPickerDay] = useState<DayOfWeek | null>(null)
  const updateSchedule = useUpdateSchedule(program.id)

  function assign(dow: DayOfWeek, dayId: string | null) {
    const next: WeeklySchedule = { ...program.schedule, [dow]: dayId }
    updateSchedule.mutate(next)
    setPickerDay(null)
  }

  const pickerDayLabel = DAYS.find((d) => d.key === pickerDay)?.label ?? ''
  const currentAssignment = pickerDay ? program.schedule[pickerDay] : null

  return (
    <>
      <div className="hide-scrollbar" style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 8, paddingLeft: 20, paddingRight: 20, minWidth: 'max-content' }}>
          {DAYS.map(({ key, label }) => {
            const assignedId = program.schedule[key]
            const assignedDay = workoutDays.find((d) => d.id === assignedId)
            const isRest = !assignedId || !assignedDay

            return (
              <button
                key={key}
                onClick={() => setPickerDay(key)}
                style={{
                  width: 92,
                  flexShrink: 0,
                  background: 'var(--surface)',
                  border: isRest ? '1px dashed var(--border-strong)' : '1px solid var(--border)',
                  borderTop: isRest ? undefined : '3px solid var(--accent)',
                  borderRadius: 10,
                  padding: '10px 10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
                  {label}
                </span>
                {isRest ? (
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 10, color: 'var(--text-dim)', letterSpacing: '2px' }}>
                    REST
                  </span>
                ) : (
                  <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {assignedDay!.name}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Day assignment picker */}
      {pickerDay && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
          onClick={(e) => { if (e.target === e.currentTarget) setPickerDay(null) }}
        >
          <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', padding: '20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', border: '1px solid var(--border)', borderBottom: 'none', maxHeight: '70dvh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}>
                {pickerDayLabel} — ASSIGN DAY
              </span>
              <button
                onClick={() => setPickerDay(null)}
                style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={13} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PickerOption
                label="REST DAY"
                selected={!currentAssignment}
                onClick={() => assign(pickerDay!, null)}
              />

              {workoutDays.length === 0 && (
                <p style={{ textAlign: 'center', padding: '16px 0', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '1.5px', fontWeight: 700 }}>
                  ADD WORKOUT DAYS FIRST
                </p>
              )}

              {workoutDays.map((day) => (
                <PickerOption
                  key={day.id}
                  label={day.name}
                  selected={currentAssignment === day.id}
                  onClick={() => assign(pickerDay!, day.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function PickerOption({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '14px 16px',
        textAlign: 'left',
        background: selected ? 'var(--accent-muted)' : 'var(--surface)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 10,
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: 15,
        color: selected ? 'var(--accent)' : 'var(--text-primary)',
      }}
    >
      {label}
    </button>
  )
}
