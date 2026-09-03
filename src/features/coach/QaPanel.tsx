import { useEffect } from 'react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { MAX_TURNS_PER_CONVERSATION } from './qaHistory'
import { useQaSidebarStore, isStaleForSurface } from './qaSidebarStore'
import { useCoachQaConversation, useAskQuestion, seedNewQaConversation } from './useCoachQa'
import QaTranscript from './QaTranscript'
import QaComposer from './QaComposer'
import type { QaCategory } from '../../types'

interface QaPanelProps {
  category: QaCategory
  sessionId: string | null
  currentExerciseId?: string | null
}

// The conversation view (QA-SIDEBAR-TASKS.md §8.2) — shared by GymSession's
// in-session ASK tab (Phase 6) and the Coach page's ASK tab (Phase 7). Takes
// category and sessionId as props so it never decides its own category
// (§7) — the call site does that.
export default function QaPanel({ category, sessionId, currentExerciseId = null }: QaPanelProps) {
  const isOnline = useOnlineStatus()
  const { conversationId, ownerCategory, ownerSessionId, draft, setDraft, startConversation, reset } =
    useQaSidebarStore()

  // See qaSidebarStore.ts's header for why this check exists: a conversation
  // is bound to one category and sessionId for its whole life (server-
  // enforced — qaHistory.ts's checkInvariance), but neither GymSession.tsx
  // (no remount across a session change) nor CoachAskTab (a category switch
  // is just a local state change, §7.1) nor moving between the two entry
  // points naturally clears the old surface's state on its own.
  //
  // Keyed on "holding anything", not on the conversation alone: a draft
  // typed but never sent leaves conversationId null, so a conversation-only
  // check let an unsent in-session question follow the user to Coach → ASK
  // and sit in that composer under a different category (found by Phase 8's
  // review). The draft has an owner too. See isStaleForSurface's own header
  // for why this check lives in qaSidebarStore.ts rather than inline here.
  useEffect(() => {
    if (isStaleForSurface({ conversationId, draft, ownerCategory, ownerSessionId }, category, sessionId)) {
      reset()
    }
  }, [category, sessionId, conversationId, draft, ownerCategory, ownerSessionId, reset])

  const { data: exchanges = [] } = useCoachQaConversation(conversationId)
  const ask = useAskQuestion()

  // §8.4 — online-only, same "REQUIRES A CONNECTION" empty state as
  // CoachSessionAnalysisTab.tsx. Swapping the whole panel (rather than just
  // disabling the composer) is what keeps the NOTES tab fully usable while
  // ASK alone goes dark with no connection.
  if (!isOnline) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-sm font-bold" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          REQUIRES A CONNECTION
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Ask isn't available offline — reconnect to use it.
        </p>
      </div>
    )
  }

  const atTurnLimit = exchanges.length >= MAX_TURNS_PER_CONVERSATION

  function handleSend(question: string) {
    const activeConversationId = conversationId ?? crypto.randomUUID()
    if (conversationId === null) {
      // Seed before starting, both synchronously in this click: the query
      // this enables must never issue an initial fetch that races the
      // optimistic write. See seedNewQaConversation's own header.
      seedNewQaConversation(activeConversationId)
      startConversation(activeConversationId, category, sessionId)
    }
    ask.mutate(
      { conversationId: activeConversationId, category, question, sessionId, currentExerciseId },
      { onSuccess: () => setDraft('', category, sessionId) },
    )
  }

  return (
    <div>
      <QaTranscript exchanges={exchanges} category={category} />
      <QaComposer
        draft={draft}
        onDraftChange={(value) => setDraft(value, category, sessionId)}
        onSend={handleSend}
        isPending={ask.isPending}
        atTurnLimit={atTurnLimit}
        onNewConversation={reset}
        error={ask.isError ? (ask.error as Error).message : null}
      />
    </div>
  )
}
