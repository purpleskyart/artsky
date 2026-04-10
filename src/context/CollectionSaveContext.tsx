import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useSession } from './SessionContext'
import { useLoginModal } from './LoginModalContext'
import { useToast } from './ToastContext'
import {
  addPostToCollection,
  createCollection,
  listMyCollectionSummaries,
  loadUnionSavedPostUris,
  rememberActiveCollectionAtUri,
  removePostFromCollection,
  resolveActiveCollectionAtUri,
} from '../lib/collections'

type Ctx = {
  /** Subscribe to saved-state changes for a single post URI (avoids notifying every mounted menu on unrelated saves). */
  subscribe: (postUri: string, onStoreChange: () => void) => () => void
  getSnapshot: (postUri: string) => boolean
  savingUri: string | null
  activeCollectionAtUri: string | null
  /** Reload union of saved post URIs from the PDS (e.g. after edits on a collection page). */
  refreshUnionFromPds: () => Promise<void>
  quickSavePost: (postUri: string) => Promise<void>
  savePostToCollection: (postUri: string, collectionAtUri: string) => Promise<void>
  removePostFromCollectionUi: (postUri: string, collectionAtUri: string) => Promise<void>
  createCollectionAndAddPost: (postUri: string, title: string, opts?: { isPrivate?: boolean }) => Promise<void>
}

const CollectionSaveContext = createContext<Ctx | null>(null)

