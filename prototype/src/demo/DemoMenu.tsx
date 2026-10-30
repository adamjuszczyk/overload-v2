import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useDemo } from './demoStore'
import { useSettingsStore } from '@app/features/settings/settingsStore'
import { queryClient } from '@app/lib/queryClient'
import { seed } from './seed'
import { seedPlanner } from './plannerFixture'
import { useWorkoutSession } from './workoutFixture'
import { resetDrafts } from '../fakes/gym/sessionDrafts'
import { useRestTimerStore } from '@app/features/gym/restTimerStore'

// The states menu: every screen and state in the verdict list, one tap away.
// A screen added to the verdict list gets its row here; a state with no row is
// a missing state.
type Apply = (go: (path: string) => void, set: ReturnType<typeof useDemo.getState>['set']) => void
interface Entry { screen: string; item: string; empty: string; states: { label: string; apply: Apply }[] }

const base = { gate: 'none' as const, exemptStrip: false, afterUpdateSheet: false, online: true, queued: 0, updateState: 'ready' as const }

const workout = (state: 'w1' | 'warmupOpen' | 'allDone', rest: number | null): Apply => (go, set) => {
  resetDrafts()
  useWorkoutSession.getState().reset(state)
  if (rest === null) useRestTimerStore.getState().stop()
  else useRestTimerStore.setState({ startedAt: Date.now() - rest * 1000, isVisible: true, anchorId: null, targetSeconds: 120 })
  set(base)
  go('/today')
}

const ENTRIES: Entry[] = [
  {
    screen: 'Planner · 2 EXERCISES',
    item: '2, 3',
    empty: 'ADD AN EXERCISE (as 1.2).',
    states: [
      { label: 'Pull 1 with a superset', apply: (go, set) => { seedPlanner(); set(base); go('/program/planner') } },
      { label: 'Tempo picker', apply: (go, set) => { seedPlanner(); set({ ...base, openTempo: 'p-row' } as any); go('/program/planner') } },
    ],
  },
  {
    screen: 'PREVIEW SESSION',
    item: '4',
    empty: 'An exercise with no sets: NO SETS PLANNED. No exercises: "No exercises in this workout yet."',
    states: [
      { label: 'New design', apply: (go, set) => { set(base); go('/today/preview') } },
      { label: 'Week not planned yet', apply: (go, set) => { set(base); go('/today/preview-no-sets') } },
      { label: '1.2 today (for comparison)', apply: (go, set) => { set(base); go('/today/preview-1.2') } },
    ],
  },
  {
    screen: 'Workout',
    item: '5, 6, 12–15, 21',
    empty: 'A workout always has its planned sets.',
    states: [
      { label: 'In progress (board W1)', apply: workout('w1', 72) },
      { label: 'Warmup up next', apply: workout('warmupOpen', 40) },
      { label: 'All sets done', apply: workout('allDone', 20) },
    ],
  },
  {
    screen: 'Programs · YOUR PROGRAMS',
    item: '8a',
    empty: 'No programs yet (unchanged from 1.2).',
    states: [
      { label: 'Normal', apply: (go, set) => { seed(); set(base); go('/program') } },
      { label: 'Delete', apply: (go, set) => { seed(); set({ ...base, openDelete: 'saved' }); go('/program') } },
      { label: 'Delete offline', apply: (go, set) => { seed(); set({ ...base, online: false, openDelete: 'saved' }); go('/program') } },
      { label: 'No programs', apply: (go, set) => { seed(); queryClient.setQueryData(['v2_programs', 'saved'], []); queryClient.setQueryData(['v2_mesos'], []); set(base); go('/program') } },
    ],
  },
  {
    screen: 'Finished program',
    item: '8b',
    empty: 'NO WEEKS WERE PLANNED (unchanged from 1.2).',
    states: [
      { label: 'Cut PPL, 10 weeks', apply: (go, set) => { seed(); set(base); go('/program/finished/m-cut') } },
      { label: 'False start, 1 week', apply: (go, set) => { seed(); set(base); go('/program/finished/m-ppl2') } },
      { label: 'Delete', apply: (go, set) => { seed(); set({ ...base, openDelete: 'finished' }); go('/program/finished/m-cut') } },
      { label: 'Delete, no Coach rows', apply: (go, set) => { seed(); set({ ...base, openDelete: 'finished' }); go('/program/finished/m-ppl2') } },
      { label: 'Delete offline', apply: (go, set) => { seed(); set({ ...base, online: false, openDelete: 'finished' }); go('/program/finished/m-cut') } },
    ],
  },
  {
    screen: "Settings · WHAT'S NEW",
    item: '9',
    empty: 'Never empty: 1.2 is seeded.',
    states: [
      { label: 'Normal', apply: (go, set) => { set(base); go('/settings') } },
      { label: 'Offline', apply: (go, set) => { set({ ...base, online: false }); go('/settings') } },
    ],
  },
  {
    screen: 'Release notes',
    item: '9',
    empty: 'Every release has notes.',
    states: [
      { label: '1.2.1 (sample)', apply: (go, set) => { set(base); go('/settings/whats-new/1.2.1') } },
      { label: '1.2', apply: (go, set) => { set(base); go('/settings/whats-new/1.2') } },
    ],
  },
  {
    screen: 'After an update',
    item: '9',
    empty: '—',
    states: [{ label: 'Notes, once', apply: (go, set) => { set({ ...base, afterUpdateSheet: true }); go('/settings') } }],
  },
  {
    screen: 'Finished program · PRIORITIES',
    item: '1',
    empty: 'No priorities were set for this program.',
    states: [
      { label: 'Marks (1.1 and later)', apply: (go, set) => { seed(); set(base); go('/program/finished/m-cut/priorities') } },
      { label: 'Old marks (pre-1.1)', apply: (go, set) => { seed(); set(base); go('/program/finished/m-old/priorities') } },
      { label: 'None set', apply: (go, set) => { seed(); set(base); go('/program/finished/m-ppl2/priorities') } },
    ],
  },
  {
    screen: 'Maintenance',
    item: '10',
    empty: '—',
    states: [
      { label: 'Screen', apply: (_g, set) => set({ ...base, gate: 'maintenance' }) },
      { label: 'Offline changes waiting', apply: (_g, set) => set({ ...base, gate: 'maintenance', queued: 3 }) },
      { label: 'Your account', apply: (go, set) => { set({ ...base, exemptStrip: true }); go('/settings') } },
    ],
  },
  {
    screen: 'Update to continue',
    item: '11',
    empty: '—',
    states: [
      { label: 'Ready', apply: (_g, set) => set({ ...base, gate: 'update' }) },
      { label: 'Unsent changes', apply: (_g, set) => set({ ...base, gate: 'update', queued: 3 }) },
      { label: 'Updating', apply: (_g, set) => set({ ...base, gate: 'update', updateState: 'updating' }) },
      { label: "Couldn't update", apply: (_g, set) => set({ ...base, gate: 'update', updateState: 'failed', online: false }) },
    ],
  },
]

