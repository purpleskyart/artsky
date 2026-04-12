import { useState, useCallback } from 'react'
import styles from './SpoilerText.module.css'

interface SpoilerTextProps {
  children: React.ReactNode
  className?: string
}

export default function SpoilerText({ children, className }: SpoilerTextProps) {
  const [revealed, setRevealed] = useState(false)

  const handleClick = useCallback(() => {
    setRevealed((prev) => !prev)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setRevealed((prev) => !prev)
    }
  }, [])

  return (
    <span
      className={`${styles.spoiler} ${revealed ? styles.revealed : ''} ${className || ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={revealed ? 'Spoiler revealed, click to hide' : 'Spoiler hidden, click to reveal'}
      aria-pressed={revealed}
    >
      <span className={styles.spoilerContent}>{children}</span>
      {!revealed && <span className={styles.spoilerOverlay}>Spoiler — tap to reveal</span>}
    </span>
  )
}
