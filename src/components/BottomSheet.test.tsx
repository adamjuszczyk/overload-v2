// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import BottomSheet from './BottomSheet'
import { captureRender } from '../testing/captureRender'

// TASKS-1.2 chunk 38: the frame every 1.2 sheet shares. Nothing uses it yet; these tests are its
// whole proof, and the render in "draws board 2's frame" is the fixture for the 390 px screenshot
// (design/1.2/built/sheet-frame.png, laid beside board 2).

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const EYEBROW = "WEEK 2 · FROM WEEK 1'S PLAN"
const TITLE = "Copy last week's numbers"
const CTA = 'COPY INTO 4 WORKOUTS'

const rowStyle = {
  minHeight: 48,
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontWeight: 700,
  fontSize: 15,
  color: 'var(--text-primary)',
} as const

const ctaStyle = {
  height: 52,
  border: 0,
  borderRadius: 10,
  background: 'var(--accent)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)',
  fontWeight: 800,
  fontSize: 15,
  letterSpacing: '0.03em',
} as const

// What board 2 shows behind its sheet: the screen, covered by the scrim.
function PageBehind() {
  const card = { borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' } as const
  return (
    <div aria-hidden="true" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, color: 'var(--text-primary)' }}>PLAN</span>
      <div style={{ ...card, height: 56 }} />
      <div style={{ ...card, height: 220 }} />
    </div>
  )
}

function Frame({ onClose = () => {} }: { onClose?: () => void }) {
  return (
    <>
      <PageBehind />
      <BottomSheet
        eyebrow={EYEBROW}
        title={TITLE}
        onClose={onClose}
        footer={
          <button type="button" style={ctaStyle}>
            {CTA}
          </button>
        }
      >
        <div style={rowStyle}>Push 1</div>
        <div style={rowStyle}>Pull 1</div>
      </BottomSheet>
    </>
  )
}

/** An opener button and a sheet that is mounted while open, the way every screen uses it. */
function Harness({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <BottomSheet title="Harness sheet" onClose={() => setOpen(false)}>
          {children ?? <button type="button">Inside</button>}
        </BottomSheet>
      )}
    </>
  )
}

function openHarness(children?: ReactNode) {
  render(<Harness>{children}</Harness>)
  const opener = screen.getByRole('button', { name: 'Open' })
  opener.focus()
  fireEvent.click(opener)
  return opener
}

const scrim = () => document.querySelector('[data-bottom-sheet-scrim]') as HTMLElement
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

