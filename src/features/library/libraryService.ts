import { supabase } from '../../lib/supabase'
import { withUserLock } from '../../lib/locks'
import { fetchExercises, diffNewByName, previewExerciseDelete, deleteExercise } from './exerciseService'
import type { ExerciseLibrary, ExerciseLibraryItem, MuscleSubgroup, MovementPattern } from '../../types'

// v2_exercise_libraries / v2_exercise_library_items (migration 019,
// EXERCISE-LIBRARY-TASKS.md §2.1/§2.2/§8 step 6). Both tables are global
// and read-only to the app — RLS grants `select` to everyone and no
// write policy at all, so there is no create/update/delete here, only the
// three reads/writes this step needs: list, preview, download.

type DbLibrary = {
  id: string
  slug: string
  name: string
  description: string | null
  is_listed: boolean
  position: number
}

type DbLibraryItem = {
  id: string
  library_id: string
  name: string
  muscle_group: string
  muscle_subgroup: MuscleSubgroup[] | null
  movement_pattern: MovementPattern | null
  position: number
}

function toLibrary(row: DbLibrary): ExerciseLibrary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isListed: row.is_listed,
    position: row.position,
  }
}

function toLibraryItem(row: DbLibraryItem): ExerciseLibraryItem {
  return {
    id: row.id,
    libraryId: row.library_id,
    name: row.name,
    // Same coercion toExercise() in exerciseService.ts applies — a
    // muscle_group value the picker vocabulary doesn't recognise degrades
    // rather than breaking the row.
    muscleGroup: row.muscle_group as ExerciseLibraryItem['muscleGroup'],
    muscleSubgroup: row.muscle_subgroup,
    movementPattern: row.movement_pattern,
    position: row.position,
  }
}

// is_listed = true only (SPEC §2.1) — the legacy provenance library
// (migration 020) exists purely as an FK target and must never appear
// here.
export async function fetchLibraries(): Promise<ExerciseLibrary[]> {
  const { data, error } = await supabase
    .from('v2_exercise_libraries')
    .select('*')
    .eq('is_listed', true)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as DbLibrary[]).map(toLibrary)
}

export async function fetchLibraryItems(libraryId: string): Promise<ExerciseLibraryItem[]> {
  const { data, error } = await supabase
    .from('v2_exercise_library_items')
    .select('*')
    .eq('library_id', libraryId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as DbLibraryItem[]).map(toLibraryItem)
}

// Download: copy a library's items into the user's own exercises, skipping
// any name the account already has (archived included — same "already
// present" reasoning fetchExerciseCount/diffNewByName document), and
// stamping each inserted row's provenance back to this library
// (EXERCISE-LIBRARY-TASKS.md §2.4/§9.7 — a downloaded exercise arrives
// pre-tagged from the library item and is never re-tagged on a later
// download). Reuses exerciseService.ts's name-diff rule and
// withUserLock's double-tap guard rather than a third copy of either.
export async function downloadLibrary(
  userId: string,
  libraryId: string,
): Promise<{ added: number; skipped: number }> {
  return withUserLock(`overload-download-library-${userId}-${libraryId}`, async () => {
    const [items, existing] = await Promise.all([fetchLibraryItems(libraryId), fetchExercises(true)])
    const existingNames = new Set(existing.map((ex) => ex.name.trim().toLowerCase()))
    const toAdd = diffNewByName(items, existingNames)

    if (toAdd.length > 0) {
      const rows = toAdd.map((item) => ({
        user_id: userId,
        name: item.name,
        muscle_group: item.muscleGroup,
        muscle_subgroup: item.muscleSubgroup,
        movement_pattern: item.movementPattern,
        source_library_id: libraryId,
      }))
      const { error } = await supabase.from('exercises').insert(rows)
      if (error) throw error
    }

    return { added: toAdd.length, skipped: items.length - toAdd.length }
  })
}

// "Delete a library" means delete *my copies* of its exercises, never the
// catalog row (EXERCISE-LIBRARY-TASKS.md §9.1 — v2_exercise_libraries has
// no write policy at all, so the app is structurally incapable of the other
// reading). It is a bulk version of the single exercise delete, not a
// separate mechanism: every currently-active exercise sourced from this
// library independently either hard-deletes (zero history) or moves to
// 'lost' (§9.2). Already-lost exercises from this library are left alone —
// they've already had this decision made for them.
async function fetchActiveExerciseIdsFromLibrary(libraryId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('exercises')
    .select('id')
    .eq('source_library_id', libraryId)
    .eq('status', 'active')
  if (error) throw error
  return (data as { id: string }[]).map((row) => row.id)
}

export interface LibraryDeletePreview {
  toDeleteCount: number
  toLostCount: number
}

// The split preview (§6.3/§9.2) — must be shown before the action is
// confirmed, since which exercises will hard-delete versus move to Lost is
// not predictable from outside. Reuses previewExerciseDelete per exercise
// rather than a parallel bulk query, so a library delete and a single
// delete can never disagree about which branch a given exercise takes.
export async function previewLibraryDelete(libraryId: string): Promise<LibraryDeletePreview> {
  const ids = await fetchActiveExerciseIdsFromLibrary(libraryId)
  const previews = await Promise.all(ids.map((id) => previewExerciseDelete(id)))
  return {
    toDeleteCount: previews.filter((p) => p.outcome === 'gone').length,
    toLostCount: previews.filter((p) => p.outcome === 'lost').length,
  }
}

export async function deleteLibrary(libraryId: string): Promise<{ deleted: number; lost: number }> {
  const ids = await fetchActiveExerciseIdsFromLibrary(libraryId)
  const outcomes = await Promise.all(ids.map((id) => deleteExercise(id)))
  return {
    deleted: outcomes.filter((o) => o === 'gone').length,
    lost: outcomes.filter((o) => o === 'lost').length,
  }
}
