// navigator.locks-based mutation guard. Extracted from
// exerciseService.ts's seedDefaultExercisesIfEmpty/importDefaultExercises,
// which each defined the same "acquire a per-user Web Lock, or run
// unguarded where the API doesn't exist" shape inline
// (EXERCISE-LIBRARY-TASKS.md §8 step 6 — libraryService.ts's
// downloadLibrary reuses this exact guard rather than a third copy).
// Serializes same-browser callers racing the same key so a loser re-checks
// real state after the winner's write has landed, instead of trusting a
// read taken before the lock was acquired. Does not protect against two
// genuinely different devices racing the same key at the same instant —
// that residual window is accepted, same as it always was.
export async function withUserLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(key, run)
  }
  return run()
}
