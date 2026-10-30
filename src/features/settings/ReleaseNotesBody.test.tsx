// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { Release } from '../../data/releaseNotes'
import ReleaseNotesBody, { formatReleaseDate } from './ReleaseNotesBody'

// The notes of one release as groups of short lines (SPEC.md 1.2.1, Settings · WHAT'S NEW): the one body the notes screen and the sheet
// after an update both draw.

afterEach(() => cleanup())

const RELEASE: Release = {
  version: '9.9',
  date: '2026-01-02',
  groups: [
    { title: 'Plan, rebuilt', items: ['First line.', 'Second line, with "quotes" and an arrow → here.'] },
    { title: 'Words', items: ['Only line.'] },
  ],
}

describe('ReleaseNotesBody', () => {
  it('draws each group as its upper-case title over a list of its lines, in the order the data has them', () => {
    const { container } = render(<ReleaseNotesBody release={RELEASE} />)
    expect(screen.getByText('PLAN, REBUILT')).toBeTruthy()
    expect(screen.getByText('WORDS')).toBeTruthy()
    const lists = container.querySelectorAll('ul')
    expect(lists).toHaveLength(2)
    expect(within(lists[0] as HTMLElement).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'First line.',
      'Second line, with "quotes" and an arrow → here.',
    ])
    expect(within(lists[1] as HTMLElement).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Only line.'])
  })

  it('draws a line twice when the data has it twice (no line is dropped for matching another)', () => {
    const twice: Release = { version: '1', date: '2026-01-01', groups: [{ title: 'Same', items: ['Again.', 'Again.'] }] }
    render(<ReleaseNotesBody release={twice} />)
    expect(screen.getAllByText('Again.')).toHaveLength(2)
  })

  it('lets an unbroken long word wrap inside its line (nothing runs past the edge)', () => {
    const long: Release = { version: '1', date: '2026-01-01', groups: [{ title: 'Long', items: ['X'.repeat(80)] }] }
    render(<ReleaseNotesBody release={long} />)
    expect(screen.getByText('X'.repeat(80)).style.overflowWrap).toBe('anywhere')
  })

  it('writes no colour of its own: every colour is a token', () => {
    const { container } = render(<ReleaseNotesBody release={RELEASE} />)
    const colours = Array.from(container.querySelectorAll<HTMLElement>('[style]')).flatMap((el) => [el.style.color, el.style.background].filter(Boolean))
    expect(colours.length).toBeGreaterThan(0)
    for (const colour of colours) expect(colour).toMatch(/^var\(--[a-z-]+\)$/)
  })
})

describe('formatReleaseDate', () => {
  it.each([
    ['2026-11-05', '5 NOV 2026'],
    ['2026-10-28', '28 OCT 2026'],
    ['2026-01-02', '2 JAN 2026'],
    ['2027-12-31', '31 DEC 2027'],
  ])('%s is %s', (iso, shown) => {
    expect(formatReleaseDate(iso)).toBe(shown)
  })
})
