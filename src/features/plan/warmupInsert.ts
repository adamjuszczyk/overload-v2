// "Add warmup sets" (Adam, 2026-10-10 — Plan's exercise ⋯ menu): a warmup is a
// head set with is_warmup, and it lives ABOVE the exercise's first working
// set. This is the pure half: given the exercise's current rows for one
// week, decide the set_number the new warmup takes and which existing rows
// must move down one place to make room. weekPlanService.ts's
// addWarmupSet() reads the rows, calls this, and writes the result.
//
// Stages share their head's set_number (TASKS.md §2.1), so a shift moves a
// head and its stages together. Only rows at or after `insertAt` move, so
// the warmups already at the top keep their numbers and the new one lands
// right after them.

export interface WarmupInsertRow {
  id: string
  setNumber: number
  isWarmup: boolean
  isStage: boolean
}

export interface WarmupInsertPlan {
  insertAt: number
  shifts: { id: string; setNumber: number }[]
}

export function planWarmupInsert(rows: WarmupInsertRow[]): WarmupInsertPlan {
  const heads = rows.filter((r) => !r.isStage).sort((a, b) => a.setNumber - b.setNumber)
  const firstWorking = heads.find((h) => !h.isWarmup)
  const insertAt = firstWorking
    ? firstWorking.setNumber
    : heads.length > 0
      ? heads[heads.length - 1].setNumber + 1
      : 1
  // Highest number first, so a write never lands on a number another row
  // still holds (v2_week_plan_sets has no unique index on set_number, but
  // this keeps the order unambiguous at every step of a partial failure).
  const shifts = rows
    .filter((r) => r.setNumber >= insertAt)
    .sort((a, b) => b.setNumber - a.setNumber)
    .map((r) => ({ id: r.id, setNumber: r.setNumber + 1 }))
  return { insertAt, shifts }
}
