import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import type { Mesocycle, MesocycleStatus, ProgramKind, WeeklySchedule } from '../../types'

type DbMesoProgram = { id: string; name: string }

type DbMeso = {
  id: string
  user_id: string
  name: string
  program_id: string
  status: MesocycleStatus
  start_date: string
  end_date: string | null
  created_at: string
  v2_programs: DbMesoProgram | null
  source_program_id?: string | null  // absent until migration 027
}

function toMesocycle(row: DbMeso): Mesocycle {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    programId: row.program_id,
    program: row.v2_programs
      ? {
          id: row.v2_programs.id,
          name: row.v2_programs.name,
          userId: row.user_id,
          schedule: {} as WeeklySchedule,
          workoutDays: [],
          createdAt: '',
          updatedAt: '',
          // Not selected by this row's embed (id, name only) — every run's
          // copy this list can show is 'run' by construction (program_id
          // always names the run's own copy from chunk 6 on), so this is a
          // safe, honest default rather than a fetched value.
          kind: 'run' as ProgramKind,
        }
      : undefined,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    sourceProgramId: row.source_program_id ?? null,
  }
}

export async function fetchMesos(): Promise<Mesocycle[]> {
  const { data, error } = await supabase
    .from('v2_mesocycles')
    .select('*, v2_programs!v2_mesocycles_program_id_fkey(id, name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbMeso[]).map(toMesocycle)
}

// createMeso / completeAllActiveMesos (the old two-request start path) are
// retired as of chunk 6 — v2_start_run (runService.ts) replaces both in one
// atomic, race-safe call (TASKS.md; scratch R8). Removed rather than kept
// exported-but-unused: nothing else in the app called either.

export async function completeMeso(id: string): Promise<void> {
  const today = format(new Date(), 'yyyy-MM-dd')
  const { error } = await supabase
    .from('v2_mesocycles')
    .update({ status: 'completed', end_date: today })
    .eq('id', id)
  if (error) throw error
}

export async function deleteMeso(id: string): Promise<void> {
  const { error } = await supabase
    .from('v2_mesocycles')
    .delete()
    .eq('id', id)
    .eq('status', 'completed')
  if (error) throw error
}
