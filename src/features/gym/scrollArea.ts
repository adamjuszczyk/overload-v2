// Chunk 64 — the workout screen's scroll area, in one place (TASKS-1.2 64: GO BACK "scrolls to the first listed set via `useScrollToCurrentSet`'s target"; SPEC 11:
// "BACK TO SESSION closes it where it was"). This app never scrolls the window: its scroller is App.tsx's <main>, which the jump button
// (`useScrollToCurrentSet`) and the finish screen's two ways back both read, so the scroll math is written once, here.

/** The scroller (App.tsx's `<main>`), or null where there is none (a test, a fixture picture). */
export function scrollParent(): HTMLElement | null {
  return document.querySelector('main')
}

/**
 * Scrolls `target` to the top quarter of the scroller, smoothly: not dead centre or the very top edge, so a bit of context stays visible above the row
 * without burying it near the bottom (the jump button's way since 58a).
 */
export function scrollRowIntoView(target: Element): void {
  const rect = target.getBoundingClientRect()
  const parent = scrollParent()
  const viewportHeight = parent?.clientHeight ?? window.innerHeight
  const currentScrollTop = parent?.scrollTop ?? window.scrollY
  const top = currentScrollTop + (rect.top - viewportHeight * 0.25)
  if (parent) parent.scrollTo({ top, behavior: 'smooth' })
  else window.scrollTo({ top, behavior: 'smooth' })
}

/** The row the screen draws for a row key (`ResolvedRow.key`, on `data-row-key`), or null when no row of that key is on the screen. */
export function findRow(key: string): Element | null {
  for (const el of document.querySelectorAll('[data-row-key]')) if (el.getAttribute('data-row-key') === key) return el
  return null
}

/** Scrolls the row with this key into view (GO BACK on the finish screen). Returns whether a row was there to scroll to. */
export function scrollToRowKey(key: string): boolean {
  const row = findRow(key)
  if (row === null) return false
  scrollRowIntoView(row)
  return true
}

/** How far the scroller is scrolled; 0 with no scroller. */
export function readScrollTop(): number {
  return scrollParent()?.scrollTop ?? 0
}

/** Puts the scroller at `top`, at once (no animation: the screen was swapped, not scrolled); nothing with no scroller. */
export function writeScrollTop(top: number): void {
  const parent = scrollParent()
  if (parent) parent.scrollTop = top
}
