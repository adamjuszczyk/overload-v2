// The app's version in tests (chunk 73, after chunk 75's merge). vite.config.ts defines `__APP_VERSION__` from package.json for the build;
// vitest runs no define, and src/lib/version.ts refuses to load without one. Since chunk 73 the sync queue reads the version (versionGate.ts),
// so every test that reaches the queue needs it, and since chunk 75 a Coach test does too (usePriorityContext.ts, useMesos.ts,
// finishedRunQueue.ts, useSyncQueue.ts): Coach's files are frozen (scripts/check-frozen-code.mjs), so that test cannot stub it itself.
// So each test file starts with package.json's version, as the build would give it. A file that needs another version stubs it with
// `vi.stubGlobal`, which replaces this one, and `vi.unstubAllGlobals()` takes this one away too: version.test.ts still sees a module that
// refuses to load when no version was given at all.
import { vi } from 'vitest'
import { version } from './package.json'

vi.stubGlobal('__APP_VERSION__', version)
