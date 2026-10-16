// A test helper for the rule "text on the accent uses `--on-accent`" (DECISIONS 128 (g), 129 (d) and 130 (j);
// Adam, 2026-10-15: "add a new token --on-accent ... set to the near-black the boards draw, and use it
// wherever text sits on the accent"). A sheet's test renders a state and asks for everything in it that
// draws something to read on the accent colour; the rule is then asserted on each of those elements, at the
// screen that draws them, and the test also names how many it expects, so a scan that finds nothing cannot pass.
//
// "Sits on the accent" is read off the inline style the components write: the element's own background is
// `var(--accent)` (as a `background` or a `background-color`) and it holds text or an icon. A dot or a bar
// with nothing in it (a radio's dot) is not text. Only the elements in `root`'s subtree are scanned, so a
// sheet drawn through a portal is scanned from `document.body`.

const ACCENT = 'var(--accent)'

function onAccentBackground(el: HTMLElement): boolean {
  return el.style.background.trim() === ACCENT || el.style.backgroundColor.trim() === ACCENT
}

function hasSomethingToRead(el: HTMLElement): boolean {
  return (el.textContent ?? '').trim() !== '' || el.querySelector('svg') !== null
}

/** Every element under `root` with the accent as its own background and text or an icon on it, in document order. */
export function textOnAccent(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => onAccentBackground(el) && hasSomethingToRead(el))
}

/** What each of those elements draws its text in (the inline `color`), for a failure message and for assertions. */
export function textOnAccentColours(root: ParentNode): string[] {
  return textOnAccent(root).map((el) => el.style.color)
}
