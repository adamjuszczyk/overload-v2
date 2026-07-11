// Converts a rest duration in seconds to a human-readable string:
// under 60s → "45s", 60s or more → "1min 32s".
export function formatRestTime(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}min ${s}s`
}
