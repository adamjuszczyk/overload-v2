import { describe, it, expect } from 'vitest'
import { resolveStageCarryWeightKg } from './stageCarryLogic'

// Chunk 14 — carry-over (SPEC.md "Staged sets"): dropset stays blank
// (today's behaviour, unchanged); rest-pause/myo-reps/cluster default to
// the previous stage's (or the head's, for the first stage) own weight.

function group(headWeight: number | null, stageWeights: (number | null)[]) {
  return {
    head: { weight: headWeight },
    stages: stageWeights.map((weight) => ({ weight })),
  }
}

describe('resolveStageCarryWeightKg', () => {
  it('dropset never carries — null regardless of what the head or prior stages logged', () => {
    expect(resolveStageCarryWeightKg('dropset', group(100, []))).toBeNull()
    expect(resolveStageCarryWeightKg('dropset', group(100, [80]))).toBeNull()
    expect(resolveStageCarryWeightKg('dropset', group(100, [80, 60]))).toBeNull()
  })

  it('rest-pause/myo-reps/cluster carry the head\'s own weight for the first stage (no stages logged yet)', () => {
    expect(resolveStageCarryWeightKg('rest_pause', group(100, []))).toBe(100)
    expect(resolveStageCarryWeightKg('myo_reps', group(60, []))).toBe(60)
    expect(resolveStageCarryWeightKg('cluster', group(140, []))).toBe(140)
  })

  it('carries the LAST logged stage\'s weight, not the head\'s, once at least one stage exists', () => {
    expect(resolveStageCarryWeightKg('rest_pause', group(100, [90]))).toBe(90)
    expect(resolveStageCarryWeightKg('rest_pause', group(100, [90, 80]))).toBe(80)
  })

  it('carries null through unchanged if the predecessor itself has a null weight (e.g. a skipped head)', () => {
    expect(resolveStageCarryWeightKg('cluster', group(null, []))).toBeNull()
    expect(resolveStageCarryWeightKg('cluster', group(100, [null]))).toBeNull()
  })
})
