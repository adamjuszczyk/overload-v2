import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chunk 63 (G46 (a): "never sent to Supabase", TASKS 63: "`session_set_drafts` never appears in any `.from()` / queue call (grep)"): the two Dexie tables of the unlog
// (`session_set_drafts`, `session_added_sets`) are named in exactly two places of the app, the schema and the one module that reads and writes them. Anything else naming
// either (a service that sends them, the sync queue, a `.from()`) fails here. Tests and their stand-ins are not the app.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ALLOWED = new Set(['lib/db.ts', 'features/gym/sessionDrafts.ts'])
const NAMES = /session_set_drafts|session_added_sets|sessionDrafts'/

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.testutil\./.test(entry)) yield path
  }
}

describe('the unlog\'s Dexie tables stay on the phone (G46 (a))', () => {
  it('names them only in the schema and in sessionDrafts.ts: never in a .from(), a queue item or a service', () => {
    const offenders = [...files(SRC)]
      .map((path) => relative(SRC, path).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => NAMES.test(readFileSync(join(SRC, rel), 'utf8')))
    // the readers of the module are allowed to import it, but never the sync queue or a service
    const importers = offenders.filter((rel) => !/^features\/gym\/(useWorkoutRows|GymSession|useSession)\.tsx?$/.test(rel))
    expect(importers).toEqual([])
  })

  it('the sync queue and the services that talk to Supabase do not import the drafts module', () => {
    for (const rel of ['features/offline/useSyncQueue.ts', 'features/offline/offlineCache.ts', 'features/gym/sessionService.ts', 'features/gym/sessionSetChangesService.ts']) {
      expect(readFileSync(join(SRC, rel), 'utf8'), rel).not.toMatch(NAMES)
    }
  })

  it('the module itself has no request in it (no supabase import, no .from)', () => {
    const source = readFileSync(join(SRC, 'features/gym/sessionDrafts.ts'), 'utf8')
    expect(source).not.toMatch(/supabase/)
    expect(source).not.toMatch(/\.from\(/)
  })
})
