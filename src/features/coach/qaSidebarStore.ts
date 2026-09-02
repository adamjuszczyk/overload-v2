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
// ownerCategory/ownerSessionId aren't in §8.3's original shape. They name
// the surface everything else in this store belongs to — the conversation
// *and* the unsent draft alike — because a conversationId alone can't tell
// whether what's held still matches what's currently being asked, and
// nothing else clears it:
//
//   - GymSession.tsx never remounts across a session transition (no `key`
//     prop at its call site, and useScrollToCurrentSet.ts's own header
//     already documents the same instance persisting across a session
//     finishing), so a finished session's conversation would otherwise
//     carry into a brand new one and fail the server's own invariance check
//     (qaHistory.ts's checkInvariance) on the new session's first question.
//   - §7.1 requires that switching category on CoachAskTab starts a new
//     conversation rather than continuing the old one, and every
//     non-in-session category shares the same `sessionId: null`, so
//     sessionId alone can't distinguish "general" from "planning" the way
//     it distinguishes in-session from not.
//   - Moving between the two entry points entirely — an unsent question
//     typed mid-workout, then Coach → ASK — changes the surface without
//     either of the above firing. Phase 8's review found this: the draft
//     followed the user across, because it was tracked by neither. It is
//     the draft, not just the conversation, that has an owner.
//
// Set by whichever comes first, startConversation or setDraft — both
// record the same surface. QaPanel resets whenever this store is holding
// something and the owner stops matching what QaPanel is rendered with: a
// genuine session, category or entry-point change resets, an ordinary
// close/reopen of the same one does not.
interface QaSidebarState {
  activeTab: 'notes' | 'ask'
  conversationId: string | null
  ownerCategory: QaCategory | null
  ownerSessionId: string | null
  draft: string
  setActiveTab: (tab: 'notes' | 'ask') => void
  startConversation: (id: string, category: QaCategory, sessionId: string | null) => void
  setDraft: (draft: string, category: QaCategory, sessionId: string | null) => void
  reset: () => void
}

export const useQaSidebarStore = create<QaSidebarState>((set) => ({
  activeTab: 'notes',
  conversationId: null,
  ownerCategory: null,
  ownerSessionId: null,
  draft: '',
  setActiveTab: (tab) => set({ activeTab: tab }),
  startConversation: (id, category, sessionId) =>
    set({ conversationId: id, ownerCategory: category, ownerSessionId: sessionId }),
  // Draft and owner move together in one set() — so the effect that watches
  // for a mismatch can never observe a freshly typed character still
  // carrying the previous surface's owner and wipe it.
  setDraft: (draft, category, sessionId) => set({ draft, ownerCategory: category, ownerSessionId: sessionId }),
  reset: () => set({ conversationId: null, ownerCategory: null, ownerSessionId: null, draft: '' }),
}))
