import { describe, it, expect } from 'vitest'
import {
  STAGE_KINDS,
  STAGE_KIND_LABELS,
  DEFAULT_STAGE_REST_SECONDS,
  STAGE_KIND_CARRIES_WEIGHT,
  SET_KINDS,
  deriveSetKind,
  resolveStageKind,
  PRESET_TAGS,
  REP_TARGET_AMRAP_TEXT,
  REP_TARGET_NONE_TEXT,
  repTargetToColumns,
  columnsToRepTarget,
  formatRepTarget,
  parseRepTarget,
  TEMPO_FIELD_COUNT,
  TEMPO_MAX_LENGTH,
  normaliseTempo,
  DEFAULT_DELOAD_SETS_RULE,
  DEFAULT_DELOAD_WEIGHT_RULE,
  applyAmrapRirDefault,
  addTag,
  removeTag,
  applyTagToAllHeads,
  type RepTarget,
} from './plannerVocabulary'

describe('STAGE_KINDS', () => {
  it('has exactly the four storage values, in SPEC order', () => {
    expect(STAGE_KINDS).toEqual(['dropset', 'rest_pause', 'myo_reps', 'cluster'])
  })
})

describe('STAGE_KIND_LABELS', () => {
  it('has exactly one label per stage kind, no extras', () => {
    expect(Object.keys(STAGE_KIND_LABELS).sort()).toEqual([...STAGE_KINDS].sort())
  })

  it('matches SPEC\'s own written form, uppercased', () => {
    expect(STAGE_KIND_LABELS).toEqual({
      dropset: 'DROPSET',
      rest_pause: 'REST-PAUSE',
      myo_reps: 'MYO-REPS',
      cluster: 'CLUSTER',
    })
  })
})

describe('DEFAULT_STAGE_REST_SECONDS', () => {
  it('dropset defaults to no rest (null) — stages run back to back', () => {
    expect(DEFAULT_STAGE_REST_SECONDS.dropset).toBeNull()
  })

  it('rest-pause, myo-reps and cluster all default to 15s', () => {
    expect(DEFAULT_STAGE_REST_SECONDS.rest_pause).toBe(15)
    expect(DEFAULT_STAGE_REST_SECONDS.myo_reps).toBe(15)
    expect(DEFAULT_STAGE_REST_SECONDS.cluster).toBe(15)
  })

  it('has an entry for every stage kind, no extras', () => {
    expect(Object.keys(DEFAULT_STAGE_REST_SECONDS).sort()).toEqual([...STAGE_KINDS].sort())
  })
})

describe('STAGE_KIND_CARRIES_WEIGHT', () => {
  it('dropset drops the weight (does not carry)', () => {
    expect(STAGE_KIND_CARRIES_WEIGHT.dropset).toBe(false)
  })

  it('rest-pause, myo-reps and cluster all carry the weight', () => {
    expect(STAGE_KIND_CARRIES_WEIGHT.rest_pause).toBe(true)
    expect(STAGE_KIND_CARRIES_WEIGHT.myo_reps).toBe(true)
    expect(STAGE_KIND_CARRIES_WEIGHT.cluster).toBe(true)
  })

  it('has an entry for every stage kind, no extras', () => {
    expect(Object.keys(STAGE_KIND_CARRIES_WEIGHT).sort()).toEqual([...STAGE_KINDS].sort())
  })
})

describe('SET_KINDS', () => {
  it('has exactly the three set kinds', () => {
    expect(SET_KINDS).toEqual(['working', 'warmup', 'staged'])
  })
})

describe('deriveSetKind', () => {
  it('is warmup whenever isWarmup is true, regardless of stageKind', () => {
    expect(deriveSetKind({ isWarmup: true, stageKind: null })).toBe('warmup')
    expect(deriveSetKind({ isWarmup: true, stageKind: 'dropset' })).toBe('warmup')
  })

  it('is staged when stageKind is set and isWarmup is false', () => {
    for (const kind of STAGE_KINDS) {
      expect(deriveSetKind({ isWarmup: false, stageKind: kind })).toBe('staged')
    }
  })

  it('is working when neither isWarmup nor stageKind is set', () => {
    expect(deriveSetKind({ isWarmup: false, stageKind: null })).toBe('working')
  })

  // Documents the judgement call in the module's comment: this function
  // only ever sees the head's own two fields, so a legacy head that has
  // real stage rows but a never-populated stage_kind column reads as
  // 'working' here, not 'staged' — correctly reclassifying it needs the
  // sibling rows (out of scope for this pure, single-row function).
  it('does NOT detect a legacy staged head from these two fields alone (documented scope limit)', () => {
    expect(deriveSetKind({ isWarmup: false, stageKind: null })).toBe('working')
  })
})

