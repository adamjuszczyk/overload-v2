import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Chunk 58a — what the workout screen may and may not be built from, by a scan of the source (TASKS-1.2 58a Verification: "no
// RestTimerInline rendered anywhere (absence)"; DECISIONS 178: the number correction is written "only from the workout screen for an
// in-progress or reopened session, never from History, Plan or any read-only view").
const SRC = join(__dirname, '..', '..')

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}
const all = files(SRC)
const isTest = (path: string) => /\.test\.|\.testutil\./.test(path)
const sourceFiles = all.filter((path) => !isTest(path))
const text = new Map(all.map((path) => [path, readFileSync(path, 'utf8')]))
const rel = (paths: string[]) => paths.map((path) => relative(SRC, path)).sort()

describe('the removed parts of the old workout screen stay removed', () => {
  it('nothing imports the inline rest timer, the floating rest timer, the old row or the old set group', () => {
    const importing = all.filter((path) => /from '\.\/(RestTimerInline|RestTimer|SetRow|SetGroup)'/.test(text.get(path)!) || /from '\.\.\/gym\/(RestTimerInline|RestTimer|SetRow|SetGroup)'/.test(text.get(path)!))
    expect(rel(importing)).toEqual([])
  })

  it('the workout draws no "▼ MORE" row and no TARGET WEIGHT / TARGET REPS / TARGET RIR hint (the targets are in the rows)', () => {
    const rows = sourceFiles.filter((path) => /features[\\/]gym[\\/](GymSession|ExerciseCard|SupersetBlock|WorkoutRow|SetRow\w*|RestBar|useExerciseCardState|setRowParts)\.tsx?$/.test(path))
    expect(rel(rows).length).toBeGreaterThanOrEqual(9) // the scan finds the screen's files (a pattern that matched nothing proves nothing)
    for (const path of rows) {
      expect(text.get(path)).not.toMatch(/▼ MORE|TARGET WEIGHT|TARGET REPS|TARGET RIR/)
    }
  })
})

describe('the number correction is the workout screen\'s alone (DECISIONS 178)', () => {
  it('only GymSession.tsx calls the hook that writes it', () => {
    const using = sourceFiles.filter((path) => /useSetNumberCorrections\s*\(/.test(text.get(path)!) && !path.endsWith('useSetNumberCorrections.ts'))
    expect(rel(using)).toEqual([join('features', 'gym', 'GymSession.tsx')])
  })

  it('the patch item is queued from the correction writer and nowhere else (chunks 61 and 62 call `patchSetNumbers`)', () => {
    const queuing = sourceFiles.filter((path) => /queueSetLogPatch\s*\(/.test(text.get(path)!) && !path.endsWith('useSyncQueue.ts'))
    expect(rel(queuing)).toEqual([join('features', 'gym', 'useSetNumberCorrections.ts')])
  })

  it('History, Plan and the finished-session screens never import the workout screen\'s writers', () => {
    const readOnly = sourceFiles.filter((path) => /features\/(history|plan|programs|progress)\//.test(path.split('\\').join('/')))
    for (const path of readOnly) expect(text.get(path)).not.toMatch(/useSetNumberCorrections|patchSetNumbers|queueSetLogPatch/)
  })
})
