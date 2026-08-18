import { describe, it, expect } from 'vitest'
import { weekKey, buildWeeklyAverages, recentWeightTrend } from './weightLogic'
import type { WeightEntry } from '../../types'

function daily(id: string, entryDate: string, weightKg: number): WeightEntry {
  return { id, userId: 'u1', entryDate, weightKg, kind: 'daily', createdAt: `${entryDate}T00:00:00Z` }
}

function manual(id: string, entryDate: string, weightKg: number): WeightEntry {
  return { id, userId: 'u1', entryDate, weightKg, kind: 'weekly_average', createdAt: `${entryDate}T00:00:00Z` }
}

describe('weekKey', () => {
  it('maps any day in a week to that week\'s Monday', () => {
    // 2026-08-17 is a Monday, 2026-08-23 is the following Sunday
    expect(weekKey('2026-08-17')).toBe('2026-08-17')
    expect(weekKey('2026-08-18')).toBe('2026-08-17') // Tuesday
    expect(weekKey('2026-08-23')).toBe('2026-08-17') // Sunday
  })

  it('is idempotent on a date that is already a Monday', () => {
    expect(weekKey(weekKey('2026-08-20'))).toBe(weekKey('2026-08-20'))
  })
})

describe('buildWeeklyAverages', () => {
  it('week with only daily entries: averages them, source daily', () => {
    const entries = [
      daily('1', '2026-08-17', 80),
      daily('2', '2026-08-19', 81),
      daily('3', '2026-08-21', 82),
    ]
    const [week] = buildWeeklyAverages(entries)
    expect(week).toEqual({ weekStart: '2026-08-17', averageKg: 81, source: 'daily', dailyCount: 3 })
  })

  it('week with only a manual weekly entry: uses it directly, source manual', () => {
    const entries = [manual('1', '2026-08-17', 80.5)]
    const [week] = buildWeeklyAverages(entries)
    expect(week).toEqual({ weekStart: '2026-08-17', averageKg: 80.5, source: 'manual', dailyCount: 0 })
  })

  it('week with both: the manual entry wins, dailies are not blended in (TASKS §5.3)', () => {
    const entries = [
      daily('1', '2026-08-17', 80),
      daily('2', '2026-08-19', 90), // would drag a daily average way up
      manual('3', '2026-08-17', 81),
    ]
    const [week] = buildWeeklyAverages(entries)
    expect(week).toEqual({ weekStart: '2026-08-17', averageKg: 81, source: 'manual', dailyCount: 0 })
  })

  it('rounds the daily average to 2 decimals', () => {
    const entries = [daily('1', '2026-08-17', 80), daily('2', '2026-08-18', 81), daily('3', '2026-08-19', 81)]
    const [week] = buildWeeklyAverages(entries)
    expect(week.averageKg).toBe(80.67) // 242/3 = 80.6666...
  })

  it('handles multiple independent weeks, sorted oldest first', () => {
    const entries = [manual('2', '2026-08-24', 79), daily('1', '2026-08-17', 80)]
    const weeks = buildWeeklyAverages(entries)
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-08-17', '2026-08-24'])
  })

  it('a week with no entries at all produces no row', () => {
    expect(buildWeeklyAverages([])).toEqual([])
  })
})

describe('recentWeightTrend', () => {
  const entries = [
    daily('1', '2026-07-27', 84), // week of 2026-07-27
    daily('2', '2026-08-03', 83), // week of 2026-08-03
    // gap: no entry the week of 2026-08-10
    daily('3', '2026-08-17', 81), // week of 2026-08-17
  ]

  it('returns only weeks within the trailing window, oldest first', () => {
    const trend = recentWeightTrend(entries, '2026-08-18', 3)
    expect(trend.map((w) => w.weekStart)).toEqual(['2026-08-03', '2026-08-17'])
  })

  it('a week with no entry is simply absent, not zero-filled', () => {
    const trend = recentWeightTrend(entries, '2026-08-18', 3)
    expect(trend.find((w) => w.weekStart === '2026-08-10')).toBeUndefined()
  })

  it('excludes weeks older than the window', () => {
    const trend = recentWeightTrend(entries, '2026-08-18', 2)
    expect(trend.map((w) => w.weekStart)).toEqual(['2026-08-17'])
  })
})
