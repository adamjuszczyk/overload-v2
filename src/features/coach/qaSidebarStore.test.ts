import { describe, it, expect, beforeEach } from 'vitest'
import { useQaSidebarStore, isStaleForSurface } from './qaSidebarStore'
import type { QaCategory } from '../../types'

// qaSidebarStore.ts and QaPanel.tsx were, until this file, the only two
// files in src/features/coach/ with no test coverage — and also the source
// of all three real bugs found across Phases 6-8 (conversationSessionId,
// the category-switch draft leak, the unsent-draft-follows-you-to-a-
// different-tab bug). All three turned out to be one shape: the store is a
// module singleton shared across more than one logical "surface" (session x
// category x entry point), and the key used to decide "this state is stale,
// clear it" covered fewer dimensions than the state space actually had.
//
// isStaleForSurface is the one guard that shape needs, pulled out of
// QaPanel's effect so this file tests the real guard the app runs, not a
// reimplementation of it that could quietly drift out of sync. Below:
// regression coverage for the three known bugs, then exhaustive pairwise
// coverage across every surface this app can actually produce, so a fourth
// instance of the same shape — in a combination nobody has hit yet — fails
// loudly here instead of in production.

function resetStore() {
  useQaSidebarStore.setState({
    activeTab: 'notes',
    conversationId: null,
    ownerCategory: null,
    ownerSessionId: null,
    draft: '',
  })
}

beforeEach(resetStore)

describe('useQaSidebarStore actions', () => {
  it('starts empty, owned by nothing', () => {
    const state = useQaSidebarStore.getState()
    expect(state.activeTab).toBe('notes')
    expect(state.conversationId).toBeNull()
    expect(state.ownerCategory).toBeNull()
    expect(state.ownerSessionId).toBeNull()
    expect(state.draft).toBe('')
  })

  it('setActiveTab touches only activeTab', () => {
    useQaSidebarStore.getState().startConversation('conv-1', 'general', null)
    useQaSidebarStore.getState().setActiveTab('ask')
    const state = useQaSidebarStore.getState()
    expect(state.activeTab).toBe('ask')
    expect(state.conversationId).toBe('conv-1')
    expect(state.ownerCategory).toBe('general')
    expect(state.ownerSessionId).toBeNull()
  })

  it('startConversation sets conversationId and the owner fields together', () => {
    useQaSidebarStore.getState().startConversation('conv-1', 'in_session', 'session-A')
    const state = useQaSidebarStore.getState()
    expect(state.conversationId).toBe('conv-1')
    expect(state.ownerCategory).toBe('in_session')
    expect(state.ownerSessionId).toBe('session-A')
  })

  it('setDraft sets draft and the owner fields together, even with no conversation started yet', () => {
    // The exact shape of the Phase 8 bug: before it was fixed, the owner
    // fields were only ever written by startConversation, so a draft typed
    // before any message was sent carried no owner at all.
    useQaSidebarStore.getState().setDraft('half-typed question', 'planning', null)
    const state = useQaSidebarStore.getState()
    expect(state.conversationId).toBeNull()
    expect(state.draft).toBe('half-typed question')
    expect(state.ownerCategory).toBe('planning')
    expect(state.ownerSessionId).toBeNull()
  })

  it('reset clears the conversation, owner and draft, but leaves activeTab alone', () => {
    useQaSidebarStore.getState().setActiveTab('ask')
    useQaSidebarStore.getState().startConversation('conv-1', 'general', null)
    useQaSidebarStore.getState().setDraft('more', 'general', null)
    useQaSidebarStore.getState().reset()
    const state = useQaSidebarStore.getState()
    expect(state.conversationId).toBeNull()
    expect(state.ownerCategory).toBeNull()
    expect(state.ownerSessionId).toBeNull()
    expect(state.draft).toBe('')
    expect(state.activeTab).toBe('ask')
  })
})

