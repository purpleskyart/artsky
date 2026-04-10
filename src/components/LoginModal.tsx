import { useEffect, useSyncExternalStore } from 'react'
import LoginCard from './LoginCard'
import { useScrollLock } from '../context/ScrollLockContext'
import { useProfileModal } from '../context/ProfileModalContext'
import styles from './LoginModal.module.css'

interface LoginModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const MOBILE_BREAKPOINT = 768
function subscribeMobile(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function getMobileSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
}

export default function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
  const scrollLock = useScrollLock()
  const { closeAllModals } = useProfileModal()
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => false)

  useEffect(() => {
    if (!isOpen) return
    scrollLock?.lockScroll()
    return () => scrollLock?.unlockScroll()
  }, [isOpen, scrollLock])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null
  return (
    <>
      <div
        className={styles.backdrop}
        onClick={isMobile ? onClose : closeAllModals}
        aria-hidden
      />
      <div className={styles.center} role="dialog" aria-modal="true" aria-label="Log in">
        <div className={styles.cardWrap} onClick={(e) => e.stopPropagation()}>
          <LoginCard onSuccess={onSuccess} onClose={onClose} />
        </div>
      </div>
    </>
  )
}
