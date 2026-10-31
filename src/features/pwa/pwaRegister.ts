// The one place the app imports vite-plugin-pwa's virtual module. It exists only inside vite.config.ts's plugin pipeline (the build and the dev
// server), not in vitest's, and Vite's import analysis refuses a file that names it even when a test mocks the name. So the hook that needs the
// registration (useServiceWorker.ts) imports it from here, and a test stands in for THIS file (`vi.mock('./pwaRegister')`) instead of for the
// virtual id. Nothing else belongs in this file.
export { useRegisterSW } from 'virtual:pwa-register/react'
