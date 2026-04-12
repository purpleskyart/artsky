import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import * as bsky from '../lib/bsky'
import * as oauth from '../lib/oauth'
import type { AppBskyActorDefs } from '@atproto/api'
import styles from '../pages/LoginPage.module.css'

const BLUESKY_SIGNUP_URL = 'https://bsky.app'
const DEBOUNCE_MS = 250

/** Turn technical login/OAuth errors into messages users can understand. */
function toFriendlyLoginError(err: unknown): string {
  const raw =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : ''
  const lower = raw.toLowerCase()
  const isOAuthConfigFetchFailure =
    lower.includes('client-metadata') ||
    lower.includes('.well-known') ||
    lower.includes('oauth') ||
    lower.includes('authorization server')
      ? lower.includes('fetch') || lower.includes('network') || lower.includes('failed to fetch')
      : false
  if (isOAuthConfigFetchFailure) {
    return "Can't open Bluesky sign-in from this page. Open PurpleSky from the normal website and try again."
  }
  if (lower.includes('loopback') || lower.includes('path component') || lower.includes('client id')) {
    return "Sign-in with Bluesky isn't available from this page address. Try opening the app from its main URL (for local dev use http://localhost or http://127.0.0.1, not a LAN IP)."
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch')) {
    return 'Connection problem. Check your internet and try again.'
  }
  if (lower.includes('invalid') && (lower.includes('password') || lower.includes('credentials'))) {
    return "We couldn't verify your account. Check your Bluesky handle or email and try again."
  }
  if (lower.includes('invalid') || lower.includes('unauthorized')) {
    return "We couldn't verify your account. Check your handle and try again."
  }
  if (raw) return raw
  return 'Could not start sign-in. Check your handle and try again.'
}

export interface LoginCardProps {
  /** Called after successful login. */
  onSuccess?: () => void
  /** When provided, shows a close button in the top-left of the card (e.g. in modal). */
  onClose?: () => void
}

export default function LoginCard({ onSuccess, onClose }: LoginCardProps) {
  const [identifier, setIdentifier] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [suggestions, setSuggestions] = useState<AppBskyActorDefs.ProfileViewBasic[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null)

  const fetchSuggestions = useCallback(async (q: string) => {
    const term = q.trim().replace(/^@/, '')
    if (!term || term.length < 2) {
      setSuggestions([])
      return
    }
    setSuggestionsLoading(true)
    try {
      const res = await bsky.searchActorsTypeahead(term, 8)
      setSuggestions(res.actors ?? [])
      setActiveIndex(0)
    } catch {
      setSuggestions([])
    } finally {
      setSuggestionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (identifier.trim().replace(/^@/, '').length < 2) {
      setSuggestions([])
      setSuggestionsOpen(false)
      return
    }
    const t = setTimeout(() => fetchSuggestions(identifier), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [identifier, fetchSuggestions])

  useLayoutEffect(() => {
    if (!suggestionsOpen || !(suggestions.length > 0 || suggestionsLoading)) {
      setDropdownPosition(null)
      return
    }
    const el = wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const dropdownHeight = Math.min(280, window.innerHeight * 0.5) // max-height from CSS
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    
    // Position below if there's enough space, otherwise above
    let top: number
    if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
      top = rect.bottom + 2
    } else {
      top = rect.top - dropdownHeight - 2
      // Ensure it doesn't go above viewport
      if (top < 0) top = 8
    }
    
    setDropdownPosition({
      top,
      left: rect.left,
      width: rect.width,
    })
  }, [suggestionsOpen, suggestions.length, suggestionsLoading])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const id = identifier.trim().replace(/^@/, '')
    if (!id) return

    setLoading(true)
    try {
      await oauth.signInWithOAuthRedirect(id)
      onSuccess?.()
    } catch (err: unknown) {
      setError(toFriendlyLoginError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.card}>
      {onClose && (
        <button
          type="button"
          className={styles.cardCloseBtn}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      )}
      <div className={onClose ? styles.cardContentWithClose : undefined}>
      <h1 className={styles.title}>PurpleSky</h1>

      <form id="signin-panel" onSubmit={handleSignIn} className={styles.form} aria-label="Log in">
          <div ref={wrapperRef} className={styles.inputWrap}>
            <label htmlFor="login-identifier" className={styles.srOnly}>
              username.bsky.social or email
            </label>
            <input
              id="login-identifier"
              type="text"
              placeholder="username.bsky.social or email"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value)
                setSuggestionsOpen(true)
              }}
              onFocus={() => suggestions.length > 0 && setSuggestionsOpen(true)}
              onKeyDown={(e) => {
                if (!suggestionsOpen || suggestions.length === 0) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActiveIndex((i) => (i + 1) % suggestions.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
                } else if (e.key === 'Enter' && suggestions[activeIndex]) {
                  e.preventDefault()
                  const h = suggestions[activeIndex].handle
                  setIdentifier(h ?? '')
                  setSuggestionsOpen(false)
                } else if (e.key === 'Escape') {
                  setSuggestionsOpen(false)
                }
              }}
              className={styles.input}
              autoComplete="username"
              required
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          {dropdownPosition &&
            createPortal(
              <div
                className={styles.suggestionsPortal}
                style={{
                  position: 'fixed',
                  top: dropdownPosition.top,
                  left: dropdownPosition.left,
                  width: dropdownPosition.width,
                  zIndex: 1402,
                }}
              >
                <ul className={styles.suggestions} role="listbox">
                  {suggestionsLoading && suggestions.length === 0 ? (
                    <li className={styles.suggestion} role="option" aria-disabled>
                      <span className={styles.suggestionsLoading}>Searching…</span>
                    </li>
                  ) : (
                    suggestions.map((actor, i) => (
                      <li
                        key={actor.did}
                        role="option"
                        aria-selected={i === activeIndex}
                        className={i === activeIndex ? styles.suggestionActive : styles.suggestion}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setIdentifier(actor.handle ?? '')
                          setSuggestionsOpen(false)
                        }}
                      >
                        {actor.avatar && (
                          <img src={actor.avatar} alt="" className={styles.suggestionAvatar} loading="lazy" />
                        )}
                        <div className={styles.suggestionText}>
                          {actor.displayName && (
                            <span className={styles.suggestionDisplayName}>{actor.displayName}</span>
                          )}
                          <span className={styles.suggestionHandle}>@{actor.handle}</span>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </div>,
              document.body
            )}
          {error && <p id="login-error" className={styles.error} role="alert">{error}</p>}
          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? 'Logging in…' : 'Log in with Bluesky'}
          </button>
          <a
            href={BLUESKY_SIGNUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.signupLink}
          >
            Create account
          </a>
        </form>
      </div>
    </div>
  )
}
