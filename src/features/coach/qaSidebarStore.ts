import { create } from 'zustand'

// UI state only for the Q&A sidebar (QA-SIDEBAR-TASKS.md §8.3) — TanStack
// Query owns every exchange this feature reads or writes; this store holds
// only pointers to what's currently open, so an accidental backdrop-tap
// close mid-workout doesn't lose the conversation or the half-typed
// question, the same reason restTimerStore.ts survives a set being logged.
//
// conversationSessionId isn't in §8.3's original shape — added because
// GymSession.tsx never remounts across a session transition (no `key` prop
// at its call site, and useScrollToCurrentSet.ts's own header already
// documents the same instance persisting across a session finishing). Without
// it, a plain conversationId would carry a finished session's conversation
// into a brand new one and fail the server's own category/session invariance
// check (qaHistory.ts's checkInvariance) on the very first question of the
// new session. QaPanel resets whenever this stops matching the sessionId
// it's rendered with — a genuine session change resets, an ordinary
// close/reopen of the *same* session does not.
interface QaSidebarState {
  activeTab: 'notes' | 'ask'
  conversationId: string | null
  conversationSessionId: string | null
  draft: string
  setActiveTab: (tab: 'notes' | 'ask') => void
  startConversation: (id: string, sessionId: string | null) => void
  setDraft: (draft: string) => void
  reset: () => void
}

export const useQaSidebarStore = create<QaSidebarState>((set) => ({
  activeTab: 'notes',
  conversationId: null,
  conversationSessionId: null,
  draft: '',
  setActiveTab: (tab) => set({ activeTab: tab }),
  startConversation: (id, sessionId) => set({ conversationId: id, conversationSessionId: sessionId }),
  setDraft: (draft) => set({ draft }),
  reset: () => set({ conversationId: null, conversationSessionId: null, draft: '' }),
}))
