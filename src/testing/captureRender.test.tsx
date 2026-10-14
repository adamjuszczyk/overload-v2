// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPTURE_ENV_VAR, captureRender, fixtureDirFor, fixtureFile, isCaptureEnabled } from './captureRender'

// captureRender writes a file, so each rule has a test that fails when it is
// broken: only CAPTURE_RENDER=1 writes; what is written is the element's
// innerHTML (the way GymSession.d30.test.tsx compares `container.innerHTML`),
// not its outerHTML or the whole body; it lands in the calling test's
// __fixtures__ folder; a name can't carry a path.

function Demo() {
  return (
    <main>
      <h1>PLAN</h1>
      <p>WEEK 1</p>
      <button type="button">MARK WEEK AS DELOAD</button>
    </main>
  )
}

function WithSheet() {
  return (
    <>
      <p>PAGE TEXT</p>
      {createPortal(<div role="dialog">SHEET TEXT</div>, document.body)}
    </>
  )
}

let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'capture-render-'))
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

describe('captureRender: opt-in', () => {
  it.each([undefined, '', '0', 'true', 'yes', ' 1'])('writes nothing, not even the folder, when %j', (value) => {
    vi.stubEnv(CAPTURE_ENV_VAR, value)
    const { container } = render(<Demo />)
    const dir = join(scratch, '__fixtures__')
    expect(isCaptureEnabled()).toBe(false)
    expect(captureRender('demo', container, { dir })).toBeNull()
    expect(existsSync(dir)).toBe(false)
  })

  it('writes with CAPTURE_RENDER=1', () => {
    vi.stubEnv(CAPTURE_ENV_VAR, '1')
    const { container } = render(<Demo />)
    expect(isCaptureEnabled()).toBe(true)
    expect(captureRender('demo', container, { dir: scratch })).toBe(join(scratch, 'demo.html'))
    expect(existsSync(join(scratch, 'demo.html'))).toBe(true)
  })
})

describe('captureRender: what is written', () => {
  it("is the container's innerHTML exactly: the render's own markup, not the container's wrapper", () => {
    vi.stubEnv(CAPTURE_ENV_VAR, '1')
    const { container } = render(<Demo />)
    const file = captureRender('demo', container, { dir: scratch })
    const written = readFileSync(file as string, 'utf8')
    expect(written).toBe(container.innerHTML)
    expect(written.startsWith('<main>')).toBe(true)
    // the strings, in the order the screen shows them
    const at = ['PLAN', 'WEEK 1', 'MARK WEEK AS DELOAD'].map((s) => written.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    // the other things a careless writer would send are different strings
    expect(written).not.toBe(container.outerHTML)
    expect(written).not.toBe(document.body.innerHTML)
  })

  it("misses a portalled sheet unless the caller passes document.body (the advice in the file's header)", () => {
    vi.stubEnv(CAPTURE_ENV_VAR, '1')
    const { container } = render(<WithSheet />)
    const fromContainer = readFileSync(captureRender('page', container, { dir: scratch }) as string, 'utf8')
    const fromBody = readFileSync(captureRender('page-and-sheet', document.body, { dir: scratch }) as string, 'utf8')
    expect(fromContainer).toContain('PAGE TEXT')
    expect(fromContainer).not.toContain('SHEET TEXT')
    expect(fromBody).toContain('PAGE TEXT')
    expect(fromBody).toContain('SHEET TEXT')
  })

  it('creates the folder when it is missing and overwrites an earlier capture', () => {
    vi.stubEnv(CAPTURE_ENV_VAR, '1')
    const dir = join(scratch, 'features', 'plan', '__fixtures__')
    const first = render(<Demo />)
    captureRender('demo', first.container, { dir })
    first.unmount()
    const second = render(<p>second</p>)
    captureRender('demo', second.container, { dir })
    expect(readdirSync(dir)).toEqual(['demo.html'])
    expect(readFileSync(join(dir, 'demo.html'), 'utf8')).toBe('<p>second</p>')
  })
})

describe('captureRender: the name', () => {
  it.each(['', 'a/b', '../x', 'x.html', '.hidden', 'a b', '-x', 'x\\y'])('rejects %j, also when capturing is off', (name) => {
    vi.stubEnv(CAPTURE_ENV_VAR, undefined)
    const { container } = render(<Demo />)
    expect(() => captureRender(name, container, { dir: scratch })).toThrow(/not a fixture name/)
    expect(readdirSync(scratch)).toEqual([])
  })

  it.each(['plan-week-1', 'W7_sheet', 'planpage-chunk6-render', '1'])('accepts %j', (name) => {
    expect(fixtureFile(name, { dir: scratch })).toBe(join(scratch, `${name}.html`))
  })
})

describe('captureRender: where it writes by default', () => {
  const here = dirname(fileURLToPath(import.meta.url))

  it("is a __fixtures__ folder beside the calling test file (the folders GymSession.d30.test.tsx and PlanPage.renderParity.test.tsx already use)", () => {
    expect(fixtureDirFor('/repo/src/features/plan/Plan.test.tsx')).toBe('/repo/src/features/plan/__fixtures__')
    expect(fixtureFile('demo')).toBe(join(here, '__fixtures__', 'demo.html'))
  })

  it('writes there when no folder is given, and returns that path', () => {
    vi.stubEnv(CAPTURE_ENV_VAR, '1')
    const fixtures = join(here, '__fixtures__')
    const existedBefore = existsSync(fixtures)
    const { container } = render(<Demo />)
    const expected = join(fixtures, 'capturerender-selftest.html')
    try {
      expect(captureRender('capturerender-selftest', container)).toBe(expected)
      expect(readFileSync(expected, 'utf8')).toBe(container.innerHTML)
    } finally {
      rmSync(expected, { force: true })
      if (!existedBefore && existsSync(fixtures) && readdirSync(fixtures).length === 0) rmdirSync(fixtures)
    }
    expect(existsSync(expected)).toBe(false)
  })
})
