import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Chunk 50 (TASKS-1.2: "A grep in the test: no `schedule[` read outside the resolver"). Which workout is on which weekday is
// a question about a WEEK: the run copy's own schedule (`v2_programs.schedule`) holds the NEWEST days once a weekday change
// that starts next week is saved (chunk 51b), and `v2_run_schedules` holds the history (runSchedule.ts' `scheduleForWeek`
// picks the row in force). So in Today and Plan, the two places that ask it per week, nothing reads a program's `.schedule`
// except to hand it to the resolver (it is the resolver's fallback), or to `hasScheduledWorkout`, which asks only whether
// the run has any workout at all (hasSchedule.ts, unchanged: it reads the run copy's, which 51b keeps current).
//
// Source, not behaviour: it reads the syntax tree of every non-test file under features/gym (Today, its scheduler, the
// missed-session prompt, moving a session, the rest-day screen) and features/plan (Plan), comments out of the way. The
// behaviour is proven where each reader is (scheduler.scheduleForWeek.test.ts, useScheduler.test.tsx,
// TodayPage.runSchedule.test.tsx, RestDayScreen.test.tsx, PlanPage.runSchedule.test.tsx); this is the structural half, so
// that a later chunk that reads `program.schedule[dow]` again in these folders has to say so here.
//
// Not covered, on purpose: the stepped planner and the programs list (they edit and count a PROGRAM's days, not a week's), the
// run's CHANGE THE PROGRAM editor and the resolver itself (features/programs), and Coach (frozen, Escalation 16).

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const FOLDERS = ['features/gym', 'features/plan']

// The one file that reads a `schedule` that is not a program's: the stored column of a `v2_run_schedules` row, mapped to
// the history entry the resolver reads. How many reads it holds is pinned, so the exception cannot quietly grow.
const ROW_MAPPER: Record<string, number> = { 'features/plan/useRunSchedule.ts': 1 }

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sourceFiles(path)
    const isSource = /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.testutil\.tsx?$/.test(name)
    return isSource ? [path] : []
  })
}

const FILES = FOLDERS.flatMap((folder) => sourceFiles(join(SRC, folder))).map((path) => ({
  path: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}))

const RESOLVERS = new Set(['scheduleForWeek', 'hasScheduledWorkout'])

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

/** Whether the node sits inside the arguments of a call to the resolver (or to `hasScheduledWorkout`). */
function handedToTheResolver(node: ts.Node): boolean {
  for (let child: ts.Node = node; child.parent; child = child.parent) {
    const parent = child.parent
    if (ts.isCallExpression(parent) && parent.arguments.some((arg) => arg === child) && RESOLVERS.has(calleeName(parent) ?? '')) return true
  }
  return false
}

interface ScheduleRead {
  file: string
  line: number
  code: string
  allowed: boolean
}

