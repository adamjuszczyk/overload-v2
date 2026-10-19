import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accentSites, type AccentSite } from '../testing/accentSites'
import { reachableFrom } from '../testing/moduleGraph'

// Text on the accent is `--on-accent` in the screens 1.2 rebuilds and in the components they use, and nowhere else.
//
// Adam, 2026-10-15, twice (DECISIONS 128 (g), 129 (d), 130 (j)): "text on the accent: not --base. Use the near-black the boards
// draw, in both themes, wherever text sits on the accent colour" and "add a new token --on-accent in global.css for both themes
// ... and use it wherever text sits on the accent". The display follow-up (#135) read "wherever" as the whole app but Coach, and
// put the token on 64 places in 39 files. Adam, 2026-10-16 (DECISIONS 154): "Coach stays exactly as it is. --on-accent applies to
// the screens 1.2 rebuilds and the shared components they use; screens 1.2 doesn't touch keep their current code." SPEC.md, Design
// boards, "Scope of the look", says the same and names the screens: Plan (with PROGRAMS), CHANGE THE PROGRAM, the stepped program
// planner and the workout screen are rebuilt; Today outside the workout itself, History, Progress, Library, Settings, sign-in and
// Coach keep their current code. The second display follow-up (d31b) took the token back off the 26 places that are only on the
// screens 1.2 doesn't rebuild. This is the proof of both halves: no place in a rebuilt screen or in a component it uses is left on
// `--base` (and a later chunk that writes a new one has to use the token), and the places Adam kept as they were are still as they were.
//
// Source, not behaviour: it reads the syntax tree of every non-test file under src/ (`accentSites`, so a comment that quotes the
// pattern is no site) and checks each style object that paints the accent. "A component a rebuilt screen uses" is read from the
// imports: everything the screen's file loads at run time, followed through the files it loads (`reachableFrom`; a type-only import
// is erased by the compiler and uses nothing). The sheets' own tests prove the rendered result where they draw it (`textOnAccent`, in
// TargetPickers.test.tsx, CuesSheet.test.tsx and ExercisePickerSheet.test.tsx); this file proves the rest at the line that writes the
// colour.

const SRC = fileURLToPath(new URL('../', import.meta.url))

// The screens 1.2 rebuilds, by the file each starts from. A chunk that renames or replaces one (65 replaces ProgramsPage with the
// PROGRAMS tab) changes its line here; a missing file fails the test instead of leaving it reading nothing.
const REBUILT_SCREENS: Record<string, string> = {
  'features/plan/PlanPage.tsx': 'Plan',
  'features/programs/ProgramsPage.tsx': 'PROGRAMS',
  'features/programs/ChangeProgramPage.tsx': 'CHANGE THE PROGRAM',
  'features/planner/PlannerPage.tsx': 'the stepped program planner',
  'features/gym/GymSession.tsx': 'the workout screen',
}

// Components that more than one screen loads, or that sit in the folder of a screen other than the one that loads them, each with the
// rebuilt screens that load it. They take the token because a rebuilt screen uses them (DECISIONS 154: "the shared components they
// use"). Every file here must draw something in `--on-accent`, and the screens named must really load it.
const SHARED_COMPONENTS: Record<string, string[]> = {
  // Library's confirms load it too, so they draw the near-black as well
  'components/ConfirmDialog.tsx': ['features/plan/PlanPage.tsx', 'features/programs/ChangeProgramPage.tsx'],
  'components/ExercisePickerSheet.tsx': ['features/programs/ChangeProgramPage.tsx'],
  'components/pickers/CuesSheet.tsx': ['features/programs/ChangeProgramPage.tsx'],
  'components/pickers/TargetPickerSheet.tsx': ['features/programs/ChangeProgramPage.tsx'],
  // the ENERGY and PUMP chips: Plan's session panel, the planner's volume step, the workout's finish step and set rows
  'features/gym/RatingChips.tsx': ['features/plan/PlanPage.tsx', 'features/planner/PlannerPage.tsx', 'features/gym/GymSession.tsx'],
  // the planner's FOCUS / DON'T CARE marks, kept in Plan's folder
  'features/plan/MarkSelector.tsx': ['features/planner/PlannerPage.tsx'],
  // the planner's field editors, which Plan's structure rows and CHANGE THE PROGRAM load too
  'features/planner/designFieldEditors.tsx': ['features/plan/PlanPage.tsx', 'features/programs/ChangeProgramPage.tsx', 'features/planner/PlannerPage.tsx'],
}

