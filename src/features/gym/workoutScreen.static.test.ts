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

describe('the stage-kind patch is the workout screen\'s delete alone (61\'s review 1, F1; DECISIONS 197)', () => {
  it('the item is queued from the delete\'s writer and nowhere else', () => {
    const queuing = sourceFiles.filter((path) => /queueSetLogStageKindClear\s*\(/.test(text.get(path)!) && !path.endsWith('useSyncQueue.ts'))
    expect(rel(queuing)).toEqual([join('features', 'gym', 'clearStageKind.ts')])
  })

  it('the writer is called from GymSession.tsx alone, and History, Plan and the finished-session screens never import it', () => {
    const calling = sourceFiles.filter((path) => /(?<![.\w])clearStageKind\s*\(/.test(text.get(path)!) && !path.endsWith('clearStageKind.ts'))
    expect(rel(calling)).toEqual([join('features', 'gym', 'GymSession.tsx')])
    const readOnly = sourceFiles.filter((path) => /features\/(history|plan|programs|progress)\//.test(path.split('\\').join('/')))
    for (const path of readOnly) expect(text.get(path)).not.toMatch(/clearStageKind|queueSetLogStageKindClear/)
  })
})

// the code of a file as the screen runs it, without the comments that say where something went
const codeOf = (path: string) => text.get(path)!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('ADD STAGE and "mark as dropset" are gone from the workout, and so is the phone-held stage hold (chunk 62; SPEC [1.2] Logging mechanics: "ADD STAGE, \"Mark as dropset\" and \"+ DROP OR STAGE\" are removed")', () => {
  const workoutFiles = sourceFiles.filter((path) => /features[\\/]gym[\\/]/.test(path) && !/(Today|Rest|Sequence|Preview|Completed|Missed|Move|Preview)/.test(path.split(/[\\/]/).pop()!))
  it('no file of the workout draws or builds them', () => {
    expect(rel(workoutFiles).length).toBeGreaterThanOrEqual(30) // the scan finds the screen's files (a pattern that matched nothing proves nothing)
    for (const path of workoutFiles) {
      expect(codeOf(path), rel([path])[0]).not.toMatch(/ADD STAGE|mark as dropset|logAdHocStage|holdStages|AddStage\b|DROP OR STAGE/)
    }
  })

  it('the workout screen does not call setGroupLogic\'s `canAddStageTo` any more (the frozen export stays, unused)', () => {
    const calling = sourceFiles.filter((path) => /\bcanAddStageTo\s*\(/.test(codeOf(path)) && !path.endsWith('setGroupLogic.ts'))
    expect(rel(calling)).toEqual([])
  })
})

describe('a logged set\'s type is one awaited request and a staged added set\'s row is a queued one (chunk 62)', () => {
  it('`patchLog` and `queueChanges` are given to the cards by GymSession.tsx alone, and History, Plan and the finished-session screens never import their producers', () => {
    const giving = sourceFiles.filter((path) => /\b(patchLog|queueChanges)\s*:/.test(codeOf(path)) && /features[\\/]gym[\\/]/.test(path) && !/\.d\.ts$/.test(path))
    expect(rel(giving).sort()).toEqual([join('features', 'gym', 'GymSession.tsx'), join('features', 'gym', 'setDelete.ts')].sort())
    const readOnly = sourceFiles.filter((path) => /features\/(history|plan|programs|progress)\//.test(path.split('\\').join('/')))
    for (const path of readOnly) expect(text.get(path)).not.toMatch(/queueSetChanges|runTypeChange|changeSetType/)
  })

  it('the type picker of the workout is mounted by the row alone (`WorkoutRow.tsx`): no other file of the workout renders `WorkoutSetTypeSheet`', () => {
    const mounting = sourceFiles.filter((path) => /<WorkoutSetTypeSheet\b/.test(codeOf(path)))
    expect(rel(mounting)).toEqual([join('features', 'gym', 'WorkoutRow.tsx')])
  })
})
