// Chunk 25 — extracted out of TodayPage.tsx into its own file (previously
// a local, non-exported function there) so CompletedTodayScreen.tsx and
// SequenceTodayPage.tsx (both new/extracted this chunk) can share it
// without creating a circular import with TodayPage.tsx. Purely
// presentational, byte-identical markup to TodayPage.tsx's own prior
// inline copy.
export default function TodayHeader({ label }: { label: string }) {
  return (
    <>
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </p>
      <h1
        className="text-3xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        TODAY
      </h1>
    </>
  )
}