// The places on screens 1.2 doesn't rebuild, by file: how many accent backgrounds with text on them each file holds. They keep their
// current code, which draws that text in `--base` (DECISIONS 154). A file holding more or fewer than it is listed for, or one that
// is not listed, fails; so does one of them on the token. No rebuilt screen loads any of these files (below): one that did would be a
// shared component, and a shared component takes the token.
const NOT_REBUILT: Record<string, number> = {
  'components/Nav.tsx': 1, // INSTALL, the app shell's strip (the bottom bar's tabs and strips are not a screen; chunk 65 keeps them)
  'features/auth/LoginPage.tsx': 1, // sign-in: Sign in
  'features/gym/CompletedTodayScreen.tsx': 3, // Today, after a session is finished (SPEC: finished session unchanged)
  'features/gym/MissedSessionPrompt.tsx': 1, // Today
  'features/gym/PreviewExerciseCard.tsx': 1, // Today's session preview
  'features/gym/SequenceTodayPage.tsx': 1, // Today, a sequence run
  'features/gym/SessionPreview.tsx': 1, // Today's session preview
  'features/gym/TodayPage.tsx': 2, // Today: START SESSION and GO TO PROGRAM
  'features/history/HistoryPage.tsx': 1, // History: the picked tab
  'features/history/HistorySessions.tsx': 3, // History: the status and muscle chips
  'features/library/ExerciseForm.tsx': 1, // Library
  'features/library/LibraryCatalog.tsx': 1, // Library
  'features/library/LibraryPage.tsx': 1, // Library
  'features/library/ReassignSheet.tsx': 2, // Library
  'features/progress/ExercisePicker.tsx': 2, // Progress and History's exercise lists: the muscle chips
  'features/progress/ProgressPage.tsx': 1, // Progress: the picked tab
  'features/pwa/PwaUpdateNotice.tsx': 1, // the update notice, the app shell's strip
  'features/settings/DeloadRulesEditor.tsx': 1, // Settings: the chips
  'features/settings/SettingsPage.tsx': 1, // Settings: the chips (chunk 49's two rows draw with them)
}

// Accent backgrounds with nothing to read on them (dots, a bar, a toggle's track, a radio's dot), by file: how many of
// them the file holds. Their colour is not text, so they have no colour to check. A file holding more of them than it is listed for, or
// one that is not listed, fails.
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

// Coach is frozen (Escalation 16; check-frozen-code.mjs fails on any change under it) and stays exactly as it is (DECISIONS 154): its 15
// places stay on `--base`.
const COACH = 'features/coach/'

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

type Kind = 'token' | 'base' | 'unread' | 'other'
const kindOf = (site: AccentSite): Kind => (hasOnAccent(site) ? 'token' : usesBase(site) ? 'base' : site.colours.length === 0 ? 'unread' : 'other')
const perFile = (sites: AccentSite[]) => {
  const counts: Record<string, number> = {}
  for (const site of sites) counts[site.file] = (counts[site.file] ?? 0) + 1
  return counts
}

// The places in the rebuilt screens and the components they use: every site that is neither Coach nor in a file of a screen 1.2 doesn't rebuild.
const REBUILT_SITES = SITES.filter((site) => !(site.file in NOT_REBUILT))
const NOT_REBUILT_SITES = SITES.filter((site) => site.file in NOT_REBUILT && kindOf(site) !== 'unread')
// Every file the rebuilt screens load at run time, with the screens that load it.
const USED = reachableFrom(Object.keys(REBUILT_SCREENS), new Map(FILES.map((f) => [f.path, f.text])))

