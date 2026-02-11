import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from 'react'
import { createPortal } from 'react-dom'
import type { AppBskyActorDefs } from '@atproto/api'
import {
  searchActorsTypeahead,
  searchForumDocuments,
  searchPostsByTag,
  getStandardSiteDocumentUrl,
} from '../lib/bsky'
import type { StandardSiteDocumentView } from '../lib/bsky'
import styles from './ComposerSuggestions.module.css'

const TRIGGERS = ['@', '#', '%'] as const
const DEBOUNCE_MS = 200
const MAX_SUGGESTIONS = 8

type TriggerKind = (typeof TRIGGERS)[number]

/** Find the active trigger and query before cursor. Returns { trigger, query, startIndex } or null. */
function getTriggerAtCursor(text: string, cursor: number): { trigger: TriggerKind; query: string; startIndex: number } | null {
  const before = text.slice(0, cursor)
  for (const trigger of TRIGGERS) {
    const lastIdx = before.lastIndexOf(trigger)
    if (lastIdx === -1) continue
    const charBefore = lastIdx === 0 ? ' ' : before[lastIdx - 1]
    if (charBefore !== ' ' && charBefore !== '\n') continue
    const query = before.slice(lastIdx + 1)
    const invalid =
      trigger === '@' && /[\s\n]/.test(query)
        ? true
        : trigger === '#' && /[\s\n]/.test(query)
          ? true
          : false
    if (invalid) continue
    return { trigger, query, startIndex: lastIdx }
  }
  return null
}

export type ComposerSuggestionsProps = {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  rows?: number
  maxLength?: number
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  /** Ref forwarded to the underlying textarea */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}

type SuggestionUser = { type: 'user'; handle: string; displayName?: string; avatar?: string }
type SuggestionTag = { type: 'tag'; tag: string; count?: number }
type SuggestionForum = { type: 'forum'; doc: StandardSiteDocumentView }
type Suggestion = SuggestionUser | SuggestionTag | SuggestionForum

