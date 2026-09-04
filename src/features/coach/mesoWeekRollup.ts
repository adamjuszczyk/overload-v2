import type { SupabaseClient } from '@supabase/supabase-js'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import { headsOnly } from '../gym/setGroupLogic.js'
import { averageRating, FORM_SCALE, ENERGY_SCALE, PUMP_SCALE } from '../gym/ratingScales.js'
import type { RatingAverage } from '../gym/ratingScales.js'
import type { EnergyRating, PumpRating, FormRating } from '../../types/index.js'

// Extracted from qaContext.ts (Step R, MESOCYCLE-ANALYSIS-TASKS.md §2.5/§7) —
// the shared, injected-client meso-week fetch. Mirrors
// progressService.ts's fetchMesoWeeklyProgress exactly (same query shape,
// same pure helpers); that function is browser-singleton and cannot be
// called from here. This is the single injected-client implementation of
// the *fetch* now, replacing what used to be qaContext.ts's own private
// copy — never a third one, and never a re-derivation of the arithmetic
// (headsOnly/averageRating/the three rating scales are imported, not
// reimplemented).
//
// Returns every observed week, unsliced — callers apply their own windowing
// (qaContext.ts's Q&A-specific `.slice(-ROLLUP_WEEKS)`, or Mesocycle
// Analysis's full-meso trajectory) at their own call site.

export interface WeekRollup {
  weekNumber: number
  totalSets: number
  avgRir: number | null
  avgReps: number | null
  avgDurationSeconds: number | null
  avgFormRating: RatingAverage | null
  avgEnergyRating: RatingAverage | null
  avgPumpRating: RatingAverage | null
  isDeload: boolean
}

type RawRollupSetLog = {
  weight: number | null
  reps: number | null
  rir: number | null
  is_skipped: boolean
  parent_set_id: string | null
  form_rating: string | null
}
type RawRollupSessionRow = {
  id: string
  date: string
  started_at: string | null
  completed_at: string | null
  energy_rating: EnergyRating | null
  pump_rating: PumpRating | null
  v2_set_logs: RawRollupSetLog[]
}

export async function fetchMesoWeekRollups(
  client: SupabaseClient,
  userId: string,
  mesoId: string,
  mesoStartDate: string,
): Promise<WeekRollup[]> {
  const [{ data: sessions, error: sErr }, { data: plans, error: pErr }] = await Promise.all([
    client
      .from('v2_sessions')
      .select(
        'id, date, started_at, completed_at, energy_rating, pump_rating, v2_set_logs(weight, reps, rir, is_skipped, parent_set_id, form_rating)',
      )
      .eq('user_id', userId)
      .eq('mesocycle_id', mesoId)
      .eq('status', 'completed')
      .order('date', { ascending: true }),
    client.from('v2_week_plans').select('week_number, is_deload').eq('mesocycle_id', mesoId).eq('user_id', userId),
  ])
  if (sErr) throw sErr
  if (pErr) throw pErr

  const deloadWeeks = new Set<number>(
    (plans as { week_number: number; is_deload: boolean }[]).filter((p) => p.is_deload).map((p) => p.week_number),
  )

  const weekMap = new Map<number, RawRollupSetLog[]>()
  const weekDurations = new Map<number, number[]>()
  const weekEnergyRatings = new Map<number, (EnergyRating | null)[]>()
  const weekPumpRatings = new Map<number, (PumpRating | null)[]>()

  for (const session of sessions as unknown as RawRollupSessionRow[]) {
    const wk = differenceInCalendarWeeks(parseISO(session.date), parseISO(mesoStartDate), { weekStartsOn: 1 }) + 1
    weekMap.set(wk, [...(weekMap.get(wk) ?? []), ...session.v2_set_logs])
    weekEnergyRatings.set(wk, [...(weekEnergyRatings.get(wk) ?? []), session.energy_rating])
    weekPumpRatings.set(wk, [...(weekPumpRatings.get(wk) ?? []), session.pump_rating])
    if (session.started_at && session.completed_at) {
      const durationSeconds =
        (parseISO(session.completed_at).getTime() - parseISO(session.started_at).getTime()) / 1000
      if (durationSeconds > 0) weekDurations.set(wk, [...(weekDurations.get(wk) ?? []), durationSeconds])
    }
  }

  const result: WeekRollup[] = []
  for (const [weekNumber, allLogs] of weekMap.entries()) {
    const headLogs = headsOnly(allLogs, (l) => l.parent_set_id)
    const valid = headLogs.filter((l) => !l.is_skipped && l.weight !== null && l.reps !== null)
    const withRir = valid.filter((l) => l.rir !== null)
    const durations = weekDurations.get(weekNumber) ?? []

    result.push({
      weekNumber,
      totalSets: valid.length,
      avgRir: withRir.length > 0 ? withRir.reduce((s, l) => s + l.rir!, 0) / withRir.length : null,
      avgReps: valid.length > 0 ? valid.reduce((s, l) => s + l.reps!, 0) / valid.length : null,
      avgDurationSeconds: durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : null,
      avgFormRating: averageRating(FORM_SCALE, valid.map((l) => l.form_rating as FormRating | null)),
      avgEnergyRating: averageRating(ENERGY_SCALE, weekEnergyRatings.get(weekNumber) ?? []),
      avgPumpRating: averageRating(PUMP_SCALE, weekPumpRatings.get(weekNumber) ?? []),
      isDeload: deloadWeeks.has(weekNumber),
    })
  }

  return result.sort((a, b) => a.weekNumber - b.weekNumber)
}
