import { create } from 'zustand'
import type { QaCategory } from '../../types'

// UI state only for the Q&A sidebar (QA-SIDEBAR-TASKS.md §8.3) — TanStack
// Query owns every exchange this feature reads or writes; this store holds
// only pointers to what's currently open, so an accidental backdrop-tap
// close mid-workout doesn't lose the conversation or the half-typed
// question, the same reason restTimerStore.ts survives a set being logged.
// Shared by both entry points (§8.1) — GymSession's in-session sheet and
// CoachAskTab's three category controls — since only one Q&A conversation is
// ever open at a time in this app.
//
// conversationSessionId and conversationCategory aren't in §8.3's original
// shape — added because a plain conversationId alone can't tell whether the
// conversation it points at still matches what's currently being asked.
// conversationSessionId: GymSession.tsx never remounts across a session
// transition (no `key` prop at its call site, and useScrollToCurrentSet.ts's
// own header already documents the same instance persisting across a
// session finishing) — without it, a finished session's conversation would
// carry into a brand new one. conversationCategory: §7.1 requires that
// switching category on CoachAskTab starts a new conversation rather than
// continuing the old one, and every non-in-session category shares the same
// `sessionId: null`, so sessionId alone can't distinguish "general" from
// "planning" the way it distinguishes in-session from not. QaPanel resets
// whenever either stops matching what it's rendered with — a genuine session
// or category change resets, an ordinary close/reopen of the same one does
// not.
interface QaSidebarState {
  activeTab: 'notes' | 'ask'
  conversationId: string | null
  conversationSessionId: string | null
  conversationCategory: QaCategory | null
  draft: string
  setActiveTab: (tab: 'notes' | 'ask') => void
  startConversation: (id: string, category: QaCategory, sessionId: string | null) => void
  setDraft: (draft: string) => void
  reset: () => void
}

export const useQaSidebarStore = create<QaSidebarState>((set) => ({
  activeTab: 'notes',
  conversationId: null,
  conversationSessionId: null,
  conversationCategory: null,
  draft: '',
  setActiveTab: (tab) => set({ activeTab: tab }),
  startConversation: (id, category, sessionId) =>
    set({ conversationId: id, conversationCategory: category, conversationSessionId: sessionId }),
  setDraft: (draft) => set({ draft }),
  reset: () => set({ conversationId: null, conversationSessionId: null, conversationCategory: null, draft: '' }),
}))
