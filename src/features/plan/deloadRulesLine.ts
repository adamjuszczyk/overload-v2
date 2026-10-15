import type { DeloadRules } from '../../lib/deloadRules'

// Chunk 33 (SPEC.md Deload [P1.1], G43; DECISIONS 87, provisional): "Plan shows
// the rules in effect, read-only, next to the deload action." The one line under
// MARK WEEK AS DELOAD (MARK CYCLE AS DELOAD): the rules deload marking will
// apply. PlanPage hands it the rules it already resolves for marking
// (resolveEffectiveDeloadRules), so what's shown is exactly what a tap applies;
// this only words them. Chunk 48 (SPEC Deload [1.2], 16b): the rules are the
// Settings rules and nothing else, so the line always says so ("from Settings",
// board 1e's wording) and never whose they are.

const MINUS = '−'

// A change to a number of reps or RIR, with its sign ("+2", "−1"; "0" for a
// rule that is on but adds nothing, which is how Settings starts one).
function signed(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `${MINUS}${Math.abs(delta)}`
  return '0'
}

// Every rule that is on, in the shape's own order (sets, weight, reps, RIR),
// each with the rounding it uses. A rule that is off (an absent key) isn't
// mentioned. Rounding is part of a sets rule only as a percentage (a count of
// sets is already whole).
export function describeDeloadRules(rules: DeloadRules): string {
  const parts: string[] = []
  if (rules.sets) {
    const { mode, value, rounding } = rules.sets
    parts.push(mode === 'percent' ? `sets ${MINUS}${value}% (rounded ${rounding})` : `sets ${MINUS}${value}`)
  }
  if (rules.weight) {
    const { percent, rounding, step, stepUnit } = rules.weight
    parts.push(`weight ${percent}% (rounded ${rounding} to ${step} ${stepUnit})`)
  }
  if (rules.reps) parts.push(`reps ${signed(rules.reps.delta)}`)
  if (rules.rir) parts.push(`RIR ${signed(rules.rir.delta)}`)
  return parts.join(' · ')
}

// The line, or null when no rule is on (an unset feature shows nothing — the
// standing UI rule).
export function deloadRulesLine(rules: DeloadRules | null): string | null {
  if (!rules) return null
  const described = describeDeloadRules(rules)
  if (described === '') return null
  return `Deload rules (from Settings): ${described}`
}
