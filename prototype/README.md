# Overload 1.2.1 — prototype

The clickable prototype from the 1.2.1 spec chat. It runs the app's **real screens** from `../src` on fake data, with
1.2.1's changes applied. The DEMO tab on the right edge lists every screen and state in SPEC.md.

Builders lift **look and layout** from here, never its data handling (BUILD.md, Tasks rule 10).

## How it works

- `vite.config.ts` swaps some real modules at build time:
  - `src/fakes/`: the data hooks, replaced by in-memory or query-cache fakes. Supabase is never reached.
  - `src/overrides/`: copies of real files with the 1.2.1 change applied. Each change is marked with a `1.2.1 item N`
    comment. Diff an override against its original in `../src` to see exactly what changes.
- `src/screens/`: new 1.2.1 screens (What's new, maintenance, update, tempo picker, the delete confirmation's body).
- `src/demo/`: the DEMO menu, and the fixtures. The workout uses board W1's data from `GymSession.boards.test.tsx`; the
  finished program uses `programHistory.testutil`'s "Cut PPL".

## Commands (from `prototype/`)

- `node override.mjs features/gym/Foo.tsx`: copy a real file into `src/overrides/` with its imports pointed at `../src`.
  Add it to `OVERRIDDEN` in `vite.config.ts` if other real files import it.
- `npx vitest run test --root .`: the smoke tests (every DEMO state renders, and each item's change is there).
- `bash check/run.sh`: build, inline into one page (`overload-1.2.1-prototype.html`), then open every DEMO state in a real
  browser at phone size, in both themes. It reports anything that cuts off its own content and saves a screenshot per
  state in `check/shots/`. **Publish only after a clean run, and look at the screenshots.** jsdom tests can't see
  heights.