describe('isStaleForSurface — the single invariant, as regression coverage for the three known bugs', () => {
  it('regression (Phase 6): a session transition with no component remount', () => {
    // GymSession.tsx never remounts across a session finishing, so the
    // store's own state is the only thing that can tell the new session's
    // sessionId apart from the finished one's.
    useQaSidebarStore.getState().startConversation('conv-1', 'in_session', 'session-A')
    const state = useQaSidebarStore.getState()
    expect(isStaleForSurface(state, 'in_session', 'session-A')).toBe(false)
    expect(isStaleForSurface(state, 'in_session', 'session-B')).toBe(true)
  })

  it('regression (Phase 7): a category switch that shares sessionId: null with every other non-in_session category', () => {
    useQaSidebarStore.getState().startConversation('conv-1', 'general', null)
    const state = useQaSidebarStore.getState()
    // sessionId is null on both sides — only ownerCategory can catch this.
    expect(isStaleForSurface(state, 'planning', null)).toBe(true)
    expect(isStaleForSurface(state, 'app_mechanics', null)).toBe(true)
    expect(isStaleForSurface(state, 'general', null)).toBe(false)
  })

  it('regression (Phase 8): an unsent draft, never sent, carries an owner too', () => {
    // Typed mid-workout (in_session), never sent — conversationId stays
    // null the whole time, which is exactly the case a conversation-only
    // check missed.
    useQaSidebarStore.getState().setDraft('should I deload?', 'in_session', 'session-A')
    const state = useQaSidebarStore.getState()
    expect(isStaleForSurface(state, 'in_session', 'session-A')).toBe(false)
    // Moving to Coach -> ASK's general tab: different category, different
    // (null) sessionId.
    expect(isStaleForSurface(state, 'general', null)).toBe(true)
  })

  it('after reset(), the previous surface leaves nothing behind for the next one', () => {
    useQaSidebarStore.getState().setDraft('should I deload?', 'in_session', 'session-A')
    useQaSidebarStore.getState().reset()
    const state = useQaSidebarStore.getState()
    expect(state.conversationId).toBeNull()
    expect(state.draft).toBe('')
    expect(isStaleForSurface(state, 'general', null)).toBe(false)
    expect(isStaleForSurface(state, 'in_session', 'session-A')).toBe(false)
  })
})

describe('isStaleForSurface — empty store is never stale', () => {
  const SURFACES: { category: QaCategory; sessionId: string | null }[] = [
    { category: 'general', sessionId: null },
    { category: 'planning', sessionId: null },
    { category: 'app_mechanics', sessionId: null },
    { category: 'in_session', sessionId: 'session-A' },
    { category: 'in_session', sessionId: 'session-B' },
  ]

  it.each(SURFACES)('a fresh, never-written store is not stale for %o', (surface) => {
    const state = useQaSidebarStore.getState()
    expect(isStaleForSurface(state, surface.category, surface.sessionId)).toBe(false)
  })
})

describe('isStaleForSurface — exhaustive pairwise coverage across every surface this app can produce', () => {
  // Every category the app routes to real conversations (QA_ROUTES), plus
  // two distinct real sessionIds for in_session — the one category where
  // sessionId actually varies. 5 surfaces x 5 surfaces x 2 write modes
  // (a started conversation, and a draft with no conversation yet) = 50
  // checks, covering every combination this store can actually be asked
  // about, not just the three that happened to ship a bug first.
  const SURFACES: { name: string; category: QaCategory; sessionId: string | null }[] = [
    { name: 'general', category: 'general', sessionId: null },
    { name: 'planning', category: 'planning', sessionId: null },
    { name: 'app_mechanics', category: 'app_mechanics', sessionId: null },
    { name: 'in_session/A', category: 'in_session', sessionId: 'session-A' },
    { name: 'in_session/B', category: 'in_session', sessionId: 'session-B' },
  ]

  function isSameSurface(
    a: { category: QaCategory; sessionId: string | null },
    b: { category: QaCategory; sessionId: string | null },
  ): boolean {
    return a.category === b.category && a.sessionId === b.sessionId
  }

  describe('via a started conversation', () => {
    for (const from of SURFACES) {
      for (const to of SURFACES) {
        it(`owning ${from.name}, checked against ${to.name} -> stale iff different surface`, () => {
          resetStore()
          useQaSidebarStore.getState().startConversation('conv-1', from.category, from.sessionId)
          const state = useQaSidebarStore.getState()
          expect(isStaleForSurface(state, to.category, to.sessionId)).toBe(!isSameSurface(from, to))
        })
      }
    }
  })

  describe('via a draft only, no conversation started', () => {
    for (const from of SURFACES) {
      for (const to of SURFACES) {
        it(`drafting under ${from.name}, checked against ${to.name} -> stale iff different surface`, () => {
          resetStore()
          useQaSidebarStore.getState().setDraft('unsent question', from.category, from.sessionId)
          const state = useQaSidebarStore.getState()
          expect(isStaleForSurface(state, to.category, to.sessionId)).toBe(!isSameSurface(from, to))
        })
      }
    }
  })
})

