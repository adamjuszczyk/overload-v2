import { useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { fetchQaConversation, askQuestion } from './qaService'
import type { QaAskRequest, CoachQaExchange } from '../../types'

// TanStack Query hooks for the Q&A sidebar (QA-SIDEBAR-TASKS.md §8.3) — the
// conversation cache is the only place an exchange (question or answer) is
// ever held. qaSidebarStore.ts holds nothing but the pointer to which
// conversation is open, never a copy of its contents.

export function qaConversationKey(conversationId: string) {
  return ['v2_coachQaConversation', conversationId]
}

export function useCoachQaConversation(conversationId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: qaConversationKey(conversationId ?? ''),
    queryFn: () => fetchQaConversation(conversationId as string, user!.id),
    enabled: !!user && !!conversationId,
  })
}

// A pending question renders immediately via this optimistic entry (§8.3:
// "an optimistic pending question, if one is wanted, goes into the TanStack
// cache via onMutate — exactly the pattern useCreateCoachNote already
// uses"). A real generation is a multi-second wait (Phase 4 measured
// 6.3-23.7s) — showing nothing until it resolves would read as broken.
// `pending` is a client-only marker QaTranscript uses to render a spinner
// instead of `answer`; it is never sent to the server, and onSuccess/
// onError both replace or remove this exact entry by id before anything
// else can read it.
export type QaTranscriptItem = CoachQaExchange & { pending?: boolean }

type AskParams = Omit<QaAskRequest, 'id'>

export function useAskQuestion() {
  const { user } = useAuth()
  const tempIdRef = useRef<string | null>(null)

  return useMutation({
    // Same shared-ref trick useCreateCoachNote uses: onMutate sets this
    // before mutationFn runs, so the real inserted row's id is the exact
    // same id the optimistic entry was keyed on — reconciliation by id
    // needs no second lookup.
    mutationFn: (params: AskParams) => {
      const id = tempIdRef.current ?? crypto.randomUUID()
      return askQuestion({ ...params, id })
    },

    onMutate: async (params) => {
      const tempId = crypto.randomUUID()
      tempIdRef.current = tempId
      const key = qaConversationKey(params.conversationId)

      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData<QaTranscriptItem[]>(key)

      const optimistic: QaTranscriptItem = {
        id: tempId,
        userId: user!.id,
        conversationId: params.conversationId,
        turnIndex: prev?.length ?? 0,
        category: params.category,
        question: params.question,
        answer: '',
        // Placeholder only — QaTranscript never reads contextSnapshot, and
        // this entry is replaced or rolled back before anything else could.
        contextSnapshot: { kind: params.category, payload: {} } as unknown as CoachQaExchange['contextSnapshot'],
        sessionId: params.sessionId,
        model: '',
        promptVersion: 0,
        inputTokens: null,
        outputTokens: null,
        historyTurnsSent: 0,
        createdAt: new Date().toISOString(),
        pending: true,
      }
      queryClient.setQueryData<QaTranscriptItem[]>(key, (old) => [...(old ?? []), optimistic])

      return { prev, key }
    },

    onError: (_err, _params, ctx) => {
      tempIdRef.current = null
      if (ctx) queryClient.setQueryData(ctx.key, ctx.prev)
    },

    onSuccess: (exchange, params) => {
      tempIdRef.current = null
      const key = qaConversationKey(params.conversationId)
      queryClient.setQueryData<QaTranscriptItem[]>(key, (old) =>
        old ? old.map((e) => (e.id === exchange.id ? exchange : e)) : [exchange],
      )
    },
  })
}
