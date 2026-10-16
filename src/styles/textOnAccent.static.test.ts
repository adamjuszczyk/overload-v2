import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accentSites, type AccentSite } from '../testing/accentSites'

// Text on the accent is `--on-accent`, in every place the app draws it (DECISIONS 128 (g), 129 (d), 130 (j); Adam,
// 2026-10-15, twice: "text on the accent: not --base. Use the near-black the boards draw, in both themes, wherever text
// sits on the accent colour" and "add a new token --on-accent in global.css for both themes ... and use it wherever text
// sits on the accent"). The first attempt put it on the 1.2 sheets only and left 64 other places on `--base`, which is
// near-white on the accent in the light theme; this is the proof that no place is left, and that a later chunk that
// writes a new one has to use the token.
//
// Source, not behaviour: it reads the syntax tree of every non-test file under src/ (`accentSites`, so a comment that
// quotes the pattern is no site) and checks each style object that paints the accent. The sheets' own tests prove the
// rendered result where they draw it (`textOnAccent`, in TargetPickers.test.tsx, CuesSheet.test.tsx and
// ExercisePickerSheet.test.tsx); this file proves the rest at the line that writes the colour.

const SRC = fileURLToPath(new URL('../', import.meta.url))

// Coach is the one exception: it is frozen (Escalation 16; check-frozen-code.mjs fails on any change under it), so its 15
// places stay on `--base` until Adam answers DECISIONS 154. If he includes it, the change moves the freeze's base, deletes
// this exception, and the test below ("Coach is still on --base") is what tells them to.
const COACH = 'features/coach/'

// Accent backgrounds with nothing to read on them (dots, a bar, a toggle's track, a radio's dot), by file: how many of
// them the file holds. Their colour is not text, so they have no colour to check. A file holding more accent
// backgrounds without `--on-accent` than it is listed for, or one that is not listed, fails.
const NOTHING_TO_READ: Record<string, number> = {
  'components/ExercisePickerSheet.tsx': 1, // the picked row's radio dot
  'components/pickers/SetTypePicker.tsx': 1, // the picked row's radio dot
  'features/gym/RestDayScreen.tsx': 1, // the week's dots
  'features/gym/RestTimer.tsx': 1, // the bar (over time it turns to the accent)
  'features/plan/planMenu.tsx': 1, // DiffDot
  'features/progress/MesoProgress.tsx': 1, // the legend's square
  'features/settings/DeloadRulesEditor.tsx': 1, // a toggle's track (its knob is a shape)
  'features/settings/SettingsPage.tsx': 1, // a toggle's track
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sourceFiles(path)
    const isSource = /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.testutil\.tsx?$/.test(name)
    return isSource ? [path] : []
  })
}

const FILES = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))
const ALL = FILES.flatMap((f) => accentSites(f.text, f.path))
const isCoach = (site: AccentSite) => site.file.startsWith(COACH)
const SITES = ALL.filter((site) => !isCoach(site))
const COACH_SITES = ALL.filter(isCoach)

const hasOnAccent = (site: AccentSite) => site.colours.some((colour) => colour.includes('var(--on-accent)'))
const usesBase = (site: AccentSite) => site.colours.some((colour) => colour.includes('var(--base)'))
// ConfirmDialog's danger variant is `--error`, not the accent, and keeps its `--base` text; only that background says `--error`.
const isErrorBranch = (site: AccentSite) => site.background.includes('var(--error)')
const where = (site: AccentSite) => `${site.file}:${site.line}  background ${site.background}  colours ${site.colours.join(' | ') || '(none)'}`

describe('text on the accent is --on-accent, in every place the app draws it', () => {
  it('the scan reads the app, not just the sheets (so the absences below are not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(150)
    const drawn = SITES.filter(hasOnAccent)
    expect(drawn.length).toBeGreaterThan(60)
    // the 1.2 sheets, and the screens Adam's "wherever" also reaches
    const folders = [...new Set(drawn.map((site) => site.file.split('/').slice(0, 2).join('/')))]
    for (const folder of ['components/pickers', 'features/gym', 'features/history', 'features/library', 'features/settings', 'features/auth', 'features/pwa', 'features/progress']) {
      expect(folders, folder).toContain(folder)
    }
  })

  it('every accent background that has something to read draws it in --on-accent', () => {
    const offenders = SITES.filter((site) => !hasOnAccent(site) && !(site.file in NOTHING_TO_READ))
    expect(offenders.map(where)).toEqual([])
  })

  it('none of them draws --base on the accent (an element is not half converted: a child span, a second icon or a ternary branch left behind)', () => {
    const offenders = SITES.filter((site) => usesBase(site) && !isErrorBranch(site))
    expect(offenders.map(where)).toEqual([])
  })

  it('the accent backgrounds with no --on-accent are exactly the dots, bars and tracks listed, file by file', () => {
    const without = SITES.filter((site) => !hasOnAccent(site))
    const perFile: Record<string, number> = {}
    for (const site of without) perFile[site.file] = (perFile[site.file] ?? 0) + 1
    expect(perFile).toEqual(NOTHING_TO_READ)
    // none of them has a colour of its own: a listed element that draws text would have to draw it in --on-accent
    expect(without.filter((site) => site.colours.length > 0).map(where)).toEqual([])
  })

  it("ConfirmDialog's confirm button is the one --base next to --on-accent: --base on the --error background of its danger variant, --on-accent on the accent", () => {
    const site = SITES.find((s) => s.file === 'components/ConfirmDialog.tsx')!
    expect(site.background).toBe("danger ? 'var(--error)' : 'var(--accent)'")
    expect(site.colours).toEqual(["danger ? 'var(--base)' : 'var(--on-accent)'"])
  })

  it('Coach, which is frozen, is the one exception, and it is still on --base (DECISIONS 154)', () => {
    expect(COACH_SITES.length).toBeGreaterThan(0)
    // Delete this test and the COACH exception together when Coach moves to --on-accent: the scan then covers it.
    expect(COACH_SITES.filter(hasOnAccent).map(where)).toEqual([])
    expect(COACH_SITES.every(usesBase)).toBe(true)
    expect([...new Set(COACH_SITES.map((site) => site.file.split('/').slice(0, 2).join('/')))]).toEqual(['features/coach'])
  })

  it('the accent is painted by inline styles only: no class names a Tailwind accent background', () => {
    // The names are built from parts: a utility-shaped word in a tracked file would put that utility in the production stylesheet (RULES.md).
    const names = [['bg', 'accent'].join('-'), ['bg', '[var(--accent)]'].join('-')]
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const utility = new RegExp(`(^|[\\s"'\`:])(${names.map(escape).join('|')})(?![\\w-])`)
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(FILES.filter((f) => utility.test(code(f.text))).map((f) => f.path)).toEqual([])
  })
})
