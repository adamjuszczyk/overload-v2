/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by vite.config.ts's `define` — short commit hash + build
// timestamp of whatever's actually running, shown in Settings. Real
// string literals at build time, not runtime values — see
// resolveBuildHash() in vite.config.ts.
declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string
// TEMP: ignoreCommand regression test marker, reverted in the immediate follow-up commit.
