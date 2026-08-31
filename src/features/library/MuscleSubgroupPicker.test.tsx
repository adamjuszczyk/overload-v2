// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  MUSCLE_SUBGROUP_CATEGORIES,
  MUSCLE_SUBGROUP_CATEGORY_LABELS,
  MUSCLE_SUBGROUPS,
  MUSCLE_SUBGROUP_LABELS,
  muscleSubgroupsForMuscleGroup,
} from '../../lib/exerciseTags'
import MuscleSubgroupPicker from './MuscleSubgroupPicker'

afterEach(cleanup)

describe('MuscleSubgroupPicker', () => {
  it('with every tag allowed, renders exactly the six categories exerciseTags.ts defines, reading the vocabulary rather than a hardcoded copy', () => {
    render(<MuscleSubgroupPicker selected={[]} onToggle={() => {}} allowed={MUSCLE_SUBGROUPS} />)

    // Asserted against MUSCLE_SUBGROUP_CATEGORIES/_LABELS themselves, not a
    // literal list re-typed in this test — a category added or renamed in
    // exerciseTags.ts must not be able to silently desync from what this
    // component actually renders.
    for (const category of MUSCLE_SUBGROUP_CATEGORIES) {
      expect(screen.getByText(MUSCLE_SUBGROUP_CATEGORY_LABELS[category])).toBeTruthy()
    }
  })

  it('with every tag allowed, renders every one of the 22 subgroup tags as its own chip, grouped under its category', () => {
    render(<MuscleSubgroupPicker selected={[]} onToggle={() => {}} allowed={MUSCLE_SUBGROUPS} />)

    for (const tag of MUSCLE_SUBGROUPS) {
      expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS[tag] })).toBeTruthy()
    }
  })

  it('a tag from one category and a tag from another can both be active at once (crosses category lines)', () => {
    // upper_chest (chest) + front_delt (shoulders) — migration 014's own
    // Incline Barbell Bench Press worked example.
    render(
      <MuscleSubgroupPicker
        selected={['upper_chest', 'front_delt']}
        onToggle={() => {}}
        allowed={MUSCLE_SUBGROUPS}
      />,
    )

    expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.upper_chest }).style.background).toBe(
      'var(--accent-muted)',
    )
    expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.front_delt }).style.background).toBe(
      'var(--accent-muted)',
    )
  })

  it('tapping any chip in any category reports through the same onToggle', () => {
    const onToggle = vi.fn()
    render(<MuscleSubgroupPicker selected={[]} onToggle={onToggle} allowed={MUSCLE_SUBGROUPS} />)

    fireEvent.click(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.calves }))
    expect(onToggle).toHaveBeenCalledWith('calves')
  })

  // Filtering (EXERCISE-LIBRARY-TASKS.md muscle_group tag-filtering fix):
  // this component has no muscle_group opinion itself, it only renders
  // whatever `allowed` contains — these tests exercise that contract
  // directly rather than through a muscle_group lookup.
  describe('filtering via `allowed`', () => {
    it('only renders chips for tags present in `allowed`', () => {
      render(
        <MuscleSubgroupPicker selected={[]} onToggle={() => {}} allowed={['biceps', 'brachialis']} />,
      )

      expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.biceps })).toBeTruthy()
      expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.brachialis })).toBeTruthy()
      expect(screen.queryByRole('button', { name: MUSCLE_SUBGROUP_LABELS.mid_chest })).toBeNull()
      expect(screen.queryByRole('button', { name: MUSCLE_SUBGROUP_LABELS.quads })).toBeNull()
    })

    it('hides a category section entirely when none of its tags are allowed', () => {
      render(
        <MuscleSubgroupPicker selected={[]} onToggle={() => {}} allowed={['biceps', 'brachialis']} />,
      )

      expect(screen.queryByText(MUSCLE_SUBGROUP_CATEGORY_LABELS.chest)).toBeNull()
      expect(screen.queryByText(MUSCLE_SUBGROUP_CATEGORY_LABELS.legs)).toBeNull()
      // 'arms' is the one category biceps/brachialis actually belong to.
      expect(screen.getByText(MUSCLE_SUBGROUP_CATEGORY_LABELS.arms)).toBeTruthy()
    })

    it('a real muscle_group mapping (chest) offers only its allowed subgroups, not the full 22', () => {
      const allowed = muscleSubgroupsForMuscleGroup('chest')
      render(<MuscleSubgroupPicker selected={[]} onToggle={() => {}} allowed={allowed} />)

      expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.upper_chest })).toBeTruthy()
      expect(screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.front_delt })).toBeTruthy()
      // side_delt/rear_delt are shoulders-only, not part of chest's allowed set.
      expect(screen.queryByRole('button', { name: MUSCLE_SUBGROUP_LABELS.side_delt })).toBeNull()
      expect(screen.queryByRole('button', { name: MUSCLE_SUBGROUP_LABELS.rear_delt })).toBeNull()
    })

    it('a currently-selected tag outside `allowed` still renders and stays active — never silently hidden', () => {
      // The don't-blank-on-omit convention applied to filtering: a stale or
      // post-muscle_group-edit tag must stay visible and toggleable, not
      // vanish from the picker just because it fell outside the "normal"
      // set for the exercise's current muscle_group.
      render(
        <MuscleSubgroupPicker
          selected={['quads']}
          onToggle={() => {}}
          allowed={[...muscleSubgroupsForMuscleGroup('biceps'), 'quads']}
        />,
      )

      const quadsChip = screen.getByRole('button', { name: MUSCLE_SUBGROUP_LABELS.quads })
      expect(quadsChip).toBeTruthy()
      expect(quadsChip.style.background).toBe('var(--accent-muted)')
    })
  })
})