export function CollectionSaveProvider({ children }: { children: ReactNode }) {
  const { session } = useSession()
  const { openLoginModal } = useLoginModal()
  const toast = useToast()
  const savedRef = useRef<Set<string>>(new Set())
  const listenersByPostUriRef = useRef<Map<string, Set<() => void>>>(new Map())
  const [savingUri, setSavingUri] = useState<string | null>(null)
  const [activeCollectionAtUri, setActiveCollectionAtUri] = useState<string | null>(null)
  const opLockRef = useRef(false)

  const emitAll = useCallback(() => {
    for (const set of listenersByPostUriRef.current.values()) {
      for (const l of set) {
        l()
      }
    }
  }, [])

  const emitPost = useCallback((postUri: string) => {
    const set = listenersByPostUriRef.current.get(postUri)
    if (!set) return
    for (const l of set) {
      l()
    }
  }, [])

  const subscribe = useCallback((postUri: string, onChange: () => void) => {
    let set = listenersByPostUriRef.current.get(postUri)
    if (!set) {
      set = new Set()
      listenersByPostUriRef.current.set(postUri, set)
    }
    set.add(onChange)
    return () => {
      const s = listenersByPostUriRef.current.get(postUri)
      if (!s) return
      s.delete(onChange)
      if (s.size === 0) {
        listenersByPostUriRef.current.delete(postUri)
      }
    }
  }, [])

  const getSnapshot = useCallback((postUri: string) => savedRef.current.has(postUri), [])

  const refreshUnionFromPds = useCallback(async () => {
    if (!session?.did) {
      savedRef.current = new Set()
      setActiveCollectionAtUri(null)
      emitAll()
      return
    }
    const union = await loadUnionSavedPostUris()
    savedRef.current = union
    emitAll()
    const atUri = await resolveActiveCollectionAtUri(session.did)
    setActiveCollectionAtUri(atUri)
  }, [session?.did, emitAll])

  const quickSavePost = useCallback(
    async (postUri: string) => {
      if (!session?.did) {
        openLoginModal()
        return
      }
      if (opLockRef.current) return
      opLockRef.current = true
      setSavingUri(postUri)
      try {
        const summaries = await listMyCollectionSummaries()
        const savedSummary = summaries.find((c) => c.title.trim().toLowerCase() === 'saved')
        let targetCollection = savedSummary?.uri ?? null
        if (!targetCollection) {
          const { uri } = await createCollection('Saved')
          targetCollection = uri
        }
        /* Keep "Saved" as the default quick-save target. */
        rememberActiveCollectionAtUri(session.did, targetCollection)
        setActiveCollectionAtUri(targetCollection)
        await addPostToCollection(targetCollection, postUri)
        savedRef.current.add(postUri)
        emitPost(postUri)
      } catch (e) {
        toast?.showToast(e instanceof Error ? e.message : 'Could not save')
        await refreshUnionFromPds()
      } finally {
        setSavingUri(null)
        opLockRef.current = false
      }
    },
    [session?.did, openLoginModal, emitPost, toast, refreshUnionFromPds]
  )

  useEffect(() => {
    if (!session?.did) {
      savedRef.current = new Set()
      setActiveCollectionAtUri(null)
      emitAll()
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const union = await loadUnionSavedPostUris()
        if (cancelled) return
        savedRef.current = union
        emitAll()
        const atUri = await resolveActiveCollectionAtUri(session.did)
        if (cancelled) return
        setActiveCollectionAtUri(atUri)
      } catch {
        if (!cancelled) {
          savedRef.current = new Set()
          emitAll()
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session?.did, emitAll])

  const savePostToCollection = useCallback(
    async (postUri: string, collectionAtUri: string) => {
      if (!session?.did) {
        openLoginModal()
        return
      }
      if (opLockRef.current) return
      opLockRef.current = true
      setSavingUri(postUri)
      try {
        await addPostToCollection(collectionAtUri, postUri)
        rememberActiveCollectionAtUri(session.did, collectionAtUri)
        setActiveCollectionAtUri(collectionAtUri)
        savedRef.current.add(postUri)
        emitPost(postUri)
      } catch (e) {
        toast?.showToast(e instanceof Error ? e.message : 'Could not save')
        await refreshUnionFromPds()
      } finally {
        setSavingUri(null)
        opLockRef.current = false
      }
    },
    [session?.did, openLoginModal, toast, emitPost, refreshUnionFromPds]
  )

  const removePostFromCollectionUi = useCallback(
    async (postUri: string, collectionAtUri: string) => {
      if (!session?.did) {
        openLoginModal()
        return
      }
      if (opLockRef.current) return
      opLockRef.current = true
      setSavingUri(postUri)
      try {
        await removePostFromCollection(collectionAtUri, postUri)
        const union = await loadUnionSavedPostUris()
        savedRef.current = union
        emitAll()
      } catch (e) {
        toast?.showToast(e instanceof Error ? e.message : 'Could not remove')
        await refreshUnionFromPds()
      } finally {
        setSavingUri(null)
        opLockRef.current = false
      }
    },
    [session?.did, openLoginModal, toast, emitAll, refreshUnionFromPds]
  )

  const createCollectionAndAddPost = useCallback(
    async (postUri: string, title: string, opts?: { isPrivate?: boolean }) => {
      if (!session?.did) {
        openLoginModal()
        return
      }
      if (opLockRef.current) return
      opLockRef.current = true
      setSavingUri(postUri)
      try {
        const { uri } = await createCollection(title, { isPrivate: opts?.isPrivate === true })
        await addPostToCollection(uri, postUri)
        rememberActiveCollectionAtUri(session.did, uri)
        setActiveCollectionAtUri(uri)
        savedRef.current.add(postUri)
        emitPost(postUri)
      } catch (e) {
        toast?.showToast(e instanceof Error ? e.message : 'Could not create collection')
        await refreshUnionFromPds()
      } finally {
        setSavingUri(null)
        opLockRef.current = false
      }
    },
    [session?.did, openLoginModal, toast, emitPost, refreshUnionFromPds]
  )

  const value = useMemo(
    () => ({
      subscribe,
      getSnapshot,
      savingUri,
      activeCollectionAtUri,
      refreshUnionFromPds,
      quickSavePost,
      savePostToCollection,
      removePostFromCollectionUi,
      createCollectionAndAddPost,
    }),
    [
      subscribe,
      getSnapshot,
      savingUri,
      activeCollectionAtUri,
      refreshUnionFromPds,
      quickSavePost,
      savePostToCollection,
      removePostFromCollectionUi,
      createCollectionAndAddPost,
    ]
  )

  return <CollectionSaveContext.Provider value={value}>{children}</CollectionSaveContext.Provider>
}

/** True if this post appears in at least one of your collections. */
export function useIsPostSavedToAnyCollection(postUri: string): boolean {
  const ctx = useContext(CollectionSaveContext)
  return useSyncExternalStore(
    (onStoreChange) => (ctx ? ctx.subscribe(postUri, onStoreChange) : () => {}),
    () => ctx?.getSnapshot(postUri) ?? false,
    () => false
  )
}

const COLLECTION_SAVE_ACTIONS_FALLBACK = {
  savingUri: null as string | null,
  activeCollectionAtUri: null as string | null,
  refreshUnionFromPds: async () => {},
  quickSavePost: async () => {},
  savePostToCollection: async () => {},
  removePostFromCollectionUi: async () => {},
  createCollectionAndAddPost: async () => {},
}

export function useCollectionSaveActions() {
  const ctx = useContext(CollectionSaveContext)
  return useMemo(() => {
    if (!ctx) {
      return COLLECTION_SAVE_ACTIONS_FALLBACK
    }
    return {
      savingUri: ctx.savingUri,
      activeCollectionAtUri: ctx.activeCollectionAtUri,
      refreshUnionFromPds: ctx.refreshUnionFromPds,
      quickSavePost: ctx.quickSavePost,
      savePostToCollection: ctx.savePostToCollection,
      removePostFromCollectionUi: ctx.removePostFromCollectionUi,
      createCollectionAndAddPost: ctx.createCollectionAndAddPost,
    }
  }, [ctx])
}
