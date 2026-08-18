import { parseISO, startOfWeek, subWeeks, format } from 'date-fns'
import type { WeightEntry, WeeklyWeightAverage } from '../../types/index.js'

// Pure weight-log resolution (COACH-ANALYSIS-TASKS.md §4 step C). Bodyweight
// stays kg-only, no unit conversion (TASKS §5.8) — unrelated to lifted-weight
// kg/lbs handling in weightUnit.ts.

const ISO_DATE = 'yyyy-MM-dd'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Monday-anchored week key, matching this app's standing rule for
// meso-week arithmetic (CONTEXT.md — always weekStartsOn: 1, never
// differenceInWeeks). A 'weekly_average' entry's entryDate is already
// normalised to this exact value at write time (TASKS §5.2), so weekKey is
// idempotent on it; a 'daily' entry's entryDate maps to the Monday of
// whatever week it actually falls in.
export function weekKey(date: string): string {
  return format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), ISO_DATE)
}

// One row per week that has *any* entry. A manual weekly-average entry wins
// over that week's dailies when both exist (TASKS §5.3 — an explicit
// statement beats a computed inference); the dailies are never touched or
// hidden by this, they just don't feed the average for that week. At most
// one manual entry per week in practice (DB unique (user_id, entry_date,
// kind) plus the Monday-normalisation makes a second one collide) — if
// given more than one anyway, the first is used, not summed.
export function buildWeeklyAverages(entries: WeightEntry[]): WeeklyWeightAverage[] {
  const byWeek = new Map<string, WeightEntry[]>()
  for (const entry of entries) {
    const key = weekKey(entry.entryDate)
    const list = byWeek.get(key)
    if (list) list.push(entry)
    else byWeek.set(key, [entry])
  }

  const results: WeeklyWeightAverage[] = []
  for (const [weekStart, weekEntries] of byWeek) {
    const manual = weekEntries.find((e) => e.kind === 'weekly_average')
    if (manual) {
      results.push({ weekStart, averageKg: round2(manual.weightKg), source: 'manual', dailyCount: 0 })
      continue
    }
    const dailies = weekEntries.filter((e) => e.kind === 'daily')
    if (dailies.length === 0) continue
    const averageKg = round2(dailies.reduce((sum, e) => sum + e.weightKg, 0) / dailies.length)
    results.push({ weekStart, averageKg, source: 'daily', dailyCount: dailies.length })
  }

  return results.sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

// The last `weeks` weekly averages up to and including asOf's own week,
// oldest first. Weeks with no entry at all are simply absent, not zero-
// filled — a gap in the trend is real information (SPEC §8's "never
// destroy raw data" extends to not inventing data that isn't there).
export function recentWeightTrend(
  entries: WeightEntry[],
  asOf: string,
  weeks: number,
): WeeklyWeightAverage[] {
  const asOfWeek = weekKey(asOf)
  const earliestWeek = format(subWeeks(parseISO(asOfWeek), weeks - 1), ISO_DATE)
  return buildWeeklyAverages(entries).filter(
    (w) => w.weekStart >= earliestWeek && w.weekStart <= asOfWeek,
  )
}
