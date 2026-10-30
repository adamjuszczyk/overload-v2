import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// version.ts reads the build's define when it loads; an import is hoisted above any statement, so the stub goes in a hoisted block.
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1'))
import { compareVersions } from '../lib/version'
import { RELEASES } from './releaseNotes'

// TASKS.md 1.2.1, chunk 71: the data file is the source of truth for what a release says (DECISIONS 265), and 1.2's entry is the
// "What's new" section of docs/release-1.2-notes.md, word for word (SPEC.md, Release notes). This file proves the entry against the
// notes file line by line, and the shape of every entry: what Settings' WHAT'S NEW and the sheet after an update draw from.

const NOTES_FILE = fileURLToPath(new URL('../../docs/release-1.2-notes.md', import.meta.url))

interface NotesGroup {
  title: string
  items: string[]
}

/** The notes file's "What's new" section: `- **Title.**` with its `  - line`s, or `- **Title.** one line`. */
function whatsNewOf(markdown: string): NotesGroup[] {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === "## What's new")
  if (start < 0) throw new Error('docs/release-1.2-notes.md has no "## What\'s new" section')
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  const groups: NotesGroup[] = []
  for (const line of lines.slice(start + 1, next < 0 ? undefined : next)) {
    const group = /^- \*\*(.+?)\.\*\*\s*(.*)$/.exec(line)
    if (group) {
      groups.push({ title: group[1], items: group[2] ? [group[2]] : [] })
      continue
    }
    const item = /^ {2}- (.+)$/.exec(line)
    if (item && groups.length > 0) {
      groups[groups.length - 1].items.push(item[1])
      continue
    }
    if (line.trim() !== '') throw new Error(`a line of the notes file's "What's new" this test does not read: ${line}`)
  }
  return groups
}

// The words the UI never says (scripts/check-wording.test.mjs, SPEC Language [1.2] C12; DECISIONS 251): the guard scans this data file
// like any other. 1.2's notes said some of them; these are the only lines of the entry that differ from the notes file, each with the
// line as the notes file has it, and the test below holds every other line to the file exactly.
const BANNED = [/\bruns?\b/i, /\bmeso(?:s|cycles?)?\b/i, /\b(?:un)?tag(?:s|ged|ging)?\b/i, /\bchange\s+(?:the\s+)?plan\b/i]
const REWORDED: Record<string, string> = {
  "A week is planned when it starts, or a week ahead with PLAN FORWARD: structure, volume and set types, and no weights, reps or RIR. A stable run takes its default's rep targets.":
    "A week is planned when it starts, or a week ahead with PLAN FORWARD: structure, volume and set types, and no weights, reps or RIR. A stable program takes its default's rep targets.",
  '"Program" everywhere (never meso or mesocycle), "cues" (never tags), "change the program".': '"Program" everywhere, "cues", "change the program".',
}

const notesFile = whatsNewOf(readFileSync(NOTES_FILE, 'utf8'))
const release12 = RELEASES.find((release) => release.version === '1.2')

describe('1.2 entry against docs/release-1.2-notes.md', () => {
  it('the data file has a 1.2 entry, and the notes file has a section to compare it with', () => {
    expect(release12).toBeDefined()
    expect(notesFile.length).toBeGreaterThan(0)
  })

  it('has the same groups and the same number of lines, first and last line included', () => {
    const data = release12!.groups
    expect(data.map((group) => group.title)).toEqual(notesFile.map((group) => group.title))
    const dataLines = data.flatMap((group) => group.items)
    const fileLines = notesFile.flatMap((group) => group.items)
    expect(fileLines.length).toBe(22) // 7 + 5 + 8 + 1 + 1 (the section as written on 2026-10-27; the file is final)
    expect(dataLines.length).toBe(fileLines.length)
    expect(dataLines[0]).toBe(fileLines[0])
    expect(dataLines[0]).toBe('One week view per week.')
    expect(dataLines[dataLines.length - 1]).toBe(REWORDED[fileLines[fileLines.length - 1]])
  })

  it('says every line of the notes file word for word, except the reworded ones', () => {
    const data = release12!.groups
    notesFile.forEach((group, g) => {
      expect(data[g].items.length, group.title).toBe(group.items.length)
      group.items.forEach((line, i) => expect(data[g].items[i], `${group.title} / line ${i + 1}`).toBe(REWORDED[line] ?? line))
    })
  })

  it('rewords a line only because it says a word the UI never says, and the new line does not say it', () => {
    const fileLines = notesFile.flatMap((group) => group.items)
    expect(Object.keys(REWORDED).length).toBe(2)
    for (const [original, replacement] of Object.entries(REWORDED)) {
      expect(fileLines, 'the notes file no longer holds this line: drop its entry').toContain(original)
      expect(BANNED.some((word) => word.test(original)), `"${original}" says no banned word: do not reword it`).toBe(true)
      expect(BANNED.filter((word) => word.test(replacement)).map(String)).toEqual([])
    }
    // and every other line of the notes file says none, so nothing else needed rewording
    for (const line of fileLines.filter((l) => !(l in REWORDED))) expect(BANNED.filter((word) => word.test(line)).map(String), line).toEqual([])
  })
})

describe('every entry', () => {
  it('has a version of dotted numbers, newest first and strictly falling', () => {
    expect(RELEASES.length).toBeGreaterThanOrEqual(2)
    for (const release of RELEASES) expect(release.version).toMatch(/^\d+(\.\d+){1,2}$/)
    for (let i = 1; i < RELEASES.length; i += 1) {
      expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version), `${RELEASES[i - 1].version} then ${RELEASES[i].version}`).toBe(1)
    }
  })

  it('has a real ISO date, and no release is dated before the one under it', () => {
    for (const release of RELEASES) {
      expect(release.date, release.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(`${release.date}T00:00:00Z`).toISOString().slice(0, 10), `${release.version} is not a calendar date`).toBe(release.date)
    }
    for (let i = 1; i < RELEASES.length; i += 1) {
      expect(RELEASES[i - 1].date >= RELEASES[i].date, `${RELEASES[i - 1].version} is dated before ${RELEASES[i].version}`).toBe(true)
    }
  })

  it('is never empty: every release has groups, every group a title and lines, and no text has spaces round it or is blank', () => {
    for (const release of RELEASES) {
      expect(release.groups.length, release.version).toBeGreaterThan(0)
      const titles = release.groups.map((group) => group.title)
      expect(new Set(titles).size, `${release.version} repeats a group title`).toBe(titles.length)
      for (const group of release.groups) {
        expect(group.title.trim(), release.version).toBe(group.title)
        expect(group.title, release.version).not.toBe('')
        expect(group.items.length, `${release.version} / ${group.title}`).toBeGreaterThan(0)
        for (const item of group.items) {
          expect(item.trim(), `${release.version} / ${group.title}`).toBe(item)
          expect(item, `${release.version} / ${group.title}`).not.toBe('')
        }
      }
    }
  })
})
