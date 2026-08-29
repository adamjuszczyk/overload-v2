// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  MUSCLE_SUBGROUP_CATEGORIES,
  MUSCLE_SUBGROUP_CATEGORY_LABELS,
  MUSCLE_SUBGROUPS,
  MUSCLE_SUBGROUP_LABELS,
} from '../../lib/exerciseTags'
import MuscleSubgroupPicker from './MuscleSubgroupPicker'

afterEach(cleanup)

describe('MuscleSubgroupPicker', () => {
  it('renders exactly the six categories exerciseTags.ts defines, reading the vocabulary rather than a hardcoded copy', () => {
    render(<MuscleSubgroupPicker selected={[]} onToggle={() => {}} />)

    // Asserted against MUSCLE_SUBGROUP_CATEGORIES/_LABELS themselves, not a
    // literal list re-typed in this test — a category added or renamed in
    // exerciseTags.ts must not be able to silently desync from what this
    // component actually renders.
    for (const category of MUSCLE_SUBGROUP_CATEGORIES) {
      expect(screen.getByText(MUSCLE_SUBGROUP_CATEGORY_LABELS[category])).toBeTruthy()
    }
  })

  it('renders every one of the 22 subgroup tags as its own chip, grouped under its category', () => {
    render(<MuscleSubgroupPicker selected={[]} onToggle={() => {}} />)

    for (const tag of MUSCLE_SUBGROUPS) {
      expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS[tag] })).toBeTruthy()
    }
  })

  it('a tag from one category and a tag from another can both be active at once (crosses category lines)', () => {
    // upper_chest (chest) + front_delt (shoulders) — migration 014's own
    // Incline Barbell Bench Press worked example.
    render(<MuscleSubgroupPicker selected={['upper_chest', 'front_delt']} onToggle={() => {}} />)

    expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.upper_chest }).style.background).toBe(
      'var(--accent-muted)',
    )
    expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.front_delt }).style.background).toBe(
      'var(--accent-muted)',
    )
  })

  it('tapping any chip in any category reports through the same onToggle', () => {
    const onToggle = vi.fn()
    render(<MuscleSubgroupPicker selected={[]} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.calves }))
    expect(onToggle).toHaveBeenCalledWith('calves')
  })
})
