/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // 'staging' on the staging deployment (src/lib/appEnv.ts); unset in the real app.
  readonly VITE_APP_ENV?: string
}

// Injected by vite.config.ts's `define` — short commit hash + build
// timestamp of whatever's actually running, shown in Settings. Real
// string literals at build time, not runtime values — see
// resolveBuildHash() in vite.config.ts.
declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string

// The app's version — package.json's `version`, read by vite.config.ts's `define` the same way (1.2.1; Settings' WHAT'S NEW, the release
// gates). src/lib/version.ts is the one place the app reads it; a test that imports that file stubs this first, as the two above are stubbed.
declare const __APP_VERSION__: string
