// Builders for workoutRules' tests: the app's own types (WeekPlanSet, SetLog, SessionSetChange), so the
// tests also prove the rules accept what the workout screen will hand them. Nothing here decides anything:
// every expected value in a test is written out by hand.

import type { SessionSetChange, SessionSetChangeType, SetLog, WeekPlanSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary'
import { sessionOrder, type OrderExercise, type OrderSuperset, type ResolvedRow, type SessionOrder } from './workoutRules'

export const SESSION = 's1'

/** The id of a planned set: set `index` (1-based, warmups counted: the plan's own numbering) of a card, or its drop. */
export function planId(key: string, index: number, drop?: number): string {
  return drop === undefined ? `${key}.${index}` : `${key}.${index}.${drop}`
}

/** What a card's logs carry as their exercise. */
export const exerciseIdOf = (key: string): string => `ex.${key}`

const STAGE_TOKENS = { d: 'dropset', m: 'myo_reps', r: 'rest_pause', c: 'cluster' } as const

/**
 * A card's planned sets as the plan holds them (real `WeekPlanSet`s), from space-separated tokens in set
 * order: `n` a normal working set, `a` an AMRAP set, `w` a warmup, a staged head with its drops written as
 * kind letter + count (`d2` a dropset with two drops, `m3` myo-reps, `r1` rest-pause, `c2` a cluster), and
 * `l1` a pre-1.1 dropset: its head carries no stage kind and has one planned drop.
 */
export function plannedSets(key: string, spec: string): WeekPlanSet[] {
  const base = (id: string, setNumber: number): WeekPlanSet => ({
    id,
    weekPlanId: 'plan',
    userId: 'u1',
    programExerciseId: key,
    setNumber,
    targetRir: null,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
  })
  const sets: WeekPlanSet[] = []
  spec
    .split(/\s+/)
    .filter(Boolean)
    .forEach((token, i) => {
      const index = i + 1
      const id = planId(key, index)
      if (token === 'w') sets.push({ ...base(id, index), isWarmup: true })
      else if (token === 'n') sets.push(base(id, index))
      else if (token === 'a') sets.push({ ...base(id, index), isAmrap: true })
      else {
        const legacy = token[0] === 'l'
        const kind = legacy ? null : STAGE_TOKENS[token[0] as keyof typeof STAGE_TOKENS]
        const drops = Number(token.slice(1))
        if ((!legacy && !kind) || !Number.isInteger(drops)) throw new Error(`unknown set token "${token}"`)
        sets.push(legacy ? base(id, index) : { ...base(id, index), stageKind: kind })
        for (let d = 1; d <= drops; d++) {
          sets.push({ ...base(planId(key, index, d), index), parentWeekPlanSetId: id, stageIndex: d, isDropset: true })
        }
      }
    })
  return sets
}

/** A card: its key doubles as its name's seed (`Bench` for `bench`) unless a name is given. */
export function card(key: string, spec: string, o: { name?: string; added?: number } = {}): OrderExercise {
  const name = o.name ?? key.charAt(0).toUpperCase() + key.slice(1)
  return { key, exerciseId: exerciseIdOf(key), name, plannedSets: plannedSets(key, spec), ...(o.added === undefined ? {} : { addedSets: o.added }) }
}

export function orderOf(exercises: OrderExercise[], supersets: OrderSuperset[] = []): SessionOrder {
  return sessionOrder(exercises, supersets)
}

/**
 * A row in one short string, read off its fields (not off the module's own labels): the card, where it sits
 * (`W1` a warmup, `A2` a superset member's round, `03` any other set, `.1` after it for a drop) and its state
 * (`✓` logged, `×` skipped, `·` unlogged).
 */
export function brief(row: ResolvedRow): string {
  const place =
    row.kind === 'warmup' ? `W${row.number}` : row.block ? `${row.block.letter}${row.block.round}` : String(row.number).padStart(2, '0')
  const drop = row.kind === 'stage' ? `.${row.stageNumber}` : ''
  const mark = row.state === 'logged' ? '✓' : row.state === 'skipped' ? '×' : '·'
  return `${row.exerciseKey} ${place}${drop}${mark}`
}

// ─── Logs ────────────────────────────────────────────────────────────────────────────────────────

export interface LogOptions {
  /**
   * The `set_number` it was logged with: for a head the planned index (right for a card without warmups; pass the
   * number the screen showed otherwise, warmups apart), for an added set its place among the added ones.
   */
  number?: number
  skipped?: boolean
  warmup?: boolean
  /** The head's stage kind as logged (the type as done); null (the default) is Normal or a pre-1.1 head. */
  stageKind?: StageKind | null
  weight?: number | null
  reps?: number | null
  rir?: number | null
}

function baseLog(id: string, exerciseId: string, o: LogOptions): SetLog {
  const skipped = o.skipped ?? false
  return {
    id,
    userId: 'u1',
    sessionId: SESSION,
    exerciseId,
    weekPlanSetId: null,
    setNumber: o.number ?? 1,
    weight: skipped ? null : o.weight === undefined ? 50 : o.weight,
    reps: skipped ? null : o.reps === undefined ? 10 : o.reps,
    rir: o.rir === undefined ? 2 : o.rir,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: o.warmup ?? false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: skipped,
    loggedAt: '2026-10-12T18:00:00Z',
    restSeconds: null,
    formRating: null,
    stageKind: o.stageKind ?? null,
  }
}

/** The log of planned set `index` of a card (a head). */
export function headLog(key: string, index: number, o: LogOptions = {}): SetLog {
  return { ...baseLog(`log.${key}.${index}`, exerciseIdOf(key), { number: index, ...o }), weekPlanSetId: planId(key, index) }
}

/** The log of a set added in the session: no planned set behind it. */
export function addedLog(key: string, n: number, o: LogOptions = {}): SetLog {
  return baseLog(`log.${key}.added${n}`, exerciseIdOf(key), { number: n, ...o })
}

/** A logged drop under a head; carries the head's `set_number`, as the app writes it. */
export function dropLog(parent: SetLog, stageIndex: number, o: LogOptions = {}): SetLog {
  return {
    ...baseLog(`${parent.id}.d${stageIndex}`, parent.exerciseId, { number: parent.setNumber, ...o }),
    parentSetId: parent.id,
    isDropset: true,
    stageIndex,
    stageKind: null,
  }
}

// ─── Changes ─────────────────────────────────────────────────────────────────────────────────────

export const deleted = (key: string, index: number): SessionSetChange => ({ kind: 'deleted', weekPlanSetId: planId(key, index) })

export const retyped = (key: string, index: number, type: SessionSetChangeType): SessionSetChange => ({
  kind: 'retyped',
  weekPlanSetId: planId(key, index),
  type,
})

export const pending = (log: SetLog, stageKind: StageKind, stageCount: number): SessionSetChange => ({
  kind: 'pending_stages',
  setLogId: log.id,
  stageKind,
  stageCount,
})

export const staged = (stageKind: StageKind, stageCount: number): SessionSetChangeType => ({ kind: 'staged', stageKind, stageCount })

/** Freezes a value and everything inside it: a function handed this can read it and nothing else. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}
