import { supabase } from '../../lib/supabase'
import type { QaAskRequest, QaCategory, CoachQaExchange } from '../../types'
import type { QaContext } from './qaContext'

// v2_coach_qa_exchanges reads plus the POST to api/coach/ask.ts
// (QA-SIDEBAR-TASKS.md §8.2), following coachService.ts's shape exactly:
// snake_case row type kept separate from the camelCase public interface,
// explicit .eq('user_id', userId) defence-in-depth alongside RLS, and the
// same fetch-with-bearer-token pattern analyzeSession already uses for its
// own POST. api/coach/ask.ts's response body is already the camelCase
// CoachQaExchange shape (its own toCoachQaExchange builds it before
// returning), so no row-mapping is needed on that path — only on the direct
// Supabase read below.

type DbCoachQaExchange = {
  id: string
  user_id: string
  conversation_id: string
  turn_index: number
  category: QaCategory
  question: string
  answer: string
  context_snapshot: QaContext
  session_id: string | null
  model: string
  prompt_version: number
  input_tokens: number | null
  output_tokens: number | null
  history_turns_sent: number
  created_at: string
}

function toCoachQaExchange(row: DbCoachQaExchange): CoachQaExchange {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    turnIndex: row.turn_index,
    category: row.category,
    question: row.question,
    answer: row.answer,
    contextSnapshot: row.context_snapshot,
    sessionId: row.session_id,
    model: row.model,
    promptVersion: row.prompt_version,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    historyTurnsSent: row.history_turns_sent,
    createdAt: row.created_at,
  }
}

const QA_EXCHANGE_COLUMNS =
  'id, user_id, conversation_id, turn_index, category, question, answer, context_snapshot, session_id, model, prompt_version, input_tokens, output_tokens, history_turns_sent, created_at'

export async function fetchQaConversation(conversationId: string, userId: string): Promise<CoachQaExchange[]> {
  const { data, error } = await supabase
    .from('v2_coach_qa_exchanges')
    .select(QA_EXCHANGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .order('turn_index', { ascending: true })
  if (error) throw error
  return (data as unknown as DbCoachQaExchange[]).map(toCoachQaExchange)
}

export async function askQuestion(request: QaAskRequest): Promise<CoachQaExchange> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/api/coach/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(request),
  })
  const body = await res.json()
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? 'Ask failed')
  return body as CoachQaExchange
}
