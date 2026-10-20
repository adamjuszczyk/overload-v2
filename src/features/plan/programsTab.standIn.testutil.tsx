import PlanTabs, { type PlanTab } from './PlanTabs'

// A stand-in for `ProgramsTab` (chunk 65) in the tests of Plan's shell: those tests prove what the shell does (which tab it opens, what a tab tap
// does, where it stays), not what PROGRAMS draws, which `ProgramsTab.test.tsx` proves. It draws what the real tab draws that the shell's tests
// act on: the PLAN | PROGRAMS tabs, PROGRAMS open, and one marker. (Whether PLAN is locked is the real tab's own business, from the run list it
// reads itself: `ProgramsTab.test.tsx`.)
// Used as `vi.mock('../programs/ProgramsTab', async () => ({ default: (await import('./programsTab.standIn.testutil')).default }))`.
export default function ProgramsTabStandIn({ onTab }: { onTab: (tab: PlanTab) => void }) {
  return (
    <div>
      <PlanTabs active="programs" onSelect={onTab} />
      <div>PROGRAMS TAB</div>
    </div>
  )
}
