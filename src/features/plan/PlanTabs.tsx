import type { CSSProperties } from 'react'

// Chunk 52 (TASKS-1.2 "Plan's header"; SPEC Screens → Plan screen → Header (1, 8a), Navigation and settings [1.2] → PLAN | PROGRAMS (8);
// boards 1, 1b, 1c, 1d, PR1). The two tabs at the top of Plan, PLAN and PROGRAMS, the open one underlined in the accent. Plan's own
// screen is the PLAN tab; until chunk 65 rebuilds it, the PROGRAMS tab draws today's Programs page under these tabs (P1.2-12).

export type PlanTab = 'plan' | 'programs'

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

export default function PlanTabs({ active, onSelect }: { active: PlanTab; onSelect: (tab: PlanTab) => void }) {
  return (
    <div role="tablist" aria-label="Plan or programs" style={{ display: 'flex', alignItems: 'flex-end', gap: 20, minHeight: 44 }}>
      {(['plan', 'programs'] as const).map((tab) => {
        const selected = tab === active
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab)}
            style={{ ...TAB, borderBottomColor: selected ? 'var(--accent)' : 'transparent', color: selected ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {tab === 'plan' ? 'PLAN' : 'PROGRAMS'}
          </button>
        )
      })}
    </div>
  )
}