describe('resolveStageKind', () => {
  it('passes a real stage kind straight through', () => {
    for (const kind of STAGE_KINDS) {
      expect(resolveStageKind(kind)).toBe(kind)
    }
  })

  it('defaults a null stage_kind to dropset — "a legacy head ... reads as a dropset"', () => {
    expect(resolveStageKind(null)).toBe('dropset')
  })
})

describe('PRESET_TAGS', () => {
  it('has exactly the four preset tags, in SPEC order', () => {
    expect(PRESET_TAGS).toEqual(['push here', 'maintain strength', 'focus on execution', 'push back'])
  })
})

describe('repTargetToColumns / columnsToRepTarget', () => {
  it('a plain number maps to repMin === repMax, isAmrap false', () => {
    const target: RepTarget = { type: 'number', value: 8 }
    expect(repTargetToColumns(target)).toEqual({ repMin: 8, repMax: 8, isAmrap: false })
  })

  it('a range maps min/max straight through, isAmrap false', () => {
    const target: RepTarget = { type: 'range', min: 8, max: 12 }
    expect(repTargetToColumns(target)).toEqual({ repMin: 8, repMax: 12, isAmrap: false })
  })

  it('AMRAP maps to no numbers, isAmrap true', () => {
    const target: RepTarget = { type: 'amrap' }
    expect(repTargetToColumns(target)).toEqual({ repMin: null, repMax: null, isAmrap: true })
  })

  it('none maps to all-empty columns', () => {
    const target: RepTarget = { type: 'none' }
    expect(repTargetToColumns(target)).toEqual({ repMin: null, repMax: null, isAmrap: false })
  })

  it('round-trips every variant through columns and back', () => {
    const targets: RepTarget[] = [
      { type: 'number', value: 8 },
      { type: 'range', min: 8, max: 12 },
      { type: 'amrap' },
      { type: 'none' },
    ]
    for (const target of targets) {
      expect(columnsToRepTarget(repTargetToColumns(target))).toEqual(target)
    }
  })

  it('is_amrap is authoritative over stray numbers (Check: "AMRAP carries no numbers")', () => {
    expect(columnsToRepTarget({ repMin: 8, repMax: 12, isAmrap: true })).toEqual({ type: 'amrap' })
  })

  it('a partially-null pair (not a state the Checks allow) degrades to none rather than throwing', () => {
    expect(columnsToRepTarget({ repMin: 8, repMax: null, isAmrap: false })).toEqual({ type: 'none' })
    expect(columnsToRepTarget({ repMin: null, repMax: 12, isAmrap: false })).toEqual({ type: 'none' })
  })
})

describe('formatRepTarget', () => {
  it('formats a plain number as-is', () => {
    expect(formatRepTarget({ type: 'number', value: 8 })).toBe('8')
  })

  it('formats a range with an en dash (U+2013), not a hyphen', () => {
    const formatted = formatRepTarget({ type: 'range', min: 8, max: 12 })
    expect(formatted).toBe('8–12')
    expect(formatted).toBe('8–12')
  })

  it('formats AMRAP and none as their literal tokens', () => {
    expect(formatRepTarget({ type: 'amrap' })).toBe(REP_TARGET_AMRAP_TEXT)
    expect(formatRepTarget({ type: 'none' })).toBe(REP_TARGET_NONE_TEXT)
  })
})

