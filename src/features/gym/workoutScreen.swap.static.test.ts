import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Chunk 59 — the swap and the add of the old workout screen are gone, and the rest of the swap's code is where TASKS-1.2 59 puts it (a
// scan of the source: "`SwapExerciseSheet` no longer imported (absence)"; the swap's row is written by one function; DECISIONS 199, 200).
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
const code = (path: string) => text.get(path)!.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')

describe('the old swap sheet and the controls it served are gone (TASKS 59: SwapExerciseSheet.tsx removed)', () => {
  it('the file is gone and nothing imports it, tests included', () => {
    expect(existsSync(join(SRC, 'features', 'gym', 'SwapExerciseSheet.tsx'))).toBe(false)
    expect(rel(all.filter((path) => /from '[^']*SwapExerciseSheet'/.test(code(path)) || /vi\.mock\('[^']*SwapExerciseSheet'/.test(code(path))))).toEqual([])
  })

  it('the exercise header draws no swap icon any more: the ⋯ is where the swap is (a card with no ⋯ draws the header as Today\'s preview always did)', () => {
    const header = join(SRC, 'features', 'gym', 'ExerciseHeader.tsx')
    expect(code(header)).not.toMatch(/Swap exercise for this session|onSwapClick|Repeat2/)
    for (const path of sourceFiles.filter((p) => /features[\\/]gym[\\/]/.test(p))) expect(code(path)).not.toMatch(/onSwapClick|Swap exercise for this session/)
  })

  it('no card draws SKIP REST OF EXERCISE, CONFIRM SKIP or a per-member ADD SET button of its own: the skip and Add a set are the ⋯\'s rows', () => {
    const block = code(join(SRC, 'features', 'gym', 'SupersetBlock.tsx'))
    expect(block).not.toMatch(/SKIP REST OF EXERCISE|CONFIRM SKIP/)
    expect(block).not.toMatch(/>\s*ADD SET\s*</) // + ADD ROUND is the block's button; a member's own is gone
    expect(code(join(SRC, 'features', 'gym', 'ExerciseCard.tsx'))).not.toMatch(/SKIP REST OF EXERCISE|CONFIRM SKIP/)
  })
})

describe('the swap row is written by one function, and only from the workout screen', () => {
  it('`recordExerciseSwap` is called by the hook and by nothing else', () => {
    const callers = sourceFiles.filter((path) => /\brecordExerciseSwap\(/.test(code(path)))
    expect(rel(callers)).toEqual([join('features', 'gym', 'sessionService.ts'), join('features', 'gym', 'useSession.ts')].sort())
    expect(rel(sourceFiles.filter((path) => /\buseRecordExerciseSwap\b/.test(code(path))))).toEqual([join('features', 'gym', 'GymSession.tsx'), join('features', 'gym', 'useSession.ts')].sort())
  })

  it('the swap\'s record is never made from the logs: nothing in the app builds a SwapRecord but the planner that holds the rows', () => {
    const makers = sourceFiles.filter((path) => /\bmovedSetEntries\(/.test(code(path)))
    expect(rel(makers)).toEqual([join('features', 'gym', 'exerciseOptions.ts'), join('features', 'gym', 'workoutRules.ts')].sort())
  })
})
