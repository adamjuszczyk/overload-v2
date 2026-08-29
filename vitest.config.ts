import { defineConfig } from 'vitest/config'

// Deliberately not vite.config.ts's config: setGroupLogic.ts and friends are
// plain TypeScript with no React/PWA dependency, so pulling in those plugins
// here would only slow the test run down for no benefit. esbuild's default
// automatic JSX runtime (tsconfig.app.json's "jsx": "react-jsx") is enough to
// transform the .tsx component tests below without @vitejs/plugin-react.
//
// Default environment stays 'node' — the vast majority of this suite is pure
// logic with no DOM. Component tests opt into jsdom per-file via a
// `// @vitest-environment jsdom` docblock (Vitest's documented mechanism)
// rather than paying jsdom's setup cost for every pure-logic test.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
