import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfileModal } from '../context/ProfileModalContext'
import { searchActorsTypeahead, getSuggestedFeeds, getProfileCached } from '../lib/bsky'
import type { FeedSource } from '../types'
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api'
import styles from './SearchBar.module.css'

const DEBOUNCE_MS = 200

/** Extract profile handle from pasted URL: bsky.app/profile/handle or ...?profile=handle (PurpleSky). */
function extractProfileHandleFromSearchQuery(text: string): string | null {
  const pathMatch = text.match(/\/profile\/([^/?\s#]+)/i)
  if (pathMatch) {
    try {
      return decodeURIComponent(pathMatch[1].trim())
    } catch {
      return pathMatch[1].trim()
    }
  }
  const paramMatch = text.match(/profile=([^&\s]+)/i)
  if (!paramMatch) return null
  try {
    return decodeURIComponent(paramMatch[1].trim())
  } catch {
    return paramMatch[1].trim()
  }
}

/** If pasted text contains a post link, extract post (full at-uri or handle+rkey). Handles ?post= (PurpleSky), /post/ path, and /profile/.../post/ (bsky.app). */
function extractPostFromSearchQuery(
  text: string
): { type: 'uri'; uri: string } | { type: 'handleRkey'; handle: string; rkey: string } | null {
  /* PurpleSky / any URL with post= query param (e.g. #/feed?post=at%3A%2F%2F...) */
  const fullUriParam = text.match(/[?&]post=(at%3A%2F%2F[^&\s]+)/i)
  if (fullUriParam) {
    try {
      const uri = decodeURIComponent(fullUriParam[1].trim())
      if (uri.startsWith('at://')) return { type: 'uri', uri }
    } catch {
      /* ignore */
    }
  }
  /* Path-based: /post/at%3A%2F%2F... or /profile/handle/post/rkey */
  if (/\/profile\//i.test(text) || /\/post\//i.test(text)) {
    const fullUriPath = text.match(/\/post\/(at%3A%2F%2F[^/?\s#]+)/i)
    if (fullUriPath) {
      try {
        const uri = decodeURIComponent(fullUriPath[1].trim())
        if (uri.startsWith('at://')) return { type: 'uri', uri }
      } catch {
        /* ignore */
      }
    }
    const profilePostMatch = text.match(/\/profile\/([^/]+)\/post\/([^/?\s#]+)/i)
    if (profilePostMatch) {
      try {
        const handle = decodeURIComponent(profilePostMatch[1].trim())
        const rkey = profilePostMatch[2].trim()
        if (handle && rkey) return { type: 'handleRkey', handle, rkey }
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

export type SearchFilter = 'all' | 'users' | 'feeds'

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h16M4 12h10M4 18h6" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

interface Props {
  onSelectFeed?: (source: FeedSource) => void
  /** Optional ref so parent can focus the search input (e.g. from bottom bar) */
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Compact height for desktop header */
  compact?: boolean
  /** Optional close callback (e.g. for mobile overlay) */
  onClose?: () => void
  /** Show suggestions dropdown above the input (e.g. mobile overlay) */
  suggestionsAbove?: boolean
  /** Sync input from URL / parent when it changes (e.g. mobile search modal top slot) */
  seedQuery?: string
  /** Omit filter control (narrow mobile slot) */
  hideFilter?: boolean
  /** Override placeholder when filter is hidden */
  placeholderOverride?: string
  /** 36px row to align with mobile float gear / notification glass circles */
  matchMobileFloatChrome?: boolean
}

export default function SearchBar({
  onSelectFeed,
  inputRef: externalInputRef,
  compact,
  onClose,
  suggestionsAbove,
  seedQuery,
  hideFilter,
  placeholderOverride,
  matchMobileFloatChrome,
}: Props) {
  const navigate = useNavigate()
  const { openProfileModal, openPostModal, openTagModal, openSearchModal } = useProfileModal()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SearchFilter>('all')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actors, setActors] = useState<AppBskyActorDefs.ProfileViewBasic[]>([])
  const [suggestedFeeds, setSuggestedFeeds] = useState<AppBskyFeedDefs.GeneratorView[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [resolvingPost, setResolvingPost] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const internalInputRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef ?? internalInputRef

  useEffect(() => {
    if (seedQuery !== undefined) setQuery(seedQuery)
  }, [seedQuery])

  const trimmed = query.trim()
  const isHashtag = trimmed.startsWith('#')
  const tagSlug = isHashtag ? trimmed.slice(1).replace(/\s.*$/, '').toLowerCase() : ''
  const hashtagOption = isHashtag && tagSlug && filter !== 'feeds' ? { type: 'tag' as const, tag: tagSlug } : null

  const postFromUrl = trimmed ? extractPostFromSearchQuery(trimmed) : null

  const fetchActors = useCallback(async (q: string) => {
    if (!q || q.startsWith('#') || filter === 'feeds') {
      setActors([])
      return
    }
    setLoading(true)
    try {
      const res = await searchActorsTypeahead(q, 8)
      setActors(res.actors ?? [])
    } catch {
      setActors([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    if (!trimmed || trimmed.startsWith('#') || filter === 'feeds') {
      setActors([])
      return
    }
    const t = setTimeout(() => fetchActors(trimmed), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [trimmed, filter, fetchActors])

  useEffect(() => {
    if (open && (filter === 'feeds' || filter === 'all') && trimmed) {
      getSuggestedFeeds(6).then((feeds) => setSuggestedFeeds(feeds ?? []))
    } else {
      setSuggestedFeeds([])
    }
  }, [open, trimmed, filter])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const profileFromUrl = trimmed ? extractProfileHandleFromSearchQuery(trimmed) : null

  const options: Array<
    | { type: 'postFromUrl'; post: { type: 'uri'; uri: string } | { type: 'handleRkey'; handle: string; rkey: string } }
    | { type: 'profileFromUrl'; handle: string }
    | { type: 'actor'; handle: string; did: string; avatar?: string; displayName?: string }
    | { type: 'tag'; tag: string }
    | { type: 'feed'; view: AppBskyFeedDefs.GeneratorView }
  > = []
  if (postFromUrl && filter !== 'feeds') options.push({ type: 'postFromUrl', post: postFromUrl })
  else if (profileFromUrl && filter !== 'feeds') options.push({ type: 'profileFromUrl', handle: profileFromUrl })
  if (hashtagOption) options.push(hashtagOption)
  if (filter !== 'feeds') actors.forEach((a) => options.push({ type: 'actor', handle: a.handle, did: a.did, avatar: a.avatar, displayName: a.displayName }))
  if ((filter === 'feeds' || filter === 'all') && (!trimmed && suggestedFeeds.length)) suggestedFeeds.forEach((f) => options.push({ type: 'feed', view: f }))

  useEffect(() => {
    setActiveIndex(-1)
  }, [query, actors.length, suggestedFeeds.length, hashtagOption, profileFromUrl, postFromUrl])

  async function openPostFromExtracted(
    post: { type: 'uri'; uri: string } | { type: 'handleRkey'; handle: string; rkey: string }
  ) {
    let uri: string
    if (post.type === 'uri') {
      uri = post.uri
    } else {
      setResolvingPost(true)
      try {
        const profile = await getProfileCached(post.handle, true)
        uri = `at://${profile.did}/app.bsky.feed.post/${post.rkey}`
      } catch {
        openProfileModal(post.handle)
        return
      } finally {
        setResolvingPost(false)
      }
    }
    openPostModal(uri)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
    onClose?.()
  }

  function handleSelect(index: number) {
    const opt = options[index]
    if (!opt) return
    setOpen(false)
    setQuery('')
    if (opt.type === 'postFromUrl') {
      openPostFromExtracted(opt.post)
    } else if (opt.type === 'profileFromUrl') {
      openProfileModal(opt.handle)
      inputRef.current?.blur()
      onClose?.()
    } else if (opt.type === 'tag') {
      openTagModal(opt.tag)
      inputRef.current?.blur()
      onClose?.()
    } else if (opt.type === 'actor') {
      openProfileModal(opt.handle)
      inputRef.current?.blur()
      onClose?.()
    } else if (opt.type === 'feed') {
      const v = opt.view
      const source: FeedSource = { kind: 'custom', label: v.displayName ?? v.uri, uri: v.uri }
      if (onSelectFeed) {
        onSelectFeed(source)
      } else {
        navigate('/feed', { state: { feedSource: source } })
      }
      inputRef.current?.blur()
      onClose?.()
    }
  }

  const placeholder =
    placeholderOverride ??
    (filter === 'users' ? 'Search users, #hashtags…' : filter === 'feeds' ? 'Browse feeds…' : 'Search users, feeds, #hashtags…')

  /** Treat as profile only when clearly a handle: pasted URL, or single token that starts with @ or contains a period (e.g. bsky.app, @user). Single words with no period = text/hashtag search. */
  const looksLikeHandle =
    trimmed.length > 0 &&
    !/\s/.test(trimmed) &&
    (trimmed.startsWith('@') || trimmed.includes('.'))

  function handleSubmit() {
    const post = extractPostFromSearchQuery(trimmed)
    if (post) {
      openPostFromExtracted(post)
      return
    }
    const profileHandle = extractProfileHandleFromSearchQuery(trimmed)
    if (profileHandle) {
      openProfileModal(profileHandle)
      setQuery('')
      setOpen(false)
      inputRef.current?.blur()
      onClose?.()
      return
    }
    if (looksLikeHandle) {
      openProfileModal(trimmed.replace(/^@/, ''))
      setQuery('')
      setOpen(false)
      inputRef.current?.blur()
      onClose?.()
      return
    }
    if (trimmed.length > 0) {
      openSearchModal(trimmed)
      if (seedQuery === undefined) setQuery('')
      setOpen(false)
      inputRef.current?.blur()
      onClose?.()
      return
    }
    if (open && options.length > 0 && activeIndex >= 0) {
      handleSelect(activeIndex)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      onClose?.()
      return
    }
    const isEnterOrCtrlE = e.key === 'Enter' || (e.key === 'e' && (e.ctrlKey || e.metaKey))
    if (isEnterOrCtrlE) {
      if (open && options.length > 0 && activeIndex >= 0) {
        e.preventDefault()
        handleSelect(activeIndex)
        return
      }
      e.preventDefault()
      handleSubmit()
      return
    }
    if (!open || options.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i < 0 ? 0 : (i + 1) % options.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1))
    }
  }

  return (
    <div
      className={`${styles.wrap} ${compact ? styles.compact : ''} ${suggestionsAbove ? styles.suggestionsAbove : ''} ${matchMobileFloatChrome ? styles.mobileFloatChrome : ''}`}
      ref={containerRef}
    >
      <div
        className={`${styles.searchRow} ${filterOpen ? styles.searchRowFilterOpen : ''} ${hideFilter ? styles.searchRowNoFilter : ''}`}
      >
        {!hideFilter && (
          <button
            type="button"
            className={`${styles.filterIconBtn} ${filterOpen ? styles.filterIconActive : ''}`}
            onClick={() => setFilterOpen((v) => !v)}
            aria-label="Search filter"
            aria-expanded={filterOpen}
          >
            <FilterIcon />
          </button>
        )}
        <input
          ref={(el) => {
            (internalInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
            if (externalInputRef) (externalInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
          }}
          type="search"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={styles.input}
          aria-label="Search"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
        />
        <button
          type="button"
          className={styles.searchSubmitBtn}
          onClick={handleSubmit}
          disabled={resolvingPost}
          aria-label="Search"
        >
          <SearchIcon />
        </button>
        {!hideFilter && filterOpen && (
          <div className={styles.filterDropdown}>
            {(['all', 'users', 'feeds'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={filter === f ? styles.filterActive : styles.filterBtn}
                onClick={() => {
                  setFilter(f)
                  setFilterOpen(false)
                }}
              >
                {f === 'all' ? 'All' : f === 'users' ? 'Users' : 'Feeds'}
              </button>
            ))}
          </div>
        )}
      </div>
      {open && (options.length > 0 || loading) && (
        <div className={styles.dropdown} role="listbox">
          {loading && options.length === 0 && (
            <div className={styles.item}>Searching…</div>
          )}
          {options.map((opt, i) => {
            if (opt.type === 'postFromUrl') {
              return (
                <button
                  key="post-from-url"
                  type="button"
                  role="option"
                  className={`${styles.item} ${i === activeIndex ? styles.itemActive : ''}`}
                  onClick={() => handleSelect(i)}
                  disabled={resolvingPost}
                >
                  <span className={styles.itemLabel}>{resolvingPost ? 'Opening post…' : 'Open post'}</span>
                </button>
              )
            }
            if (opt.type === 'profileFromUrl') {
              return (
                <button
                  key={`profile-${opt.handle}`}
                  type="button"
                  role="option"
                  className={`${styles.item} ${i === activeIndex ? styles.itemActive : ''}`}
                  onClick={() => handleSelect(i)}
                >
                  <span className={styles.itemLabel}>Open profile @{opt.handle}</span>
                </button>
              )
            }
            if (opt.type === 'tag') {
              return (
                <button
                  key={`tag-${opt.tag}`}
                  type="button"
                  role="option"
                  className={`${styles.item} ${i === activeIndex ? styles.itemActive : ''}`}
                  onClick={() => handleSelect(i)}
                >
                  <span className={styles.itemLabel}>Browse #{opt.tag}</span>
                </button>
              )
            }
            if (opt.type === 'actor') {
              return (
                <button
                  key={opt.did}
                  type="button"
                  role="option"
                  className={`${styles.item} ${i === activeIndex ? styles.itemActive : ''}`}
                  onClick={() => handleSelect(i)}
                >
                  {opt.avatar && <img src={opt.avatar} alt="" className={styles.itemAvatar} loading="lazy" />}
                  <span className={styles.itemLabel}>
                    {opt.displayName ? `${opt.displayName} ` : ''}@{opt.handle}
                  </span>
                </button>
              )
            }
            if (opt.type === 'feed') {
              const v = opt.view
              return (
                <button
                  key={v.uri}
                  type="button"
                  role="option"
                  className={`${styles.item} ${i === activeIndex ? styles.itemActive : ''}`}
                  onClick={() => handleSelect(i)}
                >
                  {v.avatar && <img src={v.avatar} alt="" className={styles.itemAvatar} loading="lazy" />}
                  <span className={styles.itemLabel}>{v.displayName ?? v.uri}</span>
                </button>
              )
            }
            return null
          })}
        </div>
      )}
    </div>
  )
}
