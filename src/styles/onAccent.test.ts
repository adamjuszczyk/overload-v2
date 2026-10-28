import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `--on-accent`: the colour of text that sits on the accent (DECISIONS 128 (g), 129 (d) and 130 (j); Adam,
// 2026-10-15: "add a new token --on-accent in global.css for both themes, set to the near-black the boards draw,
// and use it wherever text sits on the accent"). Where it is declared is a provisional choice under D31 (128 (g)):
// the app declares every colour value, both themes, in tokens.css, and global.css only maps tokens to Tailwind
// utilities, as it does for --accent, so the value is in tokens.css and its mapping in global.css.
// The sheets that draw text on the accent are proven to use it where they draw it (TargetPickers.test.tsx,
// CuesSheet.test.tsx, ExercisePickerSheet.test.tsx); this file proves the token itself.

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8')

/** The declarations inside the block that opens with `selector {` (the file has no nested blocks). */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

const declared = (declarations: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(declarations)?.[1]
const valueIn = (declarations: string) => declared(declarations, '--on-accent')

/** The near-black each board draws for text on the accent: `onAccent: '#0d0d0c'` in the board's source. */
function boardValues(): { file: string; value: string }[] {
  const dir = join(root, 'design', '1.2', 'source')
  const found: { file: string; value: string }[] = []
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.dc.html'))) {
    for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/onAccent:\s*'(#[0-9a-fA-F]{6})'/g)) found.push({ file, value: match[1].toLowerCase() })
  }
  return found
}

describe('--on-accent', () => {
  const tokens = read('src', 'styles', 'tokens.css')

  it('is declared for both themes, the dark one on :root and the light one on [data-theme="light"]', () => {
    expect(valueIn(block(tokens, ':root'))).toBeDefined()
    expect(valueIn(block(tokens, '[data-theme="light"]'))).toBeDefined()
  })

  it('is the near-black the boards draw, in both themes: every board that draws text on the accent draws this one colour', () => {
    const drawn = boardValues()
    // 61 boards draw it today; a scan that finds none would prove nothing
    expect(drawn.length).toBeGreaterThan(40)
    const colours = [...new Set(drawn.map((board) => board.value))]
    expect(colours).toHaveLength(1)
    expect(valueIn(block(tokens, ':root'))?.toLowerCase()).toBe(colours[0])
    expect(valueIn(block(tokens, '[data-theme="light"]'))?.toLowerCase()).toBe(colours[0])
  })

  it('is one colour in both themes, where --base is near-white in the light theme and --text-primary near-white in the dark one', () => {
    const dark = block(tokens, ':root')
    const light = block(tokens, '[data-theme="light"]')
    expect(valueIn(dark)).toBe(valueIn(light))
    expect(valueIn(light)).not.toBe(declared(light, '--base'))
    expect(valueIn(dark)).not.toBe(declared(dark, '--text-primary'))
    expect(declared(light, '--base')).toBe('#f9f9f8')
    expect(declared(dark, '--text-primary')).toBe('#f4f3ef')
  })

  it('is mapped for Tailwind in global.css the way --accent is, with no value of its own there', () => {
    const global = read('src', 'styles', 'global.css')
    // The mapped names are built, not written out: Tailwind reads every tracked file for the theme variables a
    // project uses, so a test that quoted one would put it in the built stylesheet (RULES.md).
    const maps = (name: string, token: string) => new RegExp(`--color-${name}:\\s*var\\(${token}\\);`).test(global)
    expect(maps('accent', '--accent')).toBe(true)
    expect(maps('on-accent', '--on-accent')).toBe(true)
    expect(global).not.toMatch(/--on-accent\s*:/)
  })
})
