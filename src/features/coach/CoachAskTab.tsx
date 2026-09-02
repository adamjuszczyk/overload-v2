import { useState } from 'react'
import QaPanel from './QaPanel'
import { useQaSidebarStore } from './qaSidebarStore'
import type { QaCategory } from '../../types'

// The Coach page's ASK tab (QA-SIDEBAR-TASKS.md §8.1/§8.2) — three category
// controls, then QaPanel for whichever is selected. Sub-tab bar styled in
// the same spirit as CoachAnalysisTab.tsx's Session/Week rows (underline,
// not filled pills) — same page-tab > sub-selection hierarchy, one level
// lighter than CoachPage.tsx's own outer tab bar. Laid out as an equal-width
// 3-column grid rather than CoachAnalysisTab's plain flex row: unlike
// SESSION/WEEK's two short words, these three labels don't fit on one line
// at mobile width (checked live at 375px) — a grid gives each one a
// predictable, centered two-line wrap instead of an uneven flex-basis one.
//
// §7.2's three non-session call sites, each hardcoded to its own category —
// never a single input with a dropdown (§7.2's own reasoning: a dropdown
// technically satisfies "not inferred by the model" while reintroducing the
// exact failure it protects against).
//
// The switch itself calls qaSidebarStore's reset() directly, rather than
// leaning only on QaPanel's own conversationCategory mismatch effect: that
// effect only fires once conversationId is non-null (i.e. a message has
// actually been sent), so switching categories before ever sending one would
// otherwise leave a typed-but-unsent draft attached to the new category's
// composer — harmless (nothing money-spending or server-side is at stake
// before a send), but a confusing leftover. Resetting here clears it
// immediately, and still leaves QaPanel's own check as the structural
// backstop for any other path that could change category or sessionId.

const CATEGORIES: { id: Exclude<QaCategory, 'in_session'>; label: string }[] = [
  { id: 'general', label: 'ABOUT TRAINING' },
  { id: 'planning', label: 'ABOUT PLANNING' },
  { id: 'app_mechanics', label: 'HOW THIS APP WORKS' },
]

export default function CoachAskTab() {
  const [category, setCategory] = useState<Exclude<QaCategory, 'in_session'>>('general')
  const reset = useQaSidebarStore((s) => s.reset)

  function handleSelect(next: Exclude<QaCategory, 'in_session'>) {
    if (next === category) return
    reset()
    setCategory(next)
  }

  return (
    <div className="mt-6">
      <div className="grid grid-cols-3 gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => handleSelect(c.id)}
            className="pb-2 text-xs font-bold tracking-widest text-center leading-tight"
            style={{
              color: category === c.id ? 'var(--text-primary)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              borderBottom: category === c.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <QaPanel category={category} sessionId={null} />
      </div>
    </div>
  )
}
