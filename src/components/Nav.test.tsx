// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Chunk 26 (SPEC.md "Navigation and settings" — "[P1] The program screen
// folds into the plan screen as its program tab"; TASKS.md chunk 26: "PROGRAM
// is gone from the bar"). useAuth is mocked at the hook layer (it value-
// imports the real Supabase client/Dexie at module load, same reason every
// other screen test in this codebase mocks it) so `user` is controllable per
// test; useOnlineStatus/useInstallPrompt are plain browser-API hooks with no
// such dependency, left real.

let mockUserId: string | null = null

vi.mock('../features/auth/useAuth', () => ({
  useAuth: () => ({ user: mockUserId ? { id: mockUserId } : null }),
}))

const { default: Nav } = await import('./Nav')

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  mockUserId = null
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const GATED_ID = '12e79b69-9891-4f53-a7cf-650edd83659f'
const OTHER_ID = 'a12527e1-a4c0-420f-b902-2eefdd8ff6d3'

function renderNav() {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <Nav />
    </MemoryRouter>,
  )
}

describe('Nav — the bottom bar (chunk 26: PROGRAM removed)', () => {
  it('for an ordinary user, shows exactly six tabs: TODAY, PLAN, PROGRESS, HISTORY, LIBRARY, SETTINGS — in that order, none of them PROGRAM', () => {
    vi.stubEnv('VITE_COACH_USER_ID', GATED_ID)
    mockUserId = OTHER_ID
    renderNav()

    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual([
      'TODAY', 'PLAN', 'PROGRESS', 'HISTORY', 'LIBRARY', 'SETTINGS',
    ])
    expect(screen.queryByText('PROGRAM')).toBeNull()
  })

  it('each tab\'s real route target (href), PLAN included — no tab points at /program any more', () => {
    vi.stubEnv('VITE_COACH_USER_ID', GATED_ID)
    mockUserId = OTHER_ID
    renderNav()

    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/today', '/plan', '/progress', '/history', '/library', '/settings',
    ])
  })

  it('the gated Coach user gets a seventh tab, COACH, linking to /coach — appended last', () => {
    vi.stubEnv('VITE_COACH_USER_ID', GATED_ID)
    mockUserId = GATED_ID
    renderNav()

    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual([
      'TODAY', 'PLAN', 'PROGRESS', 'HISTORY', 'LIBRARY', 'SETTINGS', 'COACH',
    ])
    expect(links[6].getAttribute('href')).toBe('/coach')
  })

  it('a logged-out user (no id) gets no Coach tab', () => {
    vi.stubEnv('VITE_COACH_USER_ID', GATED_ID)
    mockUserId = null
    renderNav()

    expect(screen.queryByText('COACH')).toBeNull()
  })
})

describe('Nav — 375px', () => {
  it('no rendered element carries a fixed pixel width wider than 375px (six or seven tabs must fit)', () => {
    vi.stubEnv('VITE_COACH_USER_ID', GATED_ID)
    mockUserId = GATED_ID
    const { container } = renderNav()

    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