describe('parseRepTarget — accepts', () => {
  it('a plain positive integer', () => {
    expect(parseRepTarget('8')).toEqual({ type: 'number', value: 8 })
  })

  it('a range written with an en dash', () => {
    expect(parseRepTarget('8–12')).toEqual({ type: 'range', min: 8, max: 12 })
  })

  it('a range written with a plain hyphen', () => {
    expect(parseRepTarget('8-12')).toEqual({ type: 'range', min: 8, max: 12 })
  })

  it('AMRAP', () => {
    expect(parseRepTarget('AMRAP')).toEqual({ type: 'amrap' })
  })

  it('none', () => {
    expect(parseRepTarget('none')).toEqual({ type: 'none' })
  })

  it('AMRAP in any input casing, folded to the type (DECISIONS 34)', () => {
    expect(parseRepTarget('amrap')).toEqual({ type: 'amrap' })
    expect(parseRepTarget('Amrap')).toEqual({ type: 'amrap' })
    expect(parseRepTarget('aMrAp')).toEqual({ type: 'amrap' })
  })

  it('none in any input casing, folded to the type (DECISIONS 34)', () => {
    expect(parseRepTarget('NONE')).toEqual({ type: 'none' })
    expect(parseRepTarget('None')).toEqual({ type: 'none' })
  })

  it('formatRepTarget still only ever emits the canonical casing', () => {
    expect(formatRepTarget({ type: 'amrap' })).toBe('AMRAP')
    expect(formatRepTarget({ type: 'none' })).toBe('none')
  })

  it('trims only outer whitespace', () => {
    expect(parseRepTarget('  8  ')).toEqual({ type: 'number', value: 8 })
    expect(parseRepTarget('  AMRAP  ')).toEqual({ type: 'amrap' })
  })

  it('round-trips through formatRepTarget for every variant', () => {
    const targets: RepTarget[] = [
      { type: 'number', value: 8 },
      { type: 'range', min: 8, max: 12 },
      { type: 'amrap' },
      { type: 'none' },
    ]
    for (const target of targets) {
      expect(parseRepTarget(formatRepTarget(target))).toEqual(target)
    }
  })
})

describe('parseRepTarget — rejects', () => {
  it('an inverted range ("12-8")', () => {
    expect(parseRepTarget('12-8')).toBeNull()
  })

  it('an inverted range written with an en dash', () => {
    expect(parseRepTarget('12–8')).toBeNull()
  })

  it('zero', () => {
    expect(parseRepTarget('0')).toBeNull()
  })

  it('a negative number', () => {
    expect(parseRepTarget('-5')).toBeNull()
  })

  it('a non-integer', () => {
    expect(parseRepTarget('8.5')).toBeNull()
    expect(parseRepTarget('8.5-12')).toBeNull()
  })

  it('an equal-bounds range ("8-8") — not a valid range; "8" must be used instead', () => {
    expect(parseRepTarget('8-8')).toBeNull()
  })

  it('internal whitespace around the separator', () => {
    expect(parseRepTarget('8 - 12')).toBeNull()
    expect(parseRepTarget('8 –12')).toBeNull()
  })

  it('empty or whitespace-only input', () => {
    expect(parseRepTarget('')).toBeNull()
    expect(parseRepTarget('   ')).toBeNull()
  })

  it('a non-numeric string', () => {
    expect(parseRepTarget('eight')).toBeNull()
  })
})

describe('TEMPO_FIELD_COUNT / TEMPO_MAX_LENGTH', () => {
  it('is four fields, max 20 characters', () => {
    expect(TEMPO_FIELD_COUNT).toBe(4)
    expect(TEMPO_MAX_LENGTH).toBe(20)
  })
})

describe('normaliseTempo — accepts', () => {
  it('the SPEC example, all-digit fields', () => {
    expect(normaliseTempo('3-1-1-0')).toBe('3-1-1-0')
  })

  it('an uppercase X field, the SPEC example', () => {
    expect(normaliseTempo('3-1-X-0')).toBe('3-1-X-0')
  })

  it('multi-digit fields', () => {
    expect(normaliseTempo('10-1-1-0')).toBe('10-1-1-0')
  })

  it('more than one X field', () => {
    expect(normaliseTempo('X-1-X-0')).toBe('X-1-X-0')
  })

  it('a lowercase x field, normalised to uppercase (DECISIONS 34)', () => {
    expect(normaliseTempo('3-1-x-0')).toBe('3-1-X-0')
  })

  it('more than one lowercase x field, normalised to uppercase', () => {
    expect(normaliseTempo('x-1-x-0')).toBe('X-1-X-0')
  })

  it('trims outer whitespace', () => {
    expect(normaliseTempo('  3-1-1-0  ')).toBe('3-1-1-0')
  })

  it('a tempo exactly at the 20-char limit', () => {
    const exactly20 = '11111-1111-1111-1111'
    expect(exactly20).toHaveLength(20)
    expect(normaliseTempo(exactly20)).toBe(exactly20)
  })
})