const mono: CSSProperties = { fontFamily: 'var(--font-mono)' }
const chip: CSSProperties = { ...mono, minHeight: 36, padding: '0 12px', borderRadius: 10, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)', cursor: 'pointer' }

export function DemoButton() {
  const set = useDemo((s) => s.set)
  return (
    <button
      type="button"
      onClick={() => set({ menuOpen: true })}
      style={{ ...mono, position: 'fixed', right: 'env(safe-area-inset-right, 0px)', top: '42%', zIndex: 90, height: 64, width: 22, padding: 0, writingMode: 'vertical-rl', borderRadius: '10px 0 0 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', background: 'var(--staging)', color: 'var(--staging-text)', border: 'none', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }}
    >
      DEMO
    </button>
  )
}

export function DemoMenu() {
  const navigate = useNavigate()
  const set = useDemo((s) => s.set)
  const theme = useSettingsStore((s) => s.theme)
  const hydrate = useSettingsStore((s) => s.hydrate)
  const go = (path: string) => navigate(path)
  const close = () => set({ menuOpen: false })
  return (
    <div data-demo-menu style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'var(--base)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'calc(14px + env(safe-area-inset-top)) 16px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ ...mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--staging)' }}>DEMO · OVERLOAD 1.2.1 PROTOTYPE</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 20, color: 'var(--text-primary)' }}>SCREENS AND STATES</span>
        </div>
        <button type="button" onClick={close} aria-label="Close" style={{ marginLeft: 'auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)' }}>
          <X size={18} />
        </button>
      </div>
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 32px', minHeight: 0 }}>
        {ENTRIES.map((e) => (
          <div key={e.screen} style={{ padding: '14px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{e.screen}</span>
              <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>ITEM {e.item}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {e.states.map((s) => (
                <button key={s.label} type="button" data-demo-state={`${e.screen} · ${s.label}`} style={chip} onClick={() => { s.apply(go, set); close() }}>{s.label}</button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Empty state: {e.empty}</span>
          </div>
        ))}
        <div style={{ padding: '16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>THEME</span>
          {(['dark', 'light'] as const).map((t) => (
            <button key={t} type="button" onClick={() => hydrate({ ...(useSettingsStore.getState() as any), theme: t })}
              style={{ ...chip, background: theme === t ? 'var(--accent)' : 'var(--surface-raised)', color: theme === t ? 'var(--on-accent)' : 'var(--text-primary)', border: theme === t ? 'none' : chip.border }}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
