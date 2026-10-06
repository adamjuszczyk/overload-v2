// Chunk 13 (TASKS.md "Supersets" / SPEC.md "Supersets [P1]") — the pure
// rounds/zigzag structure a superset block renders as. Deliberately generic
// (works over whatever "head" shape a caller passes — a WeekPlanSet, a
// richer per-row render spec, anything) and side-effect free, same
// precedent as setGroupLogic.ts / referenceLogic.ts: independently testable,
// no React, no Supabase.
//
// SPEC "Supersets": "Shown as a block of rounds: round 1 = A1, B1, C1; round
// 2 = A2, B2, C2; … Unequal set counts are allowed. A round can have an
// empty slot; leftover sets stay inside the block (4 sets of A, 3 of B → 4
// rounds, round 4 has only A). The current set zigzags through rounds: A1 →
// B1 → A2 → B2 …"
//
// Callers (SupersetBlock.tsx) are the ones who decide what a "head" is for
// this purpose — in particular, they pass each member's PLANNED HEADS only
// (a dropset's stage rows already excluded by setGroupLogic.ts's
// groupWeekPlanSets/headsOnly before this module ever sees them): "Stages
// stay attached to their head" (stage-exclusion rule) simply falls out of
// never being handed a stage row here — a head with stages still occupies
// exactly one cell per round, stages rendered nested under it by SetGroup,
// same as any other exercise's dropset. Warmups don't exist yet (chunk 15):
// if a caller's rows ever carry one, it must filter it out before calling
// this module — SupersetBlock.tsx does, on `isWarmup`, with its own comment
// at the filter site.

export interface SupersetCell<T> {
  memberIndex: number
  head: T
}

export interface SupersetRound<T> {
  roundNumber: number // 1-based
  cells: SupersetCell<T>[] // in member order (A, B, C, …) — only members that have a round-N'th head
}

// Round N (1-based) holds member k's N-th head, for every member that HAS
// one — "a round can have an empty slot" (SPEC) means that slot is simply
// absent from `cells`, never a null placeholder, since nothing is rendered
// for it either. `memberHeads[k]` must already be in head order (set 1,
// set 2, …) for member k; this module never reorders within a member, only
// across them.
export function buildSupersetRounds<T>(memberHeads: T[][]): SupersetRound<T>[] {
  const roundCount = memberHeads.reduce((max, heads) => Math.max(max, heads.length), 0)
  const rounds: SupersetRound<T>[] = []
  for (let r = 0; r < roundCount; r++) {
    const cells: SupersetCell<T>[] = []
    memberHeads.forEach((heads, memberIndex) => {
      const head = heads[r]
      if (head !== undefined) cells.push({ memberIndex, head })
    })
    rounds.push({ roundNumber: r + 1, cells })
  }
  return rounds
}

// The current-set zigzag order (SPEC: "A1 → B1 → A2 → B2 …") is exactly
// "every round's cells, in round order" — round 1's cells are already in
// member order (A, B, C), so flattening the rounds (round-major) already
// reads A1, B1, C1, A2, B2, C2, … with no further reordering. Exported as
// its own step (rather than inlined into the renderer) so the zigzag
// property itself is independently assertable in tests, separate from
// "are the rounds grouped correctly".
export function zigzagOrder<T>(rounds: SupersetRound<T>[]): SupersetCell<T>[] {
  return rounds.flatMap((round) => round.cells)
}
