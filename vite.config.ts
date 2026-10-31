import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
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

// The app's version: `package.json`'s `version`, the one place it is set (SPEC.md 1.2.1, "The app's version"; TASKS.md, Facts to verify 5).
// It reaches the app as `__APP_VERSION__`, beside the build hash and time, and src/lib/version.ts is the one place the app reads it.
// Read from the file next to this one, not from the working directory, and refused when it is not dotted numbers: a version the
// app could not compare would pass or fail the release gates (chunks 72, 73) wrongly.
function resolveAppVersion(): string {
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version?: unknown }
  if (typeof version !== 'string' || !/^\d+(\.\d+){1,2}$/.test(version)) {
    throw new Error(`package.json's "version" must be dotted numbers such as 1.2.1, got ${JSON.stringify(version)}`)
  }
  return version
}

const APP_VERSION = resolveAppVersion()

// The staging build (VITE_APP_ENV=staging; same reading as src/lib/appEnv.ts's
// resolveAppEnv) installs as a different PWA — another name, the cyan icons
// from scripts/gen-icons.mjs, another theme colour — and its page title and
// favicon differ, so it can't be mistaken for the real app on a phone.
function pwaIdentity(isStaging: boolean) {
  return isStaging
    ? { name: 'Overload STAGING', shortName: 'OL Staging', theme: '#0b3a42', icon: 'icon-staging', favicon: 'favicon-staging.svg' }
    : { name: 'Overload', shortName: 'Overload', theme: '#060607', icon: 'icon', favicon: 'favicon.svg' }
}

// index.html carries the real app's title, favicon and theme colour; the
// staging build swaps them.
function stagingHtml(id: ReturnType<typeof pwaIdentity>): Plugin {
  return {
    name: 'overload-staging-html',
    transformIndexHtml(html) {
      return html
        .replace('<title>Overload</title>', `<title>${id.name}</title>`)
        .replace('href="/favicon.svg"', `href="/${id.favicon}"`)
        .replace('<meta name="theme-color" content="#060607" />', `<meta name="theme-color" content="${id.theme}" />`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const appEnv = loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_ENV ?? ''
  const id = pwaIdentity(appEnv.trim().toLowerCase() === 'staging')
  return {
    define: {
      __BUILD_HASH__: JSON.stringify(BUILD_HASH),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
      __APP_VERSION__: JSON.stringify(APP_VERSION),
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
      stagingHtml(id),
      VitePWA({
        registerType: 'autoUpdate',
        // Registration is done explicitly via `virtual:pwa-register/react`
        // (see src/features/pwa/useServiceWorker.ts) instead of the auto-injected
        // <script>, so it can wire onNeedReload to a record the update screen
        // reads instead of the default silent window.location.reload().
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
        includeAssets: [id.favicon, `${id.icon}-192.png`, `${id.icon}-512.png`],
        manifest: {
          name: id.name,
          short_name: id.shortName,
          description: 'Progressive strength training tracker',
          theme_color: id.theme,
          background_color: '#060607',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: `/${id.icon}-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `/${id.icon}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          skipWaiting: true,
          clientsClaim: true,
        },
      }),
    ],
  }
})