export default function ComposerSuggestions({
  value,
  onChange,
  onKeyDown,
  placeholder,
  rows = 3,
  maxLength,
  disabled,
  autoFocus,
  className,
  id,
  'aria-label': ariaLabel,
  inputRef: externalInputRef,
}: ComposerSuggestionsProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = externalInputRef ?? internalRef
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  /** When set, dropdown is positioned at caret (fixed); when null, fallback below textarea */
  const [dropdownAtCaret, setDropdownAtCaret] = useState<{ top?: number; bottom?: number; left: number; above: boolean } | null>(null)
  const triggerRef = useRef<{ trigger: TriggerKind; query: string; startIndex: number } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const DROPDOWN_MAX_H = 280

  const triggerAtCursor = useMemo(
    () => getTriggerAtCursor(value, cursor),
    [value, cursor]
  )

  const syncCursor = useCallback(() => {
    const el = inputRef.current
    if (el) setCursor(el.selectionStart)
  }, [inputRef])

  const fetchSuggestions = useCallback(
    async (trigger: TriggerKind, query: string) => {
      if (trigger === '@') {
        const q = query.trim()
        if (!q) {
          setSuggestions([])
          return
        }
        setLoading(true)
        try {
          const { actors } = await searchActorsTypeahead(q, MAX_SUGGESTIONS)
          setSuggestions(
            (actors ?? []).map((a: AppBskyActorDefs.ProfileViewBasic) => ({
              type: 'user' as const,
              handle: a.handle ?? a.did,
              displayName: a.displayName,
              avatar: a.avatar,
            }))
          )
        } catch {
          setSuggestions([])
        } finally {
          setLoading(false)
        }
        return
      }
      if (trigger === '#') {
        const tag = query.trim().toLowerCase().replace(/\s+/g, '-')
        if (!tag) {
          setSuggestions([])
          return
        }
        setLoading(true)
        try {
          const { posts } = await searchPostsByTag(tag, undefined)
          const count = posts?.length ?? 0
          setSuggestions([{ type: 'tag' as const, tag, count }])
        } catch {
          setSuggestions([{ type: 'tag' as const, tag }])
        } finally {
          setLoading(false)
        }
        return
      }
      if (trigger === '%') {
        setLoading(true)
        try {
          const docs = await searchForumDocuments(query, MAX_SUGGESTIONS)
          setSuggestions(docs.map((doc) => ({ type: 'forum' as const, doc })))
        } catch {
          setSuggestions([])
        } finally {
          setLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (!triggerAtCursor) {
      triggerRef.current = null
      setOpen(false)
      setSuggestions([])
      return
    }
    triggerRef.current = triggerAtCursor
    const { trigger, query } = triggerAtCursor
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      fetchSuggestions(trigger, query).then(() => {
        setActiveIndex(0)
        setOpen(true)
      })
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [triggerAtCursor, fetchSuggestions])

  const insertSuggestion = useCallback(
    (s: Suggestion) => {
      const t = triggerRef.current
      if (!t || !inputRef.current) return
      const start = t.startIndex
      const end = start + 1 + t.query.length
      let insertion: string
      if (s.type === 'user') {
        insertion = `@${s.handle}`
      } else if (s.type === 'tag') {
        insertion = `#${s.tag}`
      } else {
        insertion = getStandardSiteDocumentUrl(s.doc)
      }
      const before = value.slice(0, start)
      const after = value.slice(end)
      const next = before + insertion + after
      onChange(maxLength != null ? next.slice(0, maxLength) : next)
      setOpen(false)
      setSuggestions([])
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        const pos = start + insertion.length
        inputRef.current?.setSelectionRange(pos, pos)
      })
    },
    [value, onChange, maxLength, inputRef]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (open && suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveIndex((i) => (i + 1) % suggestions.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          insertSuggestion(suggestions[activeIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setOpen(false)
          setSuggestions([])
          return
        }
      }
      onKeyDown?.(e)
    },
    [open, suggestions, activeIndex, insertSuggestion, onKeyDown]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value
      onChange(maxLength != null ? v.slice(0, maxLength) : v)
      setCursor(e.target.selectionStart)
    },
    [onChange, maxLength]
  )

  const handleSelect = useCallback(() => {
    syncCursor()
  }, [syncCursor])

  const handleBlur = useCallback(() => {
    setOpen(false)
    setSuggestions([])
  }, [])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex, open])

  const triggerStartIndex = triggerAtCursor?.startIndex ?? -1
  const showMirror = open && triggerStartIndex >= 0 && (suggestions.length > 0 || loading)

  useLayoutEffect(() => {
    if (!showMirror || !caretRef.current || !inputRef.current) {
      setDropdownAtCaret(null)
      return
    }
    const rect = caretRef.current.getBoundingClientRect()
    const spaceBelow = typeof window !== 'undefined' ? window.innerHeight - rect.bottom : 400
    const above = spaceBelow < DROPDOWN_MAX_H + 8 && rect.top > DROPDOWN_MAX_H + 8
    setDropdownAtCaret({
      left: rect.left,
      ...(above
        ? { bottom: typeof window !== 'undefined' ? window.innerHeight - rect.top + 4 : undefined }
        : { top: rect.bottom + 4 }),
      above,
    })
  }, [showMirror, value, triggerStartIndex, suggestions.length, loading])

  useEffect(() => {
    if (!open) setDropdownAtCaret(null)
  }, [open])

  const updateDropdownPosition = useCallback(() => {
    if (!showMirror || !caretRef.current) return
    const rect = caretRef.current.getBoundingClientRect()
    const spaceBelow = typeof window !== 'undefined' ? window.innerHeight - rect.bottom : 400
    const above = spaceBelow < DROPDOWN_MAX_H + 8 && rect.top > DROPDOWN_MAX_H + 8
    setDropdownAtCaret({
      left: rect.left,
      ...(above
        ? { bottom: typeof window !== 'undefined' ? window.innerHeight - rect.top + 4 : undefined }
        : { top: rect.bottom + 4 }),
      above,
    })
  }, [showMirror])

  useEffect(() => {
    if (!showMirror) return
    const el = inputRef.current
    if (!el) return
    const onScroll = () => updateDropdownPosition()
    const win = el.ownerDocument?.defaultView
    win?.addEventListener('scroll', onScroll, true)
    win?.addEventListener('resize', updateDropdownPosition)
    return () => {
      win?.removeEventListener('scroll', onScroll, true)
      win?.removeEventListener('resize', updateDropdownPosition)
    }
  }, [showMirror, updateDropdownPosition])

  return (
    <div ref={containerRef} className={styles.wrap}>
      {showMirror && (
        <div ref={mirrorRef} className={styles.mirror} aria-hidden>
          {value.slice(0, triggerStartIndex)}
          <span ref={caretRef} />
        </div>
      )}
      <textarea
        ref={inputRef}
        id={id}
        className={className ?? styles.textarea}
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        onBlur={handleBlur}
        onKeyUp={syncCursor}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
      />
      {open && (suggestions.length > 0 || loading) && (() => {
        const dropdownContent = (
          <div
            ref={dropdownRef}
            className={styles.dropdown}
            role="listbox"
            aria-label="Suggestions"
            style={
              dropdownAtCaret
                ? {
                    position: 'fixed',
                    left: dropdownAtCaret.left,
                    ...(dropdownAtCaret.above
                      ? { bottom: dropdownAtCaret.bottom, top: 'auto' }
                      : { top: dropdownAtCaret.top }),
                    right: 'auto',
                    width: 'max(200px, min(320px, 90vw))',
                    maxHeight: DROPDOWN_MAX_H,
                  }
                : undefined
            }
          >
            {loading && suggestions.length === 0 ? (
              <div className={styles.loading}>Searching…</div>
            ) : (
              <ul ref={listRef} className={styles.list}>
                {suggestions.map((s, i) => (
                  <li
                    key={
                      s.type === 'user'
                        ? s.handle
                        : s.type === 'tag'
                          ? s.tag
                          : s.doc.uri
                    }
                    className={i === activeIndex ? styles.itemActive : styles.item}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertSuggestion(s)
                    }}
                  >
                    {s.type === 'user' && (
                      <>
                        {s.avatar ? (
                          <img src={s.avatar} alt="" className={styles.avatar} />
                        ) : (
                          <span className={styles.avatarPlaceholder}>
                            {(s.displayName ?? s.handle).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className={styles.itemMain}>
                          <span className={styles.handle}>@{s.handle}</span>
                          {s.displayName && (
                            <span className={styles.meta}>{s.displayName}</span>
                          )}
                        </span>
                      </>
                    )}
                    {s.type === 'tag' && (
                      <span className={styles.itemMain}>
                        <span className={styles.tag}>#{s.tag}</span>
                        {s.count != null && s.count > 0 && (
                          <span className={styles.meta}>{s.count} posts</span>
                        )}
                      </span>
                    )}
                    {s.type === 'forum' && (
                      <span className={styles.itemMain}>
                        <span className={styles.forumTitle}>
                          {s.doc.title ?? s.doc.path ?? s.doc.uri}
                        </span>
                        {s.doc.authorHandle && (
                          <span className={styles.meta}>@{s.doc.authorHandle}</span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
        return dropdownAtCaret && typeof document !== 'undefined'
          ? createPortal(dropdownContent, document.body)
          : dropdownContent
      })()}
    </div>
  )
}