describe('text on the accent is --on-accent in the screens 1.2 rebuilds and the components they use', () => {
  it('the scan reads the app, not just the sheets (so the absences below are not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(150)
    const drawn = SITES.filter(hasOnAccent)
    expect(drawn.length).toBeGreaterThan(40)
    const folders = [...new Set(drawn.map((site) => site.file.split('/').slice(0, 2).join('/')))]
    // the 1.2 sheets, and the rebuilt screens' folders
    for (const folder of ['components/pickers', 'features/gym', 'features/plan', 'features/planner', 'features/programs']) {
      expect(folders, folder).toContain(folder)
    }
    // and none of the folders of the screens 1.2 doesn't rebuild
    for (const folder of ['features/auth', 'features/history', 'features/library', 'features/progress', 'features/pwa', 'features/settings']) {
      expect(folders, folder).not.toContain(folder)
    }
    expect(REBUILT_SITES.length + NOT_REBUILT_SITES.length).toBeGreaterThan(70)
  })

  it('every accent background in a rebuilt screen or a component it uses that has something to read draws it in --on-accent', () => {
    const offenders = REBUILT_SITES.filter((site) => kindOf(site) !== 'token' && kindOf(site) !== 'unread')
    expect(offenders.map(where)).toEqual([])
  })

  it('none of them draws --base on the accent (an element is not half converted: a child span, a second icon or a ternary branch left behind)', () => {
    const offenders = REBUILT_SITES.filter((site) => usesBase(site) && !isErrorBranch(site))
    expect(offenders.map(where)).toEqual([])
  })

  it("the screens 1.2 doesn't rebuild keep their current code: every place is still on --base, file by file (DECISIONS 154)", () => {
    expect(perFile(NOT_REBUILT_SITES)).toEqual(NOT_REBUILT)
    // not one of them on the token, and none on another colour: they read as they did before #135
    expect(NOT_REBUILT_SITES.filter((site) => kindOf(site) !== 'base').map(where)).toEqual([])
  })

  it('the accent backgrounds with nothing to read are exactly the dots, bars and tracks listed, file by file', () => {
    const unread = SITES.filter((site) => kindOf(site) === 'unread')
    expect(perFile(unread)).toEqual(NOTHING_TO_READ)
    // a listed element that drew text would have to draw it in --on-accent: none has a colour of its own
    expect(unread.filter((site) => site.colours.length > 0).map(where)).toEqual([])
  })

  it('the token is on files that a rebuilt screen loads and on no others', () => {
    const outside = SITES.filter((site) => hasOnAccent(site) && !USED.has(site.file))
    expect(outside.map((site) => `${where(site)}  -- no rebuilt screen loads ${site.file}: wire it to its screen, or this place is on a screen 1.2 does not rebuild`)).toEqual([])
  })

  it("a file of a screen 1.2 doesn't rebuild is loaded by no rebuilt screen: a file one loads is a shared component, and it takes the token", () => {
    const shared = Object.keys(NOT_REBUILT).filter((file) => USED.has(file))
    expect(shared.map((file) => `${file} is loaded by ${[...USED.get(file)!].join(', ')}`)).toEqual([])
  })

  it('the shared components are loaded by the rebuilt screens they are listed for, and each draws something in --on-accent', () => {
    for (const [file, screens] of Object.entries(SHARED_COMPONENTS)) {
      expect([...(USED.get(file) ?? [])].sort(), file).toEqual(expect.arrayContaining(screens))
      expect(SITES.filter((site) => site.file === file && hasOnAccent(site)).length, `${file} draws on the token`).toBeGreaterThan(0)
    }
    for (const screen of Object.values(SHARED_COMPONENTS).flat()) expect(Object.keys(REBUILT_SCREENS), screen).toContain(screen)
  })

  it("ConfirmDialog's confirm button is the one --base next to --on-accent: --base on the --error background of its danger variant, --on-accent on the accent", () => {
    const site = SITES.find((s) => s.file === 'components/ConfirmDialog.tsx')!
    expect(site.background).toBe("danger ? 'var(--error)' : 'var(--accent)'")
    expect(site.colours).toEqual(["danger ? 'var(--base)' : 'var(--on-accent)'"])
  })

  it('Coach, which is frozen, stays exactly as it is, on --base (DECISIONS 154)', () => {
    expect(COACH_SITES.length).toBeGreaterThan(0)
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
