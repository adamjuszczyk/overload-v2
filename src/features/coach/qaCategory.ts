import type { QaCategory } from '../../types/index.js'

// Category routing table (QA-SIDEBAR-TASKS.md §1.2, §5.4) — a lookup, not a
// branch, so adding a fifth category later is a row plus an assembler, and
// the routing itself is pure and Vitest-coverable rather than only
// testable by spending money on the real API.
//
// `assembler` names the qaContext.ts function this category's context
// comes from (TASKS §4) — a string key, not an import, since this module
// must stay zero-dependency and buildable before qaContext.ts exists
// (TASKS §9, Phase 2 vs. Phase 3). api/coach/ask.ts (Phase 5) is what turns
// the key into a real function call.
export type QaAssemblerName =
  | 'assembleInSessionContext'
  | 'assembleGeneralContext'
  | 'assemblePlanningContext'
  | 'assembleAppMechanicsContext'

export interface QaRoute {
  model: string
  assembler: QaAssemblerName
  maxTokens: number
  // Only ever set for the Sonnet 5 path (TASKS §5.4). Haiku 4.5 rejects
  // `effort` outright — a real 400, not a no-op — matching the fact that no
  // existing Haiku call site in this codebase (analyze.ts, analyze-week.ts,
  // curationRunner.ts) sets it either.
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

// Pinned dated snapshot, matching every other Haiku call site in this repo
// (analyze.ts, analyze-week.ts, curationRunner.ts) — `model` is stored per
// row (TASKS §2.1), so provenance matters the same way here.
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
// The model's own complete id — it takes no date suffix (TASKS §0.1
// correction 1); appending one would be an invalid id.
const SONNET_MODEL = 'claude-sonnet-5'

// 2,000 for the three Haiku categories; 8,000 for planning, since Sonnet
// 5's thinking tokens count toward max_tokens and a low ceiling would
// truncate the answer rather than the thinking (TASKS §5.4).
const HAIKU_MAX_TOKENS = 2000
const PLANNING_MAX_TOKENS = 8000

export const QA_ROUTES: Record<QaCategory, QaRoute> = {
  in_session: {
    model: HAIKU_MODEL,
    assembler: 'assembleInSessionContext',
    maxTokens: HAIKU_MAX_TOKENS,
  },
  general: {
    model: HAIKU_MODEL,
    assembler: 'assembleGeneralContext',
    maxTokens: HAIKU_MAX_TOKENS,
  },
  planning: {
    model: SONNET_MODEL,
    assembler: 'assemblePlanningContext',
    maxTokens: PLANNING_MAX_TOKENS,
    effort: 'medium',
  },
  app_mechanics: {
    model: HAIKU_MODEL,
    assembler: 'assembleAppMechanicsContext',
    maxTokens: HAIKU_MAX_TOKENS,
  },
}

export function resolveQaRoute(category: QaCategory): QaRoute {
  return QA_ROUTES[category]
}