describe('normaliseTempo — rejects', () => {
  it('a 4-digit run with no separators ("31X0")', () => {
    expect(normaliseTempo('31X0')).toBeNull()
  })

  it('only 3 fields ("3-1-1")', () => {
    expect(normaliseTempo('3-1-1')).toBeNull()
  })

  it('5 fields', () => {
    expect(normaliseTempo('3-1-1-0-1')).toBeNull()
  })

  it('a mixed digit+letter field ("3X")', () => {
    expect(normaliseTempo('3X-1-1-0')).toBeNull()
  })

  it('an empty field from a doubled separator', () => {
    expect(normaliseTempo('3--1-0')).toBeNull()
  })

  it('internal whitespace', () => {
    expect(normaliseTempo('3 -1-1-0')).toBeNull()
    expect(normaliseTempo('3-1-1-0 extra')).toBeNull()
  })

  it('one character past the 20-char limit, even after trimming', () => {
    const tooLong = '111111-1111-1111-1111'
    expect(tooLong).toHaveLength(21)
    expect(normaliseTempo(tooLong)).toBeNull()
    expect(normaliseTempo(`  ${tooLong}  `)).toBeNull()
  })

  it('empty or whitespace-only input', () => {
    expect(normaliseTempo('')).toBeNull()
    expect(normaliseTempo('   ')).toBeNull()
  })
})

describe('DEFAULT_DELOAD_SETS_RULE', () => {
  it('matches TASKS.md\'s starting values exactly: percent, 50, down', () => {
    expect(DEFAULT_DELOAD_SETS_RULE).toEqual({ mode: 'percent', value: 50, rounding: 'down' })
  })
})

describe('DEFAULT_DELOAD_WEIGHT_RULE', () => {
  it('matches the starting values exactly: 75%, down, 2.5, kg (DECISIONS 33)', () => {
    expect(DEFAULT_DELOAD_WEIGHT_RULE).toEqual({ percent: 75, rounding: 'down', step: 2.5, stepUnit: 'kg' })
  })

  it('pins the starting percentage at 75 (DECISIONS 33, owner, 2026-10-04)', () => {
    expect(DEFAULT_DELOAD_WEIGHT_RULE.percent).toBe(75)
  })
})

// Chunk 19 — SPEC "Targets": "AMRAP ... Its RIR defaults to 0 (RPE 10),
// editable."
describe('applyAmrapRirDefault', () => {
  it('AMRAP with no existing RIR defaults targetRir to 0, alongside the AMRAP columns', () => {
    expect(applyAmrapRirDefault({ type: 'amrap' }, null)).toEqual({
      repMin: null, repMax: null, isAmrap: true, targetRir: 0,
    })
  })

  it('AMRAP with an existing RIR (including a prior 0) never overwrites it — targetRir is omitted entirely', () => {
    const withFive = applyAmrapRirDefault({ type: 'amrap' }, 5)
    expect(withFive).toEqual({ repMin: null, repMax: null, isAmrap: true })
    expect('targetRir' in withFive).toBe(false)

    const withZero = applyAmrapRirDefault({ type: 'amrap' }, 0)
    expect('targetRir' in withZero).toBe(false)
  })

  it('a non-AMRAP target never gets a targetRir default, null RIR or not', () => {
    const number = applyAmrapRirDefault({ type: 'number', value: 8 }, null)
    expect(number).toEqual({ repMin: 8, repMax: 8, isAmrap: false })
    expect('targetRir' in number).toBe(false)

    const range = applyAmrapRirDefault({ type: 'range', min: 8, max: 12 }, null)
    expect('targetRir' in range).toBe(false)

    const none = applyAmrapRirDefault({ type: 'none' }, null)
    expect('targetRir' in none).toBe(false)
  })
})

