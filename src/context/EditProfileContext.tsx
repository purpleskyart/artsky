import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChunkLoadError } from '../components/ChunkLoadError'

const EditProfileModal = lazy(() => import('../components/EditProfileModal'))

type EditProfileContextValue = {
  openEditProfile: () => void
  registerOnSaved: (cb: () => void) => void
  editSavedVersion: number
}

const EditProfileContext = createContext<EditProfileContextValue | null>(null)

export function EditProfileProvider({ children }: { children: ReactNode }) {
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [editSavedVersion, setEditSavedVersion] = useState(0)
  const savedCbRef = useRef<(() => void) | null>(null)

  const openEditProfile = useCallback(() => {
    setEditProfileOpen(true)
  }, [])

  const registerOnSaved = useCallback((cb: () => void) => {
    savedCbRef.current = cb
  }, [])

  const handleSaved = useCallback(() => {
    setEditProfileOpen(false)
    setEditSavedVersion((v) => v + 1)
    savedCbRef.current?.()
  }, [])

  const value: EditProfileContextValue = useMemo(() => ({
    openEditProfile,
    registerOnSaved,
    editSavedVersion,
  }), [openEditProfile, registerOnSaved, editSavedVersion])

  return (
    <EditProfileContext.Provider value={value}>
      {children}
      {editProfileOpen && (
        <ChunkLoadError>
          <Suspense fallback={null}>
            <EditProfileModal
              onClose={() => setEditProfileOpen(false)}
              onSaved={handleSaved}
            />
          </Suspense>
        </ChunkLoadError>
      )}
    </EditProfileContext.Provider>
  )
}

export function useEditProfile(): EditProfileContextValue | null {
  return useContext(EditProfileContext)
}
