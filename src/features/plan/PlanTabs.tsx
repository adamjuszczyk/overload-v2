import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Lock } from 'lucide-react'

// Chunk 52 (TASKS-1.2 "Plan's header"; SPEC Screens → Plan screen → Header (1, 8a), Navigation and settings [1.2] → PLAN | PROGRAMS (8);
// boards 1, 1b, 1c, 1d, PR1). The two tabs at the top of Plan, PLAN and PROGRAMS, the open one underlined in the accent. Plan's own
// screen is the PLAN tab; PROGRAMS is chunk 65's tab.
//
// Chunk 65 (SPEC: "With no program running it opens on PROGRAMS; PLAN shows a lock, and tapping it shows 'Start a program to plan your
// weeks.' (PR2)"): `planLocked` draws PLAN dimmed with a lock after it (PR1's `aria-disabled` PLAN link: `--text-dim`, a 14 px lock), and
// a tap on it opens the hint, a dark bubble under the tab with an arrow at it (PR2), instead of opening Plan. The hint closes with a second
// tap on PLAN, with a tap anywhere else (the board draws no way to close it; this is the least a bubble needs, ours, D31), and with the lock.
// The bubble is placed against the header that holds the tabs, as the board has it (left 12, top 64 of the header), so the header must be
// `position: relative`; an unlocked PlanTabs (Plan's own header) draws exactly what it drew before.

export type PlanTab = 'plan' | 'programs'

/** PR2's hint under the locked PLAN tab. */
export const PLAN_LOCKED_HINT = 'Start a program to plan your weeks.'

const TAB: CSSProperties = {
  paddingBottom: 6,
  paddingTop: 0,
  paddingLeft: 0,
  paddingRight: 0,
  borderWidth: 0,
  borderBottomWidth: 3,
  borderBottomStyle: 'solid',
  background: 'transparent',
  fontFamily: 'var(--font-display)',
  fontWeight: 900,
  fontSize: 30,
  lineHeight: 1,
  letterSpacing: '-0.01em',
  cursor: 'pointer',
}

// PR2's bubble: near-black on the page colour (the text colours swap places), 10 px corners, a 12 px square turned 45° for the arrow.
const BUBBLE: CSSProperties = {
  position: 'absolute',
  left: 12,
  top: 64,
  zIndex: 2,
  maxWidth: 300,
  boxSizing: 'border-box',
  padding: '12px 14px',
  borderRadius: 10,
  background: 'var(--text-primary)',
  color: 'var(--base)',
  fontWeight: 700,
  fontSize: 14,
  boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
}

const ARROW: CSSProperties = {
  position: 'absolute',
  left: 30,
  top: -6,
  width: 12,
  height: 12,
  background: 'var(--text-primary)',
  transform: 'rotate(45deg)',
}

export default function PlanTabs({ active, onSelect, planLocked = false }: { active: PlanTab; onSelect: (tab: PlanTab) => void; planLocked?: boolean }) {
  const [hint, setHint] = useState(false)
  const planTab = useRef<HTMLButtonElement>(null)

  // The hint explains the lock, so it goes when the lock does.
  useEffect(() => {
    if (!planLocked) setHint(false)
  }, [planLocked])

  // A tap anywhere but on PLAN itself (that one toggles it) puts it away.
  useEffect(() => {
    if (!hint) return
    function tapAway(event: Event) {
      if (!planTab.current?.contains(event.target as Node)) setHint(false)
    }
    document.addEventListener('pointerdown', tapAway)
    return () => document.removeEventListener('pointerdown', tapAway)
  }, [hint])

  return (
    <>
      <div role="tablist" aria-label="Plan or programs" style={{ display: 'flex', alignItems: 'flex-end', gap: 20, minHeight: 44 }}>
        {(['plan', 'programs'] as const).map((tab) => {
          const selected = tab === active
          const locked = tab === 'plan' && planLocked
          return (
            <button
              key={tab}
              ref={tab === 'plan' ? planTab : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-disabled={locked ? true : undefined}
              onClick={() => (locked ? setHint((open) => !open) : onSelect(tab))}
              style={{
                ...TAB,
                ...(locked ? { display: 'flex', alignItems: 'center', gap: 6 } : null),
                borderBottomColor: selected ? 'var(--accent)' : 'transparent',
                color: selected ? 'var(--text-primary)' : locked ? 'var(--text-dim)' : 'var(--text-muted)',
              }}
            >
              {tab === 'plan' ? 'PLAN' : 'PROGRAMS'}
              {locked && <Lock size={14} strokeWidth={2.5} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      {planLocked && hint && (
        <div role="status" style={BUBBLE}>
          <span aria-hidden="true" style={ARROW} />
          {PLAN_LOCKED_HINT}
        </div>
      )}
    </>
  )
}
