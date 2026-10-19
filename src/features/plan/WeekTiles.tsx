import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Check, Lock } from 'lucide-react'
import { hairline } from '../../components/pickers/pickerControls'
import type { WeekTile } from './weekPlanning'

// Chunk 52 (TASKS-1.2 "Plan's header" → WeekTiles; SPEC Screens → Plan screen → Week row; Weeks and copying [1.2] → "How far ahead"; boards
// 1, 1b, 1c, 1d). A tile per week (cycle) from `weekTiles()` (chunk 42): DONE, THIS WEEK (THIS CYCLE), PLANNED or NOT PLANNED with the lock,
// scrolling sideways, and opened scrolled so the current week's tile is in view (P1.2-6, provisional under D31: centred on it).
// Tapping a tile opens that week; it never plans it (PLAN FORWARD does, on the card the first unplanned week opens).
//
// The open tile is the accent's (text on it is `--on-accent`). Display choices no board settles, provisional under D31 (chunk 52's
// report lists them): a PLANNED tile, which no board draws, is a DONE tile without the tick; every NOT PLANNED tile is dashed and has the
// lock, the first unplanned week after the current one (board 1b) and a past week nobody planned (DECISIONS 131) alike, so a week off
// reads as a week with nothing in it; and the current week's tile outlines in the accent when it isn't open (board 1c).

export interface WeekTilesProps {
  tiles: readonly WeekTile[]
  /** The word for a week on this run: WEEK, or CYCLE on a sequence run. */
  unit: 'WEEK' | 'CYCLE'
  /** The tile that is open. */
  openWeek: number
  /** The week the strip opens scrolled to: the current week. */
  focusWeek: number
  onOpen: (week: number) => void
}

const STATE_TEXT: Record<WeekTile['state'], (unit: 'WEEK' | 'CYCLE') => string> = {
  done: () => 'DONE',
  this: (unit) => `THIS ${unit}`,
  planned: () => 'PLANNED',
  not_planned: () => 'NOT PLANNED',
}

function tileStyle(tile: WeekTile, open: boolean): CSSProperties {
  const base: CSSProperties = {
    flex: '0 0 calc((100% - 16px) / 3)',
    height: 56,
    boxSizing: 'border-box',
    borderRadius: 10,
    padding: '0 12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 4,
    cursor: 'pointer',
  }
  // `color` is the tile's own text (the week's name); the state line under it sets its own where it differs.
  if (open) return { ...base, ...hairline('var(--accent)'), background: 'var(--accent)', color: 'var(--on-accent)' }
  if (tile.state === 'not_planned') {
    return { ...base, borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--border-strong)', background: 'transparent', color: 'var(--text-secondary)' }
  }
  if (tile.state === 'this') return { ...base, ...hairline('var(--accent)'), background: 'var(--surface)', color: 'var(--text-primary)' }
  return { ...base, ...hairline('var(--border)'), background: 'var(--surface)', color: tile.state === 'planned' ? 'var(--text-primary)' : 'var(--text-secondary)' }
}

function WeekTileButton({ tile, unit, open, onOpen }: { tile: WeekTile; unit: 'WEEK' | 'CYCLE'; open: boolean; onOpen: (week: number) => void }) {
  const stateText = STATE_TEXT[tile.state](unit)
  const stateColour = open ? 'var(--on-accent)' : tile.state === 'this' ? 'var(--accent)' : 'var(--text-muted)'
  return (
    <button
      type="button"
      data-week={tile.week}
      aria-label={`${unit} ${tile.week} · ${stateText}`}
      aria-current={open ? 'true' : undefined}
      onClick={() => onOpen(tile.week)}
      style={tileStyle(tile, open)}
    >
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14 }}>{`${unit} ${tile.week}`}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: stateColour }}>
        {tile.state === 'done' && <Check size={11} strokeWidth={3} aria-hidden="true" />}
        {tile.state === 'not_planned' && <Lock size={11} strokeWidth={2.5} aria-hidden="true" />}
        {stateText}
      </span>
    </button>
  )
}

export default function WeekTiles({ tiles, unit, openWeek, focusWeek, onOpen }: WeekTilesProps) {
  const strip = useRef<HTMLDivElement>(null)
  const hasTiles = tiles.length > 0

  // Opens scrolled to the current week's tile, and again if the current week moves on (midnight on a Sunday). Not on every render:
  // a user who scrolled the strip keeps where they are.
  useEffect(() => {
    const row = strip.current
    const tile = row?.querySelector<HTMLElement>(`[data-week="${focusWeek}"]`)
    if (!row || !tile) return
    row.scrollLeft = Math.max(0, tile.offsetLeft - (row.clientWidth - tile.offsetWidth) / 2)
  }, [focusWeek, hasTiles])

  return (
    <div
      ref={strip}
      className="hide-scrollbar"
      aria-label={`${unit === 'WEEK' ? 'Weeks' : 'Cycles'} of this program`}
      style={{ position: 'relative', display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden' }}
    >
      {tiles.map((tile) => (
        <WeekTileButton key={tile.week} tile={tile} unit={unit} open={tile.week === openWeek} onOpen={onOpen} />
      ))}
    </div>
  )
}
