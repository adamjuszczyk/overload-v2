import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel sets this from the actual deployed commit — prefer it over shelling
// out, since a build environment isn't guaranteed to have git history
// available. Falls back to a local `git` call for `npm run dev`/local
// builds, and to 'unknown' if even that fails (e.g. no .git present at all)
// rather than failing the build over a display-only value.
function resolveBuildHash(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

const BUILD_HASH = resolveBuildHash()
const BUILD_TIME = new Date().toISOString()

export default defineConfig({
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-query':    ['@tanstack/react-query'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-charts':   ['recharts'],
          'vendor-dexie':    ['dexie'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration is done explicitly via `virtual:pwa-register/react`
      // (see src/features/pwa/usePwaUpdate.ts) instead of the auto-injected
      // <script>, so it can wire onNeedReload to a dismissible in-app notice
      // instead of the default silent window.location.reload().
      injectRegister: false,
      // vite-plugin-pwa only auto-sets workbox.skipWaiting/clientsClaim from
      // registerType: 'autoUpdate' when injectRegister is 'auto' or unset
      // (its own index.js gates that on injectRegister, not just
      // registerType). injectRegister: false above skips that wiring, so it
      // has to be set explicitly here — without it, workbox-build's own
      // default (false for both) ships a service worker that sits in
      // 'waiting' indefinitely with a tab open, 'activated' never fires, and
      // this whole feature silently never triggers. Found by adversarial
      // review, confirmed against the actual built dist/sw.js before this
      // fix (no self.skipWaiting()/clients.claim() present at all).
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Overload',
        short_name: 'Overload',
        description: 'Progressive strength training tracker',
        theme_color: '#060607',
        background_color: '#060607',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
})
