import { useState } from 'react'
import CoachSessionAnalysisTab from './CoachSessionAnalysisTab'
import CoachWeekAnalysisTab from './CoachWeekAnalysisTab'

// Session/Week sub-tab container (COACH-WEEK-ANALYSIS-TASKS.md §4 step 8a /
// COACH-WEEK-ANALYSIS-SPEC.md §3). This container owns the sub-tab bar and
// always renders it; each sub-tab owns its own detail-view state (matching
// how CoachPage.tsx's outer Analysis/Context tab bar stays visible while
// this component swaps between its lists and a detail view) — so a detail
// view open in one sub-tab never hides which sub-tab you're in. Default
// 'session' — Session is the existing, proven feature; Week is new.
//
// The honest statement of this change, per TASKS §8a: the Session lists and
// detail view are identical to before (CoachSessionAnalysisTab.tsx is a
// verbatim body move, confirmed via diff — see CONTEXT.md); one additional
// tab bar row appears above them.

type SubTab = 'session' | 'week'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'session', label: 'SESSION' },
  { id: 'week', label: 'WEEK' },
]

export default function CoachAnalysisTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('session')

  return (
    <div>
      {/* Sub-tab bar — a lighter-weight nested bar than CoachPage.tsx's own
          outer Analysis/Context tabs (underline style, not filled pills),
          so the two-level hierarchy reads as page-tab > sub-tab, not two
          rows of equal visual weight. */}
      <div className="flex mt-6 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className="pb-2 text-xs font-bold tracking-widest"
            style={{
              color: activeSubTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              borderBottom: activeSubTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'session' ? <CoachSessionAnalysisTab /> : <CoachWeekAnalysisTab />}
    </div>
  )
}
