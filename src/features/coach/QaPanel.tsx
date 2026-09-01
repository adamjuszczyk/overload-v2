import { useEffect } from 'react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { MAX_TURNS_PER_CONVERSATION } from './qaHistory'
import { useQaSidebarStore } from './qaSidebarStore'
import { useCoachQaConversation, useAskQuestion } from './useCoachQa'
import QaTranscript from './QaTranscript'
import QaComposer from './QaComposer'
import type { QaCategory } from '../../types'

interface QaPanelProps {
  category: QaCategory
  sessionId: string | null
  currentExerciseId?: string | null
}

// The conversation view (QA-SIDEBAR-TASKS.md §8.2) — shared by GymSession's
// in-session ASK tab (Phase 6) and the Coach page's ASK tab (Phase 7, not
// yet built). Takes category and sessionId as props so it never decides its
// own category (§7) — the call site does that.
export default function QaPanel({ category, sessionId, currentExerciseId = null }: QaPanelProps) {
  const isOnline = useOnlineStatus()
  const { conversationId, conversationSessionId, draft, setDraft, startConversation, reset } = useQaSidebarStore()

  // See qaSidebarStore.ts's header for why this check exists: a conversation
  // is bound to one sessionId for its whole life (server-enforced —
  // qaHistory.ts's checkInvariance), and GymSession.tsx never remounts
  // across a session change, so without this a finished session's
  // conversation would otherwise carry into a brand new one.
  useEffect(() => {
    if (conversationId !== null && conversationSessionId !== sessionId) {
      reset()
    }
  }, [sessionId, conversationId, conversationSessionId, reset])

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
    if (conversationId === null) startConversation(activeConversationId, sessionId)
    ask.mutate(
      { conversationId: activeConversationId, category, question, sessionId, currentExerciseId },
      { onSuccess: () => setDraft('') },
    )
  }

  return (
    <div>
      <QaTranscript exchanges={exchanges} />
      <QaComposer
        draft={draft}
        onDraftChange={setDraft}
        onSend={handleSend}
        isPending={ask.isPending}
        atTurnLimit={atTurnLimit}
        onNewConversation={reset}
        error={ask.isError ? (ask.error as Error).message : null}
      />
    </div>
  )
}
