import { defineConfig } from 'vitest/config'

// Deliberately not vite.config.ts's config: setGroupLogic.ts and friends are
// plain TypeScript with no React/PWA dependency, so pulling in those plugins
// here would only slow the test run down for no benefit.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
