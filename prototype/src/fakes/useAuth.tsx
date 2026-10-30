import type { ReactNode } from 'react'
const user = { id: 'proto-user', email: 'you@example.com' }
export function AuthProvider({ children }: { children: ReactNode }) { return <>{children}</> }
export function useAuth() {
  return { user, session: { user }, loading: false, signOut: async () => {}, signIn: async () => ({ error: null }) } as any
}
