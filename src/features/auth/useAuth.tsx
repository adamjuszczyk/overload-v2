import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { db } from '../../lib/db'

interface AuthContextValue {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
})

async function wipeOfflineCache() {
  await Promise.all([
    db.exercises.clear(),
    db.workout_days.clear(),
    db.week_plans.clear(),
    db.sessions.clear(),
    db.set_logs.clear(),
    db.sync_queue.clear(),
  ])
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  // Tracks the active user id so cached data never leaks across accounts —
  // cleared whenever auth state resolves to a different user (including null).
  const prevUserId = useRef<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      prevUserId.current = session?.user?.id ?? null
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null
      if (nextUserId !== prevUserId.current) {
        queryClient.clear()
        prevUserId.current = nextUserId
      }
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    queryClient.clear()
    await wipeOfflineCache()
  }

  return <AuthContext.Provider value={{ user, loading, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
