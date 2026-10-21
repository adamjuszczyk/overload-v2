import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chunk 55 (SPEC [1.2] Volume per muscle (14), Settings (14b), G51: "applies to the VOLUME sheet only. History, Progress and the finish screen count as
// they do today"; TASKS 55: "History's `set_count` and the finish screen's tile don't change with the setting (absence over their tests)").
// Nothing but the sheet reads Settings' "Drops and stages count as" to count with it: this scans every source file under `src/` for the setting's field
// and fails on a reader that isn't one of the places that must name it. A reader in History, Progress, the finish screen or a set count would show here
// first, whatever its file is called. (`volumePerMuscle.test.ts` pins the other half: only the sheet imports the counting module.)

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    const isSource = /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.testutil\.tsx?$/.test(name)
    return isSource ? [path] : []
  })
}

// The setting by name: the app type's field and the table's column (`stageVolumeRule`, `stage_volume_rule`).
const NAMES_THE_SETTING = /stageVolumeRule|stage_volume_rule/

/** The files under `src/` that name the setting, as paths from `src/`. */
export function namesOfTheSetting(sources: Array<[path: string, text: string]>): string[] {
  return sources.filter(([, text]) => NAMES_THE_SETTING.test(text)).map(([path]) => path).sort()
}

describe('G51 — the Drops and stages rule is the VOLUME sheet\'s alone', () => {
  const sources = sourceFiles(SRC).map((path): [string, string] => [relative(SRC, path).split(sep).join('/'), readFileSync(path, 'utf8')])

  it('the scan finds a reader when there is one (a History read of the field, and the column\'s name)', () => {
    expect(namesOfTheSetting([['features/history/x.ts', 'const rule = settings.stageVolumeRule'], ['a.ts', 'select(`stage_volume_rule`)'], ['b.ts', 'const n = 1']])).toEqual(['a.ts', 'features/history/x.ts'])
  })

  it('only the type, the settings service and store, the Settings page and the VOLUME sheet name it (and the counting module, in a comment)', () => {
    expect(namesOfTheSetting(sources)).toEqual([
      'features/plan/VolumeSheet.tsx', // reads it from the store and hands it to `volumeRows`
      'features/plan/volumePerMuscle.ts', // names it in the parameter's own comment: the module never reads Settings
      'features/settings/SettingsPage.tsx', // edits it
      'features/settings/settingsService.ts', // maps the column
      'features/settings/settingsStore.ts', // its default
      'types/index.ts', // the field
    ])
  })

  it('the sheet is the only reader outside Settings: it takes the rule from the store, never from a prop or from History\'s counts', () => {
    const sheet = sources.find(([path]) => path === 'features/plan/VolumeSheet.tsx')![1]
    expect(sheet).toMatch(/useSettingsStore\(\(s\) => s\.stageVolumeRule\)/)
  })

  it('History\'s set count and the finish screen\'s tile read no setting by that name, whatever else they read', () => {
    const FINISH = ['features/gym/SessionComplete.tsx', 'features/gym/CompletedTodayScreen.tsx', 'features/gym/countCompletedSets.ts']
    const counts = sources.filter(([path]) => /^features\/history\//.test(path) || FINISH.includes(path))
    expect(counts.map(([path]) => path)).toEqual(expect.arrayContaining([...FINISH, 'features/history/HistorySessions.tsx', 'features/history/historyService.ts']))
    expect(counts.filter(([, text]) => NAMES_THE_SETTING.test(text)).map(([path]) => path)).toEqual([])
  })
})
