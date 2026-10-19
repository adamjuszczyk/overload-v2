import { describe, expect, it } from 'vitest'
import { dragTarget } from './changeProgramDrag'

describe('dragTarget', () => {
  const centers = [100, 200, 300, 400]
  it('stays put until the dragged unit passes a neighbour\'s centre', () => {
    expect(dragTarget(centers, 1, 200)).toBe(1)
    expect(dragTarget(centers, 1, 250)).toBe(1)
    expect(dragTarget(centers, 1, 150)).toBe(1)
  })
  it('goes down past each centre it has passed, one unit at a time', () => {
    expect(dragTarget(centers, 1, 301)).toBe(2)
    expect(dragTarget(centers, 1, 401)).toBe(3)
    expect(dragTarget(centers, 0, 250)).toBe(1)
    expect(dragTarget(centers, 0, 1000)).toBe(3)
  })
  it('goes up the same way', () => {
    expect(dragTarget(centers, 2, 199)).toBe(1)
    expect(dragTarget(centers, 3, 99)).toBe(0)
    expect(dragTarget(centers, 3, -500)).toBe(0)
  })
  it('a list of one has nowhere to go', () => {
    expect(dragTarget([50], 0, 9999)).toBe(0)
  })
})
