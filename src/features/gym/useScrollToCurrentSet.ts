import { useCallback, useEffect, useRef, useState } from 'react'
import { scrollRowIntoView } from './scrollArea'

// "Current set" = the first unlogged working set or drop of the session (SPEC [1.2] "Current set"; chunk 58a): SetRowCurrent.tsx marks
// that one row's wrapper with data-current-set, which this hook finds (there is at most one on the screen: workoutRules' `currentSet`). A button is
// shown only while that row is scrolled out of the app shell's scrollable
// viewport (App.tsx's <main>, not window — this app never scrolls window
// itself), so the button never appears while the current set is already on
// screen.
//
// Re-locates the target via a MutationObserver on the container rather than
// a caller-supplied dependency array (an earlier version took a deps list —
// found by live-testing against a real session: tapping ADD SET creates a
// brand new unlogged row from ExerciseCard-local state, which doesn't
// change any prop this hook's caller could feasibly list as a dependency,
// so that version never noticed the new row existed).
//
// Visibility is computed on scroll via getBoundingClientRect, not
// IntersectionObserver — also found by live-testing: this app's dev preview
// tab runs backgrounded/uncomposited for long stretches (document.hidden),
// and Chromium throttles IntersectionObserver callbacks for backgrounded
// tabs right along with requestAnimationFrame, so the button never updated
// in that state. A plain scroll listener + synchronous rect read isn't
// gated by paint/compositing the same way and was confirmed live to work
// correctly in that exact backgrounded state.
//
// Takes the container via a callback ref (returned as `containerRef` below,
// meant to be passed straight to an element's `ref` prop), not a
// caller-supplied useRef object — found by adversarial review: a plain
// RefObject's identity never changes when `.current` changes, so an effect
// keyed on that RefObject can never re-run when the DOM node itself is
// swapped (e.g. GymSession.tsx conditionally returns <FinishScreen />
// instead of the exercises container on FINISH SESSION, then swaps back to
// a brand-new container node on BACK TO SESSION — the same GymSession
// component instance stays mounted throughout, so its hooks including this
// one persist unchanged). A callback ref fires on every attach *and*
// detach, which correctly drives a state update the effect can key on.
// direction: null while the current set is in view (button hidden, same
// gating as before) — 'up' when it's scrolled above the viewport, 'down'
// when below, so the button can point the way instead of always pointing
// down regardless of which way the target actually is.
export function useScrollToCurrentSet() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [direction, setDirection] = useState<'up' | 'down' | null>(null)
  const targetRef = useRef<Element | null>(null)

  const checkVisibility = useCallback(() => {
    const target = targetRef.current
    if (!target) {
      setDirection(null)
      return
    }
    const rect = target.getBoundingClientRect()
    const scrollParent = document.querySelector('main')
    const viewportTop = scrollParent?.getBoundingClientRect().top ?? 0
    const viewportBottom = scrollParent?.getBoundingClientRect().bottom ?? window.innerHeight
    if (rect.bottom > viewportTop && rect.top < viewportBottom) {
      setDirection(null)
    } else if (rect.top >= viewportBottom) {
      setDirection('down')
    } else {
      setDirection('up')
    }
  }, [])

  useEffect(() => {
    if (!container) {
      targetRef.current = null
      setDirection(null)
      return
    }

    function resync() {
      targetRef.current = container!.querySelector('[data-current-set]')
      checkVisibility()
    }

    resync()
    const mutationObserver = new MutationObserver(resync)
    mutationObserver.observe(container, { childList: true, subtree: true })

    const scrollParent = document.querySelector('main')
    scrollParent?.addEventListener('scroll', checkVisibility, { passive: true })
    window.addEventListener('resize', checkVisibility)

    return () => {
      mutationObserver.disconnect()
      scrollParent?.removeEventListener('scroll', checkVisibility)
      window.removeEventListener('resize', checkVisibility)
    }
  }, [container, checkVisibility])

  // Top quarter of the scroller, not dead center or the very top edge — keeps a bit of context visible above the row without burying it near the
  // bottom. The math is `scrollArea.ts`'s (chunk 64), which the finish screen's GO BACK shares: one way to scroll a row into view.
  const scrollToCurrentSet = useCallback(() => {
    const target = targetRef.current
    if (!target) return
    scrollRowIntoView(target)
  }, [])

  return { containerRef: setContainer, direction, scrollToCurrentSet }
}
