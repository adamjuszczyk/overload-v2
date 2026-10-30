import { useDemo } from '../demo/demoStore'
export function useOnlineStatus() { return useDemo((s) => s.online) }
