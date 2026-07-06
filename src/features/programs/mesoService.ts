import { supabase } from '../../lib/supabase'
import type { Mesocycle, MesocycleStatus, WeeklySchedule } from '../../types'

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
        }
      : undefined,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  }
}

export async function fetchMesos(): Promise<Mesocycle[]> {
  const { data, error } = await supabase
    .from('v2_mesocycles')
    .select('*, v2_programs(id, name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbMeso[]).map(toMesocycle)
}

export async function createMeso(
  userId: string,
  name: string,
  programId: string,
  startDate: string,
): Promise<Mesocycle> {
  const { data, error } = await supabase
    .from('v2_mesocycles')
    .insert({
      user_id: userId,
      name: name.trim(),
      program_id: programId,
      start_date: startDate,
      status: 'active',
    })
    .select('*, v2_programs(id, name)')
    .single()
  if (error) throw error
  return toMesocycle(data as DbMeso)
}

export async function completeAllActiveMesos(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const { error } = await supabase
    .from('v2_mesocycles')
    .update({ status: 'completed', end_date: today })
    .eq('user_id', userId)
    .eq('status', 'active')
  if (error) throw error
}

export async function completeMeso(id: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
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
