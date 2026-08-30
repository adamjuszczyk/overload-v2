import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import {
  fetchLibraries,
  fetchLibraryItems,
  downloadLibrary,
  previewLibraryDelete,
  deleteLibrary,
} from './libraryService'

export function useLibraries() {
  return useQuery({
    queryKey: ['libraries'],
    queryFn: fetchLibraries,
  })
}

// Lazy per-library preview — only fetched once a library's row is expanded
// (`enabled`), not up front for every listed library.
export function useLibraryItems(libraryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['libraries', libraryId, 'items'],
    queryFn: () => fetchLibraryItems(libraryId),
    enabled,
  })
}

export function useDownloadLibrary() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: (libraryId: string) => downloadLibrary(user!.id, libraryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}

// On-demand, same reasoning as useExerciseDeletePreview — fired once, right
// before the delete-library confirm dialog opens.
export function useLibraryDeletePreview() {
  return useMutation({ mutationFn: (libraryId: string) => previewLibraryDelete(libraryId) })
}

export function useDeleteLibrary() {
  return useMutation({
    mutationFn: (libraryId: string) => deleteLibrary(libraryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}
