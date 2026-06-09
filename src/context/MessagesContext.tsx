import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type ActiveChat = {
  convoId?: string
  memberDid: string
  memberHandle?: string
}

type MessagesContextValue = {
  messagesPanelOpen: boolean
  setMessagesPanelOpen: (open: boolean) => void
  toggleMessagesPanel: () => void
  activeChat: ActiveChat | null
  openChat: (memberDid: string, memberHandle?: string, convoId?: string) => void
  closeChat: () => void
}

const MessagesContext = createContext<MessagesContextValue | null>(null)

export function MessagesProvider({ children }: { children: ReactNode }) {
  const [messagesPanelOpen, setMessagesPanelOpen] = useState(false)
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null)

  const openChat = useCallback((memberDid: string, memberHandle?: string, convoId?: string) => {
    setActiveChat({ memberDid, memberHandle, convoId })
    setMessagesPanelOpen(false)
  }, [])

  const closeChat = useCallback(() => setActiveChat(null), [])

  const toggleMessagesPanel = useCallback(() => setMessagesPanelOpen((open) => !open), [])

  const value = useMemo(
    () => ({
      messagesPanelOpen,
      setMessagesPanelOpen,
      toggleMessagesPanel,
      activeChat,
      openChat,
      closeChat,
    }),
    [messagesPanelOpen, toggleMessagesPanel, activeChat, openChat, closeChat]
  )

  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
}

export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext)
  if (!ctx) throw new Error('useMessages must be used within MessagesProvider')
  return ctx
}
