import { useState } from 'react'
import { X, ChevronDown, Download, Trash2 } from 'lucide-react'
import type { ExerciseLibrary } from '../../types'
import { MOVEMENT_PATTERN_LABELS, muscleSubgroupLabel } from '../../lib/exerciseTags'
import {
  useLibraries,
  useLibraryItems,
  useDownloadLibrary,
  useLibraryDeletePreview,
  useDeleteLibrary,
} from './useLibraries'
import type { LibraryDeletePreview } from './libraryService'
import { useToastStore } from '../notifications/toastStore'
import ConfirmDialog from '../../components/ConfirmDialog'

// The library list, preview, and download (EXERCISE-LIBRARY-TASKS.md §8
// step 6) — replaces LibraryPage.tsx's old single "import defaults" button
// with a real catalog: every listed library previewable in place, each
// downloadable independently. Zero libraries are listed in production
// today (EXERCISE-LIBRARY-TASKS.md §2.2 — content ships later as a plain
// INSERT), so the empty state below is the real, expected state until then,
// not a loading/error placeholder.
export default function LibraryCatalog({ onClose }: { onClose: () => void }) {
  const { data: libraries = [], isLoading, error } = useLibraries()

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,6,7,0.88)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--surface-raised)',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          padding: '24px 20px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
          maxHeight: '90dvh',
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderBottom: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: '1px',
              color: 'var(--text-primary)',
            }}
          >
            LIBRARIES
          </span>
          <button
            onClick={onClose}
            style={{
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface-overlay)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24, paddingBottom: 24 }}>
            <div
              className="animate-spin"
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: '2px solid var(--border-strong)',
                borderTopColor: 'var(--accent)',
              }}
            />
          </div>
        )}

        {error && !isLoading && (
          <p
            style={{
              textAlign: 'center',
              paddingTop: 24,
              paddingBottom: 24,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '1.5px',
              color: 'var(--error)',
            }}
          >
            FAILED TO LOAD
          </p>
        )}

        {!isLoading && !error && libraries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '2px',
                color: 'var(--text-dim)',
              }}
            >
              NO LIBRARIES YET
            </p>
          </div>
        )}

        {!isLoading && !error && libraries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {libraries.map((lib) => (
              <LibraryRow key={lib.id} library={lib} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LibraryRow({ library }: { library: ExerciseLibrary }) {
  const [expanded, setExpanded] = useState(false)
  const { data: items = [], isLoading: itemsLoading } = useLibraryItems(library.id, expanded)
  const download = useDownloadLibrary()
  const deletePreview = useLibraryDeletePreview()
  const deleteLibrary = useDeleteLibrary()
  const showToast = useToastStore((s) => s.show)

  const [previewingDelete, setPreviewingDelete] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<LibraryDeletePreview | null>(null)

  function handleDownload(e: React.MouseEvent) {
    // Stops the row's own onClick (expand/collapse) from also firing —
    // download and preview are two independent taps on the same row.
    e.stopPropagation()
    download.mutate(library.id, {
      onSuccess: ({ added, skipped }) => {
        showToast(
          added === 0
            ? `All ${skipped} exercises from ${library.name} already in your library`
            : `Added ${added} exercise${added === 1 ? '' : 's'} from ${library.name} · ${skipped} already there`,
        )
      },
      onError: () => showToast(`Could not download ${library.name}`),
    })
  }

  // The split (§6.3/§9.2) must be visible before the action is confirmed,
  // so this always fetches previewLibraryDelete() first rather than opening
  // a dialog straight away — a library with nothing downloaded from it gets
  // a toast instead of an empty confirm.
  async function handleDeleteTap(e: React.MouseEvent) {
    e.stopPropagation()
    setPreviewingDelete(true)
    try {
      const preview = await deletePreview.mutateAsync(library.id)
      if (preview.toDeleteCount === 0 && preview.toLostCount === 0) {
        showToast(`You haven't downloaded any exercises from ${library.name}`)
        return
      }
      setConfirmDelete(preview)
    } catch {
      showToast(`Could not check ${library.name}`)
    } finally {
      setPreviewingDelete(false)
    }
  }

  function handleConfirmDelete() {
    deleteLibrary.mutate(library.id, {
      onSuccess: ({ deleted, lost }) => {
        showToast(`${library.name}: ${deleted} deleted, ${lost} moved to Lost Exercises`)
        setConfirmDelete(null)
      },
      onError: () => showToast(`Could not delete ${library.name}'s exercises`),
    })
  }

  return (
    <>
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textAlign: 'left',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 16,
                color: 'var(--text-primary)',
                marginBottom: library.description ? 4 : 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {library.name}
            </div>
            {library.description && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {library.description}
              </div>
            )}
          </div>
          <ChevronDown
            size={16}
            style={{
              flexShrink: 0,
              color: 'var(--text-muted)',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms',
            }}
          />
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={download.isPending}
          aria-label={`Download ${library.name}`}
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 9,
            cursor: download.isPending ? 'default' : 'pointer',
            color: 'var(--base)',
            opacity: download.isPending ? 0.6 : 1,
          }}
        >
          <Download size={16} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={handleDeleteTap}
          disabled={previewingDelete}
          aria-label={`Delete exercises downloaded from ${library.name}`}
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-overlay)',
            border: '1px solid var(--border-strong)',
            borderRadius: 9,
            cursor: previewingDelete ? 'default' : 'pointer',
            color: 'var(--text-secondary)',
            opacity: previewingDelete ? 0.6 : 1,
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          {itemsLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
              <div
                className="animate-spin"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: '2px solid var(--border-strong)',
                  borderTopColor: 'var(--accent)',
                }}
              />
            </div>
          )}

          {!itemsLoading && items.length === 0 && (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '1.5px',
                color: 'var(--text-dim)',
              }}
            >
              NO EXERCISES IN THIS LIBRARY YET
            </p>
          )}

          {!itemsLoading && items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((item) => {
                const tagBits = [
                  item.movementPattern ? MOVEMENT_PATTERN_LABELS[item.movementPattern] : null,
                  item.muscleSubgroup?.length
                    ? item.muscleSubgroup.map((tag) => muscleSubgroupLabel(tag)).join(', ')
                    : null,
                ].filter((bit): bit is string => bit !== null)

                return (
                  <div key={item.id}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '1px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {item.muscleGroup.toUpperCase()}
                      {tagBits.length > 0 ? ` · ${tagBits.join(' · ')}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>

    {confirmDelete && (
      <ConfirmDialog
        title="DELETE LIBRARY EXERCISES"
        body={
          <>
            This removes every exercise you downloaded from{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{library.name}</strong>:{' '}
            {confirmDelete.toDeleteCount} deleted permanently (no history), {confirmDelete.toLostCount} moved to
            Lost Exercises (history preserved).
          </>
        }
        confirmLabel="REMOVE"
        danger={confirmDelete.toDeleteCount > 0}
        isPending={deleteLibrary.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    )}
    </>
  )
}
