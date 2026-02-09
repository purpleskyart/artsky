import { useState, useRef, useEffect } from 'react'
import type { FeedSource, FeedMixEntry } from '../types'
import styles from './FeedSelector.module.css'

const REMIX_EXPLANATION = 'Enable multiple feeds then use − and + to change how many posts from each feed youll see.'

function sameSource(a: FeedSource, b: FeedSource): boolean {
  return (a.uri ?? a.label) === (b.uri ?? b.label)
}

interface Props {
  sources: FeedSource[]
  /** When mix is empty, this is the current single feed (for showing active state) */
  fallbackSource: FeedSource
  mixEntries: FeedMixEntry[]
  onToggle: (source: FeedSource) => void
  setEntryPercent: (index: number, percent: number) => void
  onAddCustom: (input: string) => void | Promise<void>
  /** When set, feed pill and add-custom clicks call this instead of onToggle/onAddCustom (e.g. open login). */
  onToggleWhenGuest?: () => void
  /** 'page' = homepage (compact row, no header). 'dropdown' = Feeds dropdown (title, sections, hints). */
  variant?: 'page' | 'dropdown'
}

export default function FeedSelector({
  sources,
  fallbackSource,
  mixEntries,
  onToggle,
  setEntryPercent,
  onAddCustom,
  onToggleWhenGuest,
  variant = 'page',
}: Props) {
  const [customInput, setCustomInput] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)

  const searchQuery = customInput.trim().toLowerCase()
  const searchWords = searchQuery ? searchQuery.split(/\s+/).filter(Boolean) : []
  const searchResults =
    searchWords.length > 0
      ? sources.filter((s) => {
          const label = (s.label ?? '').toLowerCase()
          const uri = (s.uri ?? '').toLowerCase()
          return searchWords.every((w) => label.includes(w) || uri.includes(w))
        })
      : []
  const maxSuggestions = 10
  const suggestions = searchResults.slice(0, maxSuggestions)

  useEffect(() => {
    if (!showHelp) return
    function handleClickOutside(e: MouseEvent) {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setShowHelp(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showHelp])

  async function handleAddCustom(e: React.FormEvent) {
    e.preventDefault()
    const input = customInput.trim()
    if (!input) return
    const looksLikeUrl = /^(https?:\/\/|at:\/\/)/i.test(input) || input.includes('bsky.app')
    if (looksLikeUrl) {
      setAdding(true)
      try {
        await onAddCustom(input)
        setShowCustom(false)
        setCustomInput('')
      } finally {
        setAdding(false)
      }
      return
    }
    if (suggestions.length === 1) {
      onToggle(suggestions[0])
      setShowCustom(false)
      setCustomInput('')
      return
    }
    setAdding(true)
    try {
      await onAddCustom(input)
      setShowCustom(false)
      setCustomInput('')
    } finally {
      setAdding(false)
    }
  }

  function handleSelectSuggestion(source: FeedSource) {
    onToggle(source)
    setCustomInput('')
    setShowCustom(false)
  }

  const hasMix = mixEntries.length >= 2
  const isDropdown = variant === 'dropdown'

  const helpButton = (
    <div className={styles.helpWrap} ref={helpRef}>
      <button
        type="button"
        className={styles.helpBtn}
        onClick={() => setShowHelp((v) => !v)}
        aria-label="Explain remix feed"
        aria-expanded={showHelp}
        title="How mixing works"
      >
        ?
      </button>
      {showHelp && (
        <div className={styles.helpPopover} role="tooltip">
          {REMIX_EXPLANATION}
        </div>
      )}
    </div>
  )

  const pills = (
    <>
      {sources.map((s) => {
          const entryIndex = mixEntries.findIndex((e) => sameSource(e.source, s))
          const isInMix = entryIndex >= 0 || (mixEntries.length === 0 && sameSource(s, fallbackSource))
          const entry = isInMix ? mixEntries[entryIndex] : null
          const showRatio = isInMix && mixEntries.length >= 2 && entry
          const in10 = entry ? Math.max(1, Math.min(10, Math.round(entry.percent / 10))) : 1
          return (
            <div key={s.uri ?? s.label} className={styles.feedPillWrap}>
              {showRatio ? (
                <div className={styles.feedPillColumn}>
                  <button
                    type="button"
                    className={styles.feedPillWithFill}
                    style={{
                      /* Use opaque surface for right half so no accent/glass tint shows at the end */
                      background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${Math.max(0, entry.percent - 1)}%, var(--surface) ${entry.percent}%, var(--surface) 100%)`,
                    }}
                    onClick={() => onToggleWhenGuest ? onToggleWhenGuest() : onToggle(s)}
                  >
                    <span className={styles.feedPillLabel}>{s.label}</span>
                    <span className={styles.feedPillRatio}>{entry.percent}% of posts</span>
                  </button>
                  <div className={styles.ratioBtnRow}>
                    <button
                      type="button"
                      className={styles.ratioBtnSide}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (onToggleWhenGuest) onToggleWhenGuest()
                        else {
                          const next = Math.max(1, in10 - 1)
                          setEntryPercent(entryIndex, next * 10)
                        }
                      }}
                      aria-label="Fewer posts from this feed"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={styles.ratioBtnSide}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (onToggleWhenGuest) onToggleWhenGuest()
                        else {
                          const next = Math.min(10, in10 + 1)
                          setEntryPercent(entryIndex, next * 10)
                        }
                      }}
                      aria-label="More posts from this feed"
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={isInMix ? styles.active : ''}
                  onClick={() => onToggleWhenGuest ? onToggleWhenGuest() : onToggle(s)}
                >
                  {isInMix ? (
                    <>
                      <span className={styles.feedPillLabel}>{s.label}</span>
                      <span className={styles.feedPillRatio}>100% of posts</span>
                    </>
                  ) : (
                    s.label
                  )}
                </button>
              )}
            </div>
          )
        })}
    </>
  )

  const addCustomBlock = showCustom ? (
    <form onSubmit={handleAddCustom} className={styles.customForm}>
      <input
        type="text"
        placeholder="Paste feed URL or search by name…"
        value={customInput}
        onChange={(e) => setCustomInput(e.target.value)}
        className={styles.input}
        disabled={adding}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={suggestions.length > 0 ? 'feed-search-suggestions' : undefined}
        aria-expanded={suggestions.length > 0}
      />
      {suggestions.length > 0 && (
        <ul
          id="feed-search-suggestions"
          className={styles.customSuggestions}
          role="listbox"
          aria-label="Matching feeds"
        >
          {suggestions.map((s) => (
            <li key={s.uri ?? s.label} role="option">
              <button
                type="button"
                className={styles.customSuggestionItem}
                onClick={() => handleSelectSuggestion(s)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.customActions}>
        <button type="submit" className={styles.btn} disabled={adding}>
          {adding ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className={styles.btnSecondary} onClick={() => setShowCustom(false)} disabled={adding}>
          Cancel
        </button>
      </div>
    </form>
  ) : (
    <button
      type="button"
      className={isDropdown ? styles.addFeed : styles.addFeedPage}
      onClick={() => (onToggleWhenGuest ? onToggleWhenGuest() : setShowCustom(true))}
    >
      + Add custom feed
    </button>
  )

  if (isDropdown) {
    return (
      <div className={`${styles.wrap} ${styles.wrapDropdown}`}>
        <header className={styles.header}>
          <span className={styles.headerTitle}>Feeds</span>
          {helpButton}
        </header>
        <section className={styles.section} aria-label="Choose feeds">
          <p className={styles.sectionHint}>Tap a feed to add or remove it from your mix.</p>
          <div className={styles.tabs}>{pills}</div>
          {hasMix && (
            <p className={styles.ratioHint}>Use − and + under each feed to set how many posts you see from it.</p>
          )}
        </section>
        <section className={styles.sectionAdd}>
          {addCustomBlock}
        </section>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.feedRow}>
        {helpButton}
        <div className={styles.tabs}>{pills}</div>
        {addCustomBlock}
      </div>
    </div>
  )
}