// Chunk 19 — SPEC "Tags": "Preset list ... plus custom text" (trimmed; blank
// refused; no duplicates on one set); "Each one can be removed."
describe('addTag', () => {
  it('adds a genuinely new tag to an empty/null list', () => {
    expect(addTag(null, 'push here')).toEqual(['push here'])
    expect(addTag(undefined, 'push here')).toEqual(['push here'])
  })

  it('appends to existing tags, preserving order', () => {
    expect(addTag(['push here'], 'maintain strength')).toEqual(['push here', 'maintain strength'])
  })

  it('trims surrounding whitespace before storing', () => {
    expect(addTag([], '  push back  ')).toEqual(['push back'])
  })

  it('blank (or whitespace-only) input is refused: returns null, nothing to write', () => {
    expect(addTag(['push here'], '')).toBeNull()
    expect(addTag(['push here'], '   ')).toBeNull()
  })

  it('a duplicate (exact match, already on this set) is refused: returns null, no second copy', () => {
    expect(addTag(['push here'], 'push here')).toBeNull()
  })

  it('custom free text is accepted the same as a preset string', () => {
    expect(addTag(null, 'triceps feel off today')).toEqual(['triceps feel off today'])
  })
})

describe('removeTag', () => {
  it('removes the named tag, keeping the others in order', () => {
    expect(removeTag(['push here', 'maintain strength', 'push back'], 'maintain strength'))
      .toEqual(['push here', 'push back'])
  })

  it('removing the last remaining tag collapses to null, not an empty array', () => {
    expect(removeTag(['push here'], 'push here')).toBeNull()
  })

  it('removing a tag that was never there is a harmless no-op (same array contents)', () => {
    expect(removeTag(['push here'], 'nonexistent')).toEqual(['push here'])
  })

  it('null/undefined input has nothing to remove — stays null', () => {
    expect(removeTag(null, 'push here')).toBeNull()
    expect(removeTag(undefined, 'push here')).toBeNull()
  })
})

// Chunk 19 — SPEC "Tags": "'Apply to all sets' fills one tag across an
// exercise's sets." Reviewer's note: heads only, never warmups, never
// removes another tag, idempotent.
describe('applyTagToAllHeads', () => {
  it('adds the tag to every head that does not already have it', () => {
    const heads = [
      { id: 'h1', tags: null, isWarmup: false },
      { id: 'h2', tags: ['maintain strength'], isWarmup: false },
    ]
    expect(applyTagToAllHeads(heads, 'push here')).toEqual([
      { id: 'h1', tags: ['push here'] },
      { id: 'h2', tags: ['maintain strength', 'push here'] },
    ])
  })

  it('never removes another tag already on a head — only appends', () => {
    const heads = [{ id: 'h1', tags: ['focus on execution'], isWarmup: false }]
    const updates = applyTagToAllHeads(heads, 'push here')
    expect(updates).toEqual([{ id: 'h1', tags: ['focus on execution', 'push here'] }])
  })

  it('excludes warmup heads entirely — not in the result even though they have no tag yet', () => {
    const heads = [
      { id: 'h1', tags: null, isWarmup: false },
      { id: 'h2', tags: null, isWarmup: true },
    ]
    expect(applyTagToAllHeads(heads, 'push here')).toEqual([{ id: 'h1', tags: ['push here'] }])
  })

  it('idempotent: calling it again once every head already has the tag writes nothing', () => {
    const heads = [
      { id: 'h1', tags: ['push here'], isWarmup: false },
      { id: 'h2', tags: ['push here'], isWarmup: false },
    ]
    expect(applyTagToAllHeads(heads, 'push here')).toEqual([])
  })

  it('a blank tag updates nothing (addTag\'s own refusal propagates)', () => {
    const heads = [{ id: 'h1', tags: null, isWarmup: false }]
    expect(applyTagToAllHeads(heads, '   ')).toEqual([])
  })
})
