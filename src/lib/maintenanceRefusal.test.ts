import { describe, expect, it } from 'vitest'
import { APP_STATUS_KEY, MAINTENANCE_CODE, isMaintenanceRefusal } from './maintenanceRefusal'

// Chunk 72 (TASKS.md "Error codes": `OL001` is read from `error.code`, as queue-fix 230 reads `23503`, never from the message).
describe('isMaintenanceRefusal', () => {
  it('is the code OL001, as a PostgrestError carries it', () => {
    expect(MAINTENANCE_CODE).toBe('OL001')
    expect(isMaintenanceRefusal({ code: 'OL001', message: 'Overload is being updated. Writes are refused until maintenance is off.', hint: 'maintenance', details: null })).toBe(true)
  })

  it('is read from the code and never from the message or the hint (a table of what it is not)', () => {
    const notRefusals: unknown[] = [
      { code: 'OL002', message: 'a program with a running program cannot be deleted: finish it first' },
      { code: '23503', message: 'insert or update on table "v2_set_logs" violates foreign key constraint "x"' },
      { code: '42501', message: 'permission denied for table v2_app_status' },
      { message: 'Overload is being updated. Writes are refused until maintenance is off.', hint: 'maintenance' },
      { code: 'ol001' },
      new Error('OL001'),
      'OL001',
      null,
      undefined,
      42,
    ]
    for (const error of notRefusals) expect(isMaintenanceRefusal(error), JSON.stringify(error)).toBe(false)
  })

  it('names the one key the status is read under', () => {
    expect([...APP_STATUS_KEY]).toEqual(['v2_appStatus'])
  })
})
