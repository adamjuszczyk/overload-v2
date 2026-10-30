import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The prototype renders the real app's code from the repo clone, with its data
// hooks swapped for fakes. A real module listed here is replaced wherever it's
// imported, so real screens run unchanged on fake data.
// In the repo the prototype sits at prototype/, beside src/. PROTOTYPE_APP_SRC points it elsewhere (the spec chat's clone).
const REPO = fs.realpathSync(path.resolve(__dirname, process.env.PROTOTYPE_APP_SRC ?? '../src'))
const FAKES = path.resolve(__dirname, 'src/fakes')
const OVERRIDES = path.resolve(__dirname, 'src/overrides')

const SWAPS: Record<string, string> = {
  'lib/supabase.ts': 'supabase.ts',
  'features/auth/useAuth.tsx': 'useAuth.tsx',
  'features/settings/useSettings.ts': 'useSettings.ts',
  'hooks/useOnlineStatus.ts': 'useOnlineStatus.ts',
  'features/offline/useInstallPrompt.ts': 'useInstallPrompt.ts',
  // The workout (board W1's harness, GymSession.boards.test.tsx).
  'features/gym/useSession.ts': 'gym/useSession.ts',
  'features/programs/usePrograms.ts': 'gym/usePrograms.ts',
  'features/planner/usePlanner.ts': 'gym/usePlanner.ts',
  'features/library/useExercises.ts': 'gym/useExercises.ts',
  'features/offline/offlineCache.ts': 'gym/offlineCache.ts',
  'features/gym/useAutoFinishSession.ts': 'gym/useAutoFinishSession.ts',
  'features/gym/useSessionDuration.ts': 'gym/useSessionDuration.ts',
  'features/offline/useSyncQueue.ts': 'gym/useSyncQueue.ts',
  'features/gym/sessionDrafts.ts': 'gym/sessionDrafts.ts',
  'features/gym/WarmupRoutineChecklist.tsx': 'gym/Nothing.tsx',
  'features/offline/SyncFailedNotice.tsx': 'gym/Nothing.tsx',
}

// Real modules changed for 1.2.1 that other real modules import: swapped for their copies in src/overrides.
const OVERRIDDEN = [
  'features/programs/programHistory.ts',
  'features/gym/SetRowWarmup.tsx',
  'features/gym/RestBar.tsx',
  'features/gym/ExerciseHeader.tsx',
  'features/gym/setOptionsView.ts',
  'features/gym/setRowParts.tsx',
  'features/gym/GymSession.tsx',
  'features/gym/useExerciseCardState.ts',
  'features/gym/WorkoutRow.tsx',
  'features/gym/SetRowCurrent.tsx',
]

function fakeDataLayer(): Plugin {
  const swaps = Object.fromEntries(
    [
      ...Object.entries(SWAPS).map(([real, fake]) => [path.join(REPO, real), path.join(FAKES, fake)]),
      ...OVERRIDDEN.map((real) => [path.join(REPO, real), path.join(OVERRIDES, path.basename(real))]),
    ],
  )
  return {
    name: 'prototype-fake-data',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(FAKES)) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      // A swap never points a module at itself (an override importing nothing of its own original).
      if (resolved && swaps[resolved.id] && swaps[resolved.id] !== importer) return swaps[resolved.id]
      return null
    },
  }
}

export default defineConfig({
  plugins: [fakeDataLayer(), react(), tailwindcss()],
  resolve: { alias: { '@app': REPO } },
  define: {
    __BUILD_HASH__: JSON.stringify('proto'),
    __BUILD_TIME__: JSON.stringify('2026-10-29T21:00:00.000Z'),
  },
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
