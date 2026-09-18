import { createContext, useContext, type ReactNode } from 'react'

/** When inside AppModal, provides the modal's scroll container element for virtualization/lazy loading. */
const ModalScrollContext = createContext<HTMLDivElement | null>(null)

export function ModalScrollProvider({
  scrollElement,
  children,
}: {
  scrollElement: HTMLDivElement | null
  children: ReactNode
}) {
  return (
    <ModalScrollContext.Provider value={scrollElement}>
      {children}
    </ModalScrollContext.Provider>
  )
}

export function useModalScroll(): HTMLDivElement | null {
  return useContext(ModalScrollContext)
}