/** Every read of something's `schedule` in the file: `x.schedule`, `x?.schedule`, `x['schedule']` and `{ schedule }` taken out of an object. */
function scheduleReads(text: string, file: string): ScheduleRead[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: ScheduleRead[] = []
  const add = (node: ts.Node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    found.push({ file, line, code: node.getText(source).replace(/\s+/g, ' '), allowed: handedToTheResolver(node) })
  }
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'schedule') add(node)
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'schedule') add(node)
    else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && ((node.propertyName ?? node.name).getText(source) === 'schedule')) add(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const ALL_READS = FILES.flatMap((f) => scheduleReads(f.text, f.path))
const READS = ALL_READS.filter((r) => !(r.file in ROW_MAPPER))
const where = (r: ScheduleRead) => `${r.file}:${r.line}  ${r.code}`

describe('Today and Plan read a program\'s schedule only through the resolver (chunk 50)', () => {
  it('the scan reads real code (so the absence below is not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(80)
    const names = FILES.map((f) => f.path)
    for (const expected of ['features/gym/scheduler.ts', 'features/gym/useScheduler.ts', 'features/gym/TodayPage.tsx', 'features/gym/RestDayScreen.tsx', 'features/gym/MissedSessionPrompt.tsx', 'features/gym/moveSession.ts', 'features/plan/PlanPage.tsx']) {
      expect(names, expected).toContain(expected)
    }
    expect(READS.length).toBeGreaterThanOrEqual(4)
  })

  it('no read of a schedule in those folders is anything but an argument of the resolver (or of hasScheduledWorkout)', () => {
    expect(READS.filter((r) => !r.allowed).map(where)).toEqual([])
  })

  it('the row mapper reads exactly the stored column, once', () => {
    for (const [file, count] of Object.entries(ROW_MAPPER)) {
      expect(ALL_READS.filter((r) => r.file === file).map((r) => r.code), file).toHaveLength(count)
      expect(ALL_READS.filter((r) => r.file === file).map((r) => r.code)).toEqual(['row.schedule'])
    }
  })

  it('the reads that exist are the known ones: each feeds the resolver its fallback, the run copy\'s schedule', () => {
    expect(READS.map((r) => r.file).sort()).toEqual([
      'features/gym/RestDayScreen.tsx', // the week's dots: the count of the weekdays in force this week
      'features/gym/useScheduler.ts', // the scheduler's resolver
      'features/plan/PlanPage.tsx', // the viewed week's chips and shared note
      'features/plan/PlanPage.tsx', // hasScheduledWorkout: whether the run has any workout (hasSchedule.ts, unchanged)
    ])
  })

  it('the scheduler, the prompt and the move sheet read no schedule of their own: they are handed the week\'s days', () => {
    for (const file of ['features/gym/scheduler.ts', 'features/gym/MissedSessionPrompt.tsx', 'features/gym/moveSession.ts', 'features/gym/MoveSessionSheet.tsx', 'features/gym/TodayPage.tsx']) {
      expect(READS.filter((r) => r.file === file).map(where), file).toEqual([])
    }
  })
})

describe('the scan finds what it is meant to find (controls)', () => {
  const check = (code: string) => scheduleReads(code, 'features/gym/x.ts')

  it('the three reads chunk 50 replaced are each a violation', () => {
    expect(check('const wdId = program.schedule[dow]').map((r) => r.allowed)).toEqual([false])
    expect(check('const wdId = program?.schedule[dow] ?? null').map((r) => r.allowed)).toEqual([false])
    expect(check('const n = Object.values(program.schedule).filter(Boolean).length').map((r) => r.allowed)).toEqual([false])
  })

  it('other ways to reach the same days are violations too', () => {
    expect(check("const s = program['schedule']").map((r) => r.allowed)).toEqual([false])
    expect(check('const { schedule } = program').map((r) => r.allowed)).toEqual([false])
    expect(check('const { schedule: days } = program').map((r) => r.allowed)).toEqual([false])
    expect(check('const s = program.schedule\nconst id = s[dow]').map((r) => r.allowed)).toEqual([false])
  })

  it('a hand-off to the resolver, at any depth of its arguments, is allowed', () => {
    expect(check('scheduleForWeek(rows, program.schedule, week)').map((r) => r.allowed)).toEqual([true])
    expect(check('scheduleForWeek(rows ?? [], active?.schedule ?? EMPTY, week)').map((r) => r.allowed)).toEqual([true])
    expect(check('Object.values(scheduleForWeek(rows, program.schedule, week))').map((r) => r.allowed)).toEqual([true])
    expect(check('hasScheduledWorkout({ scheduleType: p.scheduleType, schedule: p?.schedule, workoutDays })').map((r) => r.allowed)).toEqual([true])
  })

  it('a hand-off to any other function is not, and neither is a read beside the call', () => {
    expect(check('somethingElse(rows, program.schedule, week)').map((r) => r.allowed)).toEqual([false])
    expect(check('scheduleForWeek(rows, week)[program.schedule]').map((r) => r.allowed)).toEqual([false])
  })

  it('comments and strings that merely mention it are no read', () => {
    expect(check('// program.schedule[dow]\n/* program.schedule */\nconst a = "program.schedule[dow]"')).toEqual([])
  })
})