describe('activeTab is independent of surface ownership', () => {
  it('switching NOTES/ASK never touches the conversation, draft or owner fields', () => {
    useQaSidebarStore.getState().startConversation('conv-1', 'in_session', 'session-A')
    useQaSidebarStore.getState().setDraft('typing more', 'in_session', 'session-A')
    useQaSidebarStore.getState().setActiveTab('notes')
    useQaSidebarStore.getState().setActiveTab('ask')
    const state = useQaSidebarStore.getState()
    expect(state.conversationId).toBe('conv-1')
    expect(state.draft).toBe('typing more')
    expect(state.ownerCategory).toBe('in_session')
    expect(state.ownerSessionId).toBe('session-A')
  })

  it('is not a parameter of isStaleForSurface, so a tab switch alone can never trigger a reset', () => {
    useQaSidebarStore.getState().startConversation('conv-1', 'general', null)
    const beforeTab = isStaleForSurface(useQaSidebarStore.getState(), 'general', null)
    useQaSidebarStore.getState().setActiveTab('notes')
    const afterTab = isStaleForSurface(useQaSidebarStore.getState(), 'general', null)
    expect(beforeTab).toBe(false)
    expect(afterTab).toBe(false)
  })
})

describe('a realistic multi-step transition sequence, exercising several surface changes in one run', () => {
  it('session -> category switch -> entry point switch -> back, with no leaked state at any step', () => {
    // 1. In-session conversation on session A, sent for real.
    useQaSidebarStore.getState().startConversation('conv-1', 'in_session', 'session-A')
    let state = useQaSidebarStore.getState()
    expect(isStaleForSurface(state, 'in_session', 'session-A')).toBe(false)

    // 2. That same session finishes; GymSession.tsx doesn't remount, so the
    // next render still asks about session A's sheet re-opening — fine, the
    // conversation is still current until a *new* session starts.
    expect(isStaleForSurface(useQaSidebarStore.getState(), 'in_session', 'session-A')).toBe(false)

    // 3. A new workout starts (session B). QaPanel now renders with a
    // different sessionId prop -> stale -> reset.
    state = useQaSidebarStore.getState()
    expect(isStaleForSurface(state, 'in_session', 'session-B')).toBe(true)
    useQaSidebarStore.getState().reset()

    // 4. Mid-way through session B, a question is typed but never sent,
    // then the user leaves the sheet for Coach -> ASK (general).
    useQaSidebarStore.getState().setDraft('how much volume left?', 'in_session', 'session-B')
    state = useQaSidebarStore.getState()
    expect(isStaleForSurface(state, 'general', null)).toBe(true)
    useQaSidebarStore.getState().reset()

    // 5. A real general conversation starts and is sent.
    useQaSidebarStore.getState().startConversation('conv-2', 'general', null)
    state = useQaSidebarStore.getState()
    expect(isStaleForSurface(state, 'general', null)).toBe(false)

    // 6. Category switch to planning, still on CoachAskTab (sessionId stays
    // null throughout) -> stale on category alone.
    expect(isStaleForSurface(useQaSidebarStore.getState(), 'planning', null)).toBe(true)
    useQaSidebarStore.getState().reset()

    // 7. Back to session B's in-session sheet -> nothing left over from any
    // of the five surfaces visited above.
    state = useQaSidebarStore.getState()
    expect(state.conversationId).toBeNull()
    expect(state.draft).toBe('')
    expect(isStaleForSurface(state, 'in_session', 'session-B')).toBe(false)
  })
})
