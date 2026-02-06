import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchActorsTypeahead, getSuggestedFeeds } from '../lib/bsky'
import type { FeedSource } from '../types'
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api'
import styles from './SearchBar.module.css'

const DEBOUNCE_MS = 200

interface Props {
  onSelectFeed?: (source: FeedSource) => void
}

export default function SearchBar({ onSelectFeed }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actors, setActors] = useState<AppBskyActorDefs.ProfileViewBasic[]>([])
  const [suggestedFeeds, setSuggestedFeeds] = useState<AppBskyFeedDefs.GeneratorView[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = query.trim()
  const isHashtag = trimmed.startsWith('#')
  const tagSlug = isHashtag ? trimmed.slice(1).replace(/\s.*$/, '').toLowerCase() : ''
  const hashtagOption = isHashtag && tagSlug ? { type: 'tag' as const, tag: tagSlug } : null

  const fetchActors = useCallback(async (q: string) => {
    if (!q || q.startsWith('#')) {
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
  }, [])

  useEffect(() => {
    if (!trimmed || trimmed.startsWith('#')) {
      setActors([])
      return
    }
    const t = setTimeout(() => fetchActors(trimmed), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [trimmed, fetchActors])

  useEffect(() => {
    if (open && !trimmed) {
      getSuggestedFeeds(6).then((feeds) => setSuggestedFeeds(feeds ?? []))
    } else {
      setSuggestedFeeds([])
    }
  }, [open, trimmed])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const options: Array<
    | { type: 'actor'; handle: string; did: string; avatar?: string; displayName?: string }
    | { type: 'tag'; tag: string }
    | { type: 'feed'; view: AppBskyFeedDefs.GeneratorView }
  > = []
  if (hashtagOption) options.push(hashtagOption)
  actors.forEach((a) => options.push({ type: 'actor', handle: a.handle, did: a.did, avatar: a.avatar, displayName: a.displayName }))
  if (!trimmed && suggestedFeeds.length) suggestedFeeds.forEach((f) => options.push({ type: 'feed', view: f }))

  useEffect(() => {
    setActiveIndex(0)
  }, [query, actors.length, suggestedFeeds.length, hashtagOption])

  function handleSelect(index: number) {
    const opt = options[index]
    if (!opt) return
    setOpen(false)
    setQuery('')
    if (opt.type === 'tag') {
      navigate(`/tag/${encodeURIComponent(opt.tag)}`)
      inputRef.current?.blur()
    } else if (opt.type === 'actor') {
      navigate(`/profile/${encodeURIComponent(opt.handle)}`)
      inputRef.current?.blur()
    } else if (opt.type === 'feed' && onSelectFeed) {
      const v = opt.view
      onSelectFeed({ kind: 'custom', label: v.displayName ?? v.uri, uri: v.uri })
      inputRef.current?.blur()
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || options.length === 0) {
      if (e.key === 'Escape') setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelect(activeIndex)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.wrap} ref={containerRef}>
      <input
        ref={inputRef}
        type="search"
        placeholder="Search users, feeds, #hashtags…"
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
      {open && (options.length > 0 || loading) && (
        <div className={styles.dropdown} role="listbox">
          {loading && options.length === 0 && (
            <div className={styles.item}>Searching…</div>
          )}
          {options.map((opt, i) => {
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
                  {opt.avatar && <img src={opt.avatar} alt="" className={styles.itemAvatar} />}
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
                  {v.avatar && <img src={v.avatar} alt="" className={styles.itemAvatar} />}
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
