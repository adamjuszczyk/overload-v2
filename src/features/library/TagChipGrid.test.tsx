// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import TagChipGrid from './TagChipGrid'

afterEach(cleanup)

const VALUES = ['a', 'b', 'c'] as const
const LABELS = { a: 'ALPHA', b: 'BETA', c: 'GAMMA' }

describe('TagChipGrid', () => {
  it('renders every value with its label', () => {
    render(<TagChipGrid values={VALUES} labels={LABELS} selected={[]} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'ALPHA' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'BETA' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'GAMMA' })).toBeTruthy()
  })

  it('single-select shape: exactly one chip in `selected` renders as the only one active', () => {
    render(<TagChipGrid values={VALUES} labels={LABELS} selected={['b']} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'ALPHA' }).style.background).toBe('var(--surface)')
    expect(screen.getByRole('button', { name: 'BETA' }).style.background).toBe('var(--accent-muted)')
    expect(screen.getByRole('button', { name: 'GAMMA' }).style.background).toBe('var(--surface)')
  })

  it('multi-select shape: more than one chip in `selected` renders all of them active at once', () => {
    render(<TagChipGrid values={VALUES} labels={LABELS} selected={['a', 'c']} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'ALPHA' }).style.background).toBe('var(--accent-muted)')
    expect(screen.getByRole('button', { name: 'BETA' }).style.background).toBe('var(--surface)')
    expect(screen.getByRole('button', { name: 'GAMMA' }).style.background).toBe('var(--accent-muted)')
  })

  it('tapping a chip reports that chip\'s value via onToggle — the component has no selection logic of its own', () => {
    const onToggle = vi.fn()
    render(<TagChipGrid values={VALUES} labels={LABELS} selected={['a']} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: 'GAMMA' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('c')

    // Tapping an already-active chip still just reports the value — add-vs-
    // remove is entirely the caller's job (single-select toggle-to-clear vs
    // multi-select add/remove), never TagChipGrid's.
    fireEvent.click(screen.getByRole('button', { name: 'ALPHA' }))
    expect(onToggle).toHaveBeenCalledTimes(2)
    expect(onToggle).toHaveBeenLastCalledWith('a')
  })
})
