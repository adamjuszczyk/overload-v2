import { describe, expect, it } from 'vitest'
import { accentSites } from './accentSites'

// The reader that `textOnAccent.static.test.ts` stands on. Each test feeds it a few lines of source in one of the
// shapes the app writes, so a change to the reader that stops it seeing a shape fails here and not silently there.

const sitesOf = (source: string) => accentSites(source, 'sample.tsx')

describe('accentSites: every style object that paints the accent, and the colours drawn on it', () => {
  it('a plain value: the background and the colour of the same style', () => {
    const [site] = sitesOf(`
      export const A = () => <button style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>GO</button>
    `)
    expect(site).toMatchObject({ kind: 'element', background: "'var(--accent)'", colours: ["'var(--on-accent)'"], line: 2 })
  })

  it('`backgroundColor` is a background too, and the colour may come before it', () => {
    const [site] = sitesOf(`
      export const A = () => <b style={{ color: 'var(--base)', backgroundColor: 'var(--accent)' }}>GO</b>
    `)
    expect(site.colours).toEqual(["'var(--base)'"])
  })

  it('a ternary: either branch can be the accent, and the colour is the ternary as written', () => {
    const sites = sitesOf(`
      export const A = ({ on, busy }) => (
        <>
          <button style={{ background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--text-muted)' }}>A</button>
          <button style={{ background: busy ? 'var(--border-strong)' : 'var(--accent)', color: busy ? 'var(--text-muted)' : 'var(--base)' }}>B</button>
        </>
      )
    `)
    expect(sites.map((s) => s.colours)).toEqual([["on ? 'var(--on-accent)' : 'var(--text-muted)'"], ["busy ? 'var(--text-muted)' : 'var(--base)'"]])
  })

  it('a child span: the text sits in an element inside the one that paints the accent, and its colour is read', () => {
    const [site] = sitesOf(`
      export const A = ({ now }) => (
        <div style={{ background: now ? 'var(--accent)' : 'var(--surface-overlay)', padding: 4 }}>
          <span style={{ fontWeight: 900, color: now ? 'var(--on-accent)' : 'var(--text-muted)' }}>WEEK 1</span>
        </div>
      )
    `)
    expect(site.kind).toBe('element')
    expect(site.colours).toEqual(["now ? 'var(--on-accent)' : 'var(--text-muted)'"])
  })

  it('a child span left on --base is read as --base: the child is not forgiven for the parent', () => {
    const [site] = sitesOf(`
      export const A = () => (
        <div style={{ background: 'var(--accent)' }}>
          <span style={{ color: 'var(--base)' }}>WEEK 1</span>
        </div>
      )
    `)
    expect(site.colours).toEqual(["'var(--base)'"])
  })

  it("an element's own colour and its children's are all returned, its own first", () => {
    const [site] = sitesOf(`
      export const A = () => (
        <button style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          <span style={{ color: 'var(--on-accent)' }}>a</span>
          <span style={{ color: 'var(--base)' }}>b</span>
        </button>
      )
    `)
    expect(site.colours).toEqual(["'var(--on-accent)'", "'var(--on-accent)'", "'var(--base)'"])
  })

  it('an icon that takes its colour as an attribute is read, as a string or as an expression', () => {
    const [site] = sitesOf(`
      export const A = ({ c }) => (
        <button style={{ background: 'var(--accent)' }}>
          <Plus color="var(--on-accent)" />
          <Minus stroke={c} />
        </button>
      )
    `)
    expect(site.colours).toEqual(['"var(--on-accent)"', 'c'])
  })

  it('a style object on its own (a constant, a returned value) is read as it is', () => {
    const sites = sitesOf(`
      const SUBMIT_STYLE: CSSProperties = { height: 52, background: 'var(--accent)', color: 'var(--on-accent)' }
      const DOT_STYLE = { width: 8, height: 8, background: 'var(--accent)' }
      function chip(active) { return { background: active ? 'var(--accent)' : 'var(--surface)', color: active ? 'var(--on-accent)' : 'var(--text-muted)' } }
    `)
    expect(sites.map((s) => [s.kind, s.colours])).toEqual([
      ['object', ["'var(--on-accent)'"]],
      ['object', []],
      ['object', ["active ? 'var(--on-accent)' : 'var(--text-muted)'"]],
    ])
  })

  it('a dot with nothing in it has no colours', () => {
    const [site] = sitesOf(`
      export const A = () => <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
    `)
    expect(site.colours).toEqual([])
  })

  it('a tint made from the accent, or a muted accent, is not the accent', () => {
    expect(
      sitesOf(`
        export const A = ({ active }) => (
          <>
            <button style={{ background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--surface)', color: 'var(--accent)' }}>a</button>
            <button style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>b</button>
            <button style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>c</button>
          </>
        )
      `),
    ).toEqual([])
  })

  it('a comment that quotes the pattern is not code, so it is no site (the comment-only control)', () => {
    expect(
      sitesOf(`
        // background: 'var(--accent)', color: 'var(--base)'
        /* <button style={{ background: 'var(--accent)', color: 'var(--base)' }}>old</button> */
        export const A = () => <button style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}>fine</button>
      `),
    ).toEqual([])
  })

  it('a .ts file is read too, and two accents in one file are two sites', () => {
    const sites = accentSites(
      `export const a = { background: 'var(--accent)', color: 'var(--on-accent)' }\nexport const b = { backgroundColor: 'var(--accent)', color: 'var(--base)' }`,
      'styles.ts',
    )
    expect(sites.map((s) => [s.file, s.line, s.colours])).toEqual([
      ['styles.ts', 1, ["'var(--on-accent)'"]],
      ['styles.ts', 2, ["'var(--base)'"]],
    ])
  })
})
