import { describe, it, expect } from 'vitest'
import { parseSwapRecord } from './exerciseSwapLogic'

// Chunk 59 (migration 047; DECISIONS 183, 46r's Q5): the swap row's `moved_sets` is read back exactly as written, and anything else reads
// as no record, so a swap row from before 047 (null) and a column holding some other JSON are both drawn as before 1.2 draws a swap.
describe('parseSwapRecord: the record of which sets moved, as the column holds it', () => {
  const record = {
    fromKey: 'pe-1',
    moved: [
      { from: { weekPlanSetId: 'set-2' }, place: 1 },
      { from: { addedPlace: 2 }, place: 2 },
    ],
  }

  it('reads what the swap wrote, whole: the card the sets left, each set by its planned id or its place, in order, with the place it took', () => {
    expect(parseSwapRecord(record)).toEqual(record)
    expect(parseSwapRecord(JSON.parse(JSON.stringify(record)))).toEqual(record) // through JSON, as PostgREST hands a jsonb column
  })

  it('a swap that moved nothing is still a record: it names the card the swap left', () => {
    expect(parseSwapRecord({ fromKey: 'pe-1', moved: [] })).toEqual({ fromKey: 'pe-1', moved: [] })
  })

  it('no record: null (every swap row before 047), an absent column, and anything that is not the shape', () => {
    for (const value of [null, undefined, 'x', 3, [], {}, { moved: [] }, { fromKey: '', moved: [] }, { fromKey: 1, moved: [] }, { fromKey: 'pe-1' }, { fromKey: 'pe-1', moved: {} }]) {
      expect(parseSwapRecord(value)).toBeNull()
    }
  })

  it('a record with one set the module could not read is no record: sets are never dropped or guessed (a place is a whole number from 1; a set is named by one of the two)', () => {
    const bad = [
      { from: { weekPlanSetId: 'set-2' }, place: 0 },
      { from: { weekPlanSetId: 'set-2' }, place: 1.5 },
      { from: { weekPlanSetId: 'set-2' }, place: '1' },
      { from: { weekPlanSetId: '' }, place: 1 },
      { from: { addedPlace: 0 }, place: 1 },
      { from: { addedPlace: 'a' }, place: 1 },
      { from: { weekPlanSetId: 'set-2', addedPlace: 1 }, place: 1 },
      { from: {}, place: 1 },
      { from: null, place: 1 },
      { place: 1 },
      null,
      'set-2',
    ]
    for (const entry of bad) expect(parseSwapRecord({ fromKey: 'pe-1', moved: [{ from: { weekPlanSetId: 'ok' }, place: 1 }, entry] })).toBeNull()
  })
})
