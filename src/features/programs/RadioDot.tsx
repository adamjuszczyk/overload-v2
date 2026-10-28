// The radio mark of the PROGRAMS tab's two sheets (PR8-PR12's PROGRAM list and PR13's SCHEDULE and PLANNING options): a ring and, when the
// option is the picked one, a dot in it, both in the accent. The row it sits in says the rest (a tinted row, the name in the accent); the mark
// itself has no text, so its dot is one of the accent backgrounds with nothing to read on them (`textOnAccent.static.test.ts`).
export default function RadioDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        width: 18,
        height: 18,
        boxSizing: 'border-box',
        borderRadius: 9,
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} />}
    </span>
  )
}
