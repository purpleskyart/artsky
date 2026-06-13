import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppBskyActorDefs } from '@atproto/api'
import { getConvoAvailability } from '../lib/chat'
import { isAgentAuthenticated, searchActorsTypeahead } from '../lib/bsky'
import { useSession } from '../context/SessionContext'
import { resizedAvatarUrl } from '../lib/imageUtils'
import styles from './Layout.module.css'

const DEBOUNCE_MS = 250
const MAX_RESULTS = 12

interface MessagesNewChatPanelProps {
  currentAccountDid?: string
  onSelectUser: (did: string, handle: string) => void
}

type SearchResult = AppBskyActorDefs.ProfileViewBasic & { canMessage: boolean }

const MessagesNewChatPanel = memo(function MessagesNewChatPanel({
  currentAccountDid,
  onSelectUser,
}: MessagesNewChatPanelProps) {
  const { sessionVersion } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const term = query.trim().replace(/^@/, '')
    if (!term) {
      setResults([])
      setLoading(false)
      return
    }

    if (!isAgentAuthenticated()) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    let cancelled = false
    const timer = setTimeout(() => {
      searchActorsTypeahead(term, MAX_RESULTS)
        .then(async ({ actors }) => {
          if (cancelled) return
          const filtered = (actors ?? []).filter((actor) => actor.did !== currentAccountDid)
          const mapped = await Promise.all(
            filtered.map(async (actor) => {
              try {
                const { canChat } = await getConvoAvailability([actor.did])
                return { ...actor, canMessage: canChat }
              } catch {
                return { ...actor, canMessage: false }
              }
            })
          )
          if (cancelled) return
          mapped.sort((a, b) => {
            if (a.canMessage === b.canMessage) return 0
            return a.canMessage ? -1 : 1
          })
          setResults(mapped)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, currentAccountDid, sessionVersion])

  const trimmed = query.trim()
  const showEmpty = trimmed.length > 0 && !loading && results.length === 0

  const handleSelect = useCallback(
    (actor: SearchResult) => {
      if (!actor.canMessage) return
      const handle = actor.handle ?? actor.did
      onSelectUser(actor.did, handle)
    },
    [onSelectUser]
  )

  const resultItems = useMemo(
    () =>
      results.map((actor) => {
        const handle = actor.handle ?? actor.did
        const displayName = actor.displayName?.trim()
        const enabled = actor.canMessage
        return (
          <li key={actor.did}>
            <button
              type="button"
              className={`${styles.messagesNewChatItem}${enabled ? '' : ` ${styles.messagesNewChatItemDisabled}`}`}
              onClick={() => handleSelect(actor)}
              disabled={!enabled}
              aria-disabled={!enabled}
            >
              {actor.avatar ? (
                <img
                  src={resizedAvatarUrl(actor.avatar, 36)}
                  alt=""
                  className={styles.notificationAvatar}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className={styles.notificationAvatarPlaceholder} aria-hidden>
                  {handle.replace(/^@/, '').slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className={styles.messagesNewChatMeta}>
                {displayName && <span className={styles.messagesNewChatName}>{displayName}</span>}
                {enabled ? (
                  <span className={styles.messagesNewChatHandle}>@{handle.replace(/^@/, '')}</span>
                ) : (
                  <span className={styles.messagesNewChatCantMessage}>
                    @{handle.replace(/^@/, '')} can&apos;t be messaged
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      }),
    [results, handleSelect]
  )

  return (
    <div className={styles.messagesNewChatPanel}>
      <label className={styles.messagesNewChatSearchWrap}>
        <span className={styles.messagesNewChatSearchIcon} aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="search"
          className={styles.messagesNewChatSearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Search for someone to message"
        />
      </label>
      {loading ? (
        <p className={styles.notificationsLoading}>Loading…</p>
      ) : showEmpty ? (
        <p className={styles.notificationsEmpty}>No results</p>
      ) : trimmed.length === 0 ? (
        <p className={styles.notificationsEmpty}>Search for someone to message</p>
      ) : (
        <ul className={styles.messagesNewChatList}>{resultItems}</ul>
      )}
    </div>
  )
})

export default MessagesNewChatPanel
