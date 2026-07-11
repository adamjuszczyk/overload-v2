import { useEffect } from 'react'
import { useToastStore } from './toastStore'

export default function Toast() {
  const message = useToastStore((s) => s.message)
  const clear = useToastStore((s) => s.clear)

  useEffect(() => {
    if (!message) return
    const id = setTimeout(clear, 3000)
    return () => clearTimeout(id)
  }, [message, clear])

  if (!message) return null

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl text-sm font-bold text-center"
      style={{
        bottom: 'calc(96px + env(safe-area-inset-bottom))',
        maxWidth: 'calc(100vw - 32px)',
        backgroundColor: 'var(--surface-overlay)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {message}
    </div>
  )
}
