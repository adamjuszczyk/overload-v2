// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { textOnAccent, textOnAccentColours } from './textOnAccent'

// The helper the sheets' "text on the accent is --on-accent" tests stand on. Each of those tests names the elements it expects, so a
// helper that found nothing would fail them; this file holds the helper's own rule: what counts as something to read on the accent.

afterEach(cleanup)

describe('textOnAccent: what sits on the accent colour', () => {
  it('finds an element with the accent as its background and text in it, in document order', () => {
    const { container } = render(
      <div>
        <button style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>FIRST</button>
        <button style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}>not on the accent</button>
        <span style={{ backgroundColor: 'var(--accent)', color: 'var(--base)' }}>SECOND</span>
      </div>,
    )
    expect(textOnAccent(container).map((el) => el.textContent)).toEqual(['FIRST', 'SECOND'])
    expect(textOnAccentColours(container)).toEqual(['var(--on-accent)', 'var(--base)'])
  })

  it('counts an icon as something to read, and a dot with nothing in it as nothing', () => {
    const { container } = render(
      <div>
        <span data-kind="tick" style={{ background: 'var(--accent)' }}>
          <svg />
        </span>
        <span data-kind="dot" style={{ background: 'var(--accent)' }} />
        <span data-kind="muted" style={{ background: 'var(--accent-muted)' }}>
          muted accent is not the accent
        </span>
      </div>,
    )
    expect(textOnAccent(container).map((el) => el.getAttribute('data-kind'))).toEqual(['tick'])
  })

  it('reads only what is under the root it is given', () => {
    const { container } = render(
      <div>
        <div id="inside">
          <b style={{ background: 'var(--accent)' }}>in</b>
        </div>
        <b style={{ background: 'var(--accent)' }}>out</b>
      </div>,
    )
    expect(textOnAccent(container.querySelector('#inside') as HTMLElement).map((el) => el.textContent)).toEqual(['in'])
  })
})