/** Presses a key on whatever has focus; false when something called preventDefault. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
}

describe('BottomSheet: the frame', () => {
  it("draws board 2's frame: handle, eyebrow, title, ×, the content, then the footer", () => {
    render(<Frame />)
    const dialog = screen.getByRole('dialog', { name: TITLE })
    const handle = dialog.firstElementChild as HTMLElement
    expect(handle.getAttribute('aria-hidden')).toBe('true')
    const parts = [
      handle,
      within(dialog).getByText(EYEBROW),
      within(dialog).getByRole('heading', { level: 2, name: TITLE }),
      within(dialog).getByRole('button', { name: 'Close' }),
      within(dialog).getByText('Push 1'),
      within(dialog).getByText('Pull 1'),
      within(dialog).getByRole('button', { name: CTA }),
    ]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    captureRender('sheet-frame', document.body)
  })

  it('shows nothing for an eyebrow or a footer that is not given', () => {
    render(
      <BottomSheet title="Start a program" onClose={() => {}}>
        <p>content</p>
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Start a program' })
    // the handle, the header and the content; no footer region
    expect(dialog.children).toHaveLength(3)
    // the heading block holds the title alone: no empty eyebrow line above it
    expect(screen.getByRole('heading', { name: 'Start a program' }).parentElement?.children).toHaveLength(1)
  })

  it('is a modal dialog named by its title, and its scrim is hidden from assistive technology', () => {
    render(<Frame />)
    const dialog = screen.getByRole('dialog', { name: TITLE })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(scrim().getAttribute('aria-hidden')).toBe('true')
  })

  it('is drawn straight into the body, outside the container it was rendered in', () => {
    const { container } = render(<Frame />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    const dialog = screen.getByRole('dialog')
    expect(dialog.closest('[data-bottom-sheet]')?.parentElement).toBe(document.body)
  })

  it('writes no colour literal of its own (hex)', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BottomSheet.tsx'), 'utf8')
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull()
  })
})

describe('BottomSheet: closing', () => {
  it('the × asks to close', () => {
    const onClose = vi.fn()
    render(<Frame onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a tap on the scrim asks to close; a tap anywhere on the sheet does not', () => {
    const onClose = vi.fn()
    render(<Frame onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    fireEvent.click(screen.getByText('Push 1'))
    fireEvent.click(screen.getByRole('heading', { name: TITLE }))
    fireEvent.click(screen.getByRole('button', { name: CTA }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(scrim())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape asks to close, once; other keys do not', () => {
    const onClose = vi.fn()
    render(<Frame onClose={onClose} />)
    press('a')
    press('Enter')
    press('Escapee')
    expect(onClose).not.toHaveBeenCalled()
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape calls the onClose of the latest render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(
      <BottomSheet title="T" onClose={first}>
        <p>x</p>
      </BottomSheet>,
    )
    rerender(
      <BottomSheet title="T" onClose={second}>
        <p>x</p>
      </BottomSheet>,
    )
    press('Escape')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('leaves an Escape that something inside already handled alone', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet title="T" onClose={onClose}>
        <input
          aria-label="New cue"
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.preventDefault()
          }}
        />
      </BottomSheet>,
    )
    const input = screen.getByRole('textbox', { name: 'New cue' })
    input.focus()
    press('Escape')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening once it is gone', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const onClose = vi.fn()
    const { unmount } = render(
      <BottomSheet title="T" onClose={onClose}>
        <p>x</p>
      </BottomSheet>,
    )
    const added = add.mock.calls.filter(([type]) => type === 'keydown').map(([, listener]) => listener)
    expect(added.length).toBeGreaterThan(0)
    unmount()
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown').map(([, listener]) => listener)
    for (const listener of added) expect(removed).toContain(listener)
    press('Escape')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('BottomSheet: sheets stacked', () => {
  function Stack() {
    const [lower, setLower] = useState(true)
    const [upper, setUpper] = useState(true)
    return (
      <>
        {lower && (
          <BottomSheet title="Lower sheet" onClose={() => setLower(false)}>
            <p>lower body</p>
          </BottomSheet>
        )}
        {/* closes at once, in the middle of the key event, as a flush between two listeners would */}
        {upper && (
          <BottomSheet title="Upper sheet" onClose={() => flushSync(() => setUpper(false))}>
            <p>upper body</p>
          </BottomSheet>
        )}
      </>
    )
  }

  it('Escape closes the one on top, then the next', () => {
    render(<Stack />)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    press('Escape')
    expect(screen.queryByRole('dialog', { name: 'Upper sheet' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Lower sheet' })).toBeTruthy()
    press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the page stays locked until the last sheet is gone, then gets its own overflow back', () => {
    document.body.style.overflow = 'auto'
    render(<Stack />)
    expect(document.body.style.overflow).toBe('hidden')
    press('Escape')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(document.body.style.overflow).toBe('hidden')
    press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('a sheet mounted later is drawn above, and Tab belongs to it', () => {
    render(<Stack />)
    const upper = screen.getByRole('dialog', { name: 'Upper sheet' })
    const lower = screen.getByRole('dialog', { name: 'Lower sheet' })
    expect(follows(lower, upper)).toBe(true)
    // focus on the lower sheet's × is outside the one on top: Tab is pulled up into it
    const lowerClose = within(lower).getByRole('button', { name: 'Close' })
    lowerClose.focus()
    expect(press('Tab')).toBe(false)
    expect(document.activeElement).toBe(within(upper).getByRole('button', { name: 'Close' }))
  })
})

describe('BottomSheet: the page behind', () => {
  it('does not scroll while a sheet is open, and gets its own overflow back after', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(<Frame />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('takes no touch panning on the scrim', () => {
    render(<Frame />)
    expect(scrim().style.touchAction).toBe('none')
  })
})

describe('BottomSheet: content taller than the screen', () => {
  it('scrolls inside the sheet: held to the screen, header and footer outside the scroll, nothing passed on', () => {
    render(<Frame />)
    const dialog = screen.getByRole('dialog')
    // taller content stops 64 px below the top of the screen (where the boards' tall sheets stop)
    expect(dialog.style.maxHeight).toBe('calc(100dvh - 64px)')
    const content = screen.getByText('Push 1').parentElement as HTMLElement
    expect(content.style.overflowY).toBe('auto')
    expect(content.style.overscrollBehavior).toBe('contain')
    expect(content.contains(screen.getByRole('button', { name: CTA }))).toBe(false)
    expect(content.contains(screen.getByRole('heading', { name: TITLE }))).toBe(false)
    expect(content.contains(screen.getByRole('button', { name: 'Close' }))).toBe(false)
  })
})

describe('BottomSheet: tall, and a toolbar (chunk 41: the exercise picker)', () => {
  const sheet = (props: { height?: 'content' | 'tall'; toolbar?: ReactNode; footer?: ReactNode } = {}) => (
    <BottomSheet title="Pick" onClose={() => {}} {...props}>
      <p>list</p>
    </BottomSheet>
  )

  it('is as tall as its content by default: no height of its own, only the cap', () => {
    render(sheet())
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.height).toBe('')
    expect(dialog.style.maxHeight).toBe('calc(100dvh - 64px)')
  })

  it('"tall" fills the whole height below the 64 px gap: the height is the cap, and the content still scrolls inside', () => {
    render(sheet({ height: 'tall' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.height).toBe('calc(100dvh - 64px)')
    expect(dialog.style.maxHeight).toBe('calc(100dvh - 64px)')
    const content = screen.getByText('list').parentElement as HTMLElement
    expect(content.style.overflowY).toBe('auto')
  })

  it('"content" says the same as leaving it out, and the height follows the prop while the sheet stays open', () => {
    const { rerender } = render(sheet({ height: 'content' }))
    expect(screen.getByRole('dialog').style.height).toBe('')
    rerender(sheet({ height: 'tall' }))
    expect(screen.getByRole('dialog').style.height).toBe('calc(100dvh - 64px)')
    rerender(sheet({ height: 'content' }))
    expect(screen.getByRole('dialog').style.height).toBe('')
  })

  it('draws the toolbar between the header and the content, outside the content\'s scroll', () => {
    render(
      sheet({
        toolbar: <button type="button">ALL</button>,
        footer: <button type="button">SWAP</button>,
      }),
    )
    const dialog = screen.getByRole('dialog')
    const toolbar = screen.getByRole('button', { name: 'ALL' })
    const parts = [
      screen.getByRole('heading', { level: 2, name: 'Pick' }),
      screen.getByRole('button', { name: 'Close' }),
      toolbar,
      screen.getByText('list'),
      screen.getByRole('button', { name: 'SWAP' }),
    ]
    for (let i = 1; i < parts.length; i++) expect(follows(parts[i - 1], parts[i])).toBe(true)
    const content = screen.getByText('list').parentElement as HTMLElement
    expect(content.contains(toolbar)).toBe(false)
    // handle, header, toolbar, content, footer
    expect(dialog.children).toHaveLength(5)
  })

  it('draws no toolbar region when none is given', () => {
    render(sheet())
    // handle, header and content: the same three as before the toolbar existed
    expect(screen.getByRole('dialog').children).toHaveLength(3)
  })

  it('keeps the toolbar inside the sheet\'s Tab ring: with nothing after it, Tab on it goes round to the ×', () => {
    render(
      <BottomSheet title="Pick" onClose={() => {}} toolbar={<button type="button">ALL</button>}>
        <p>list</p>
      </BottomSheet>,
    )
    const chip = screen.getByRole('button', { name: 'ALL' })
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    // between two controls inside, the browser moves focus; the trap only acts on the ends of the ring
    expect(press('Tab')).toBe(true)
    chip.focus()
    expect(press('Tab')).toBe(false)
    expect(document.activeElement).toBe(close)
    expect(press('Tab', { shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(chip)
  })
})

describe('BottomSheet: focus', () => {
  it('moves into the sheet when it opens and back to the opener when it closes', () => {
    const opener = openHarness()
    const dialog = screen.getByRole('dialog', { name: 'Harness sheet' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('leaves focus where a child took it (an autofocused input), and still returns it on close', () => {
    const opener = openHarness(<input aria-label="Name" autoFocus />)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
    press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('does not take focus back from something the caller focused while closing', () => {
    function Elsewhere() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <button type="button">Somewhere else</button>
          {open && (
            <BottomSheet
              title="T"
              onClose={() => {
                setOpen(false)
                screen.getByRole('button', { name: 'Somewhere else' }).focus()
              }}
            >
              <p>x</p>
            </BottomSheet>
          )}
        </>
      )
    }
    render(<Elsewhere />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Somewhere else' }))
  })

  it('survives React StrictMode running every effect twice', () => {
    document.body.style.overflow = 'auto'
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    )
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    expect(document.body.style.overflow).toBe('hidden')
    press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('auto')
  })

  describe('Tab stays inside', () => {
    // Tab order inside: the × in the header, the two inputs, then the footer button when there is one.
    // The four after the inputs cannot take focus, so none may be the end Tab wraps from or to.
    function withControls({ footer }: { footer: boolean }) {
      return render(
        <>
          <button type="button">Outside</button>
          <BottomSheet title="T" onClose={() => {}} footer={footer ? <button type="button">Done</button> : undefined}>
            <input aria-label="First" />
            <input aria-label="Second" />
            <input aria-label="Skipped by tabindex" tabIndex={-1} />
            <input aria-label="Skipped as disabled" disabled />
            <input aria-label="Skipped as hidden" type="hidden" />
            <div hidden>
              <button type="button">Skipped inside hidden</button>
            </div>
            <div aria-hidden="true">
              <button type="button">Skipped inside aria-hidden</button>
            </div>
          </BottomSheet>
        </>,
      )
    }
    const close = () => screen.getByRole('button', { name: 'Close' })
    const done = () => screen.getByRole('button', { name: 'Done' })
    const second = () => screen.getByRole('textbox', { name: 'Second' })

    it('Tab on the last control goes to the first', () => {
      withControls({ footer: true })
      done().focus()
      expect(press('Tab')).toBe(false)
      expect(document.activeElement).toBe(close())
    })

    it('Shift+Tab on the first control goes to the last', () => {
      withControls({ footer: true })
      close().focus()
      expect(press('Tab', { shiftKey: true })).toBe(false)
      expect(document.activeElement).toBe(done())
    })

    it('Shift+Tab on the sheet itself goes to the last control', () => {
      withControls({ footer: true })
      expect(document.activeElement).toBe(screen.getByRole('dialog'))
      expect(press('Tab', { shiftKey: true })).toBe(false)
      expect(document.activeElement).toBe(done())
    })

    it('wraps around the controls that can take focus, never to one that cannot', () => {
      withControls({ footer: false })
      second().focus()
      expect(press('Tab')).toBe(false)
      expect(document.activeElement).toBe(close())
      expect(press('Tab', { shiftKey: true })).toBe(false)
      expect(document.activeElement).toBe(second())
    })

    it('Tab pulls in focus that was outside the sheet', () => {
      withControls({ footer: true })
      screen.getByRole('button', { name: 'Outside' }).focus()
      expect(press('Tab')).toBe(false)
      expect(document.activeElement).toBe(close())
      screen.getByRole('button', { name: 'Outside' }).focus()
      expect(press('Tab', { shiftKey: true })).toBe(false)
      expect(document.activeElement).toBe(done())
    })

    it('leaves Tab between two controls inside to the browser', () => {
      withControls({ footer: true })
      screen.getByRole('textbox', { name: 'First' }).focus()
      expect(press('Tab')).toBe(true)
      expect(press('Tab', { shiftKey: true })).toBe(true)
    })

    it('holds focus on the sheet when it has nothing to tab to', () => {
      render(
        <BottomSheet title="T" onClose={() => {}}>
          <p>text</p>
        </BottomSheet>,
      )
      // the × is always there, so take it out of play to prove the no-control path
      const closeButton = screen.getByRole('button', { name: 'Close' })
      closeButton.setAttribute('disabled', '')
      expect(press('Tab')).toBe(false)
      expect(document.activeElement).toBe(screen.getByRole('dialog'))
    })
  })
})
