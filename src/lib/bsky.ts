import { Agent, AtpAgent, RichText, type AtpSessionData } from '@atproto/api'
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api'
import { GUEST_FEED_ACCOUNTS } from '../config/guestFeed'
import * as oauth from './oauth'
import { requestDeduplicator } from './RequestDeduplicator'
import { responseCache } from './ResponseCache'
import { retryWithBackoff, shouldRetryIncluding429 } from './retryWithBackoff'
import { getApiErrorMessage, shouldRetryError } from './apiErrors'
import { rateLimiter, RateLimiter } from './RateLimiter'
import { apiRequestManager } from './apiRequestManager'
import { RequestPriority } from './RequestQueue'
import {
  invalidateAfterPostCreated,
  invalidateAfterPostDeleted,
  invalidateAfterPostLiked,
  invalidateAfterPostUnliked,
  invalidateAfterPostReposted,
  invalidateAfterFollowing,
  invalidateAfterUnfollowing,
  invalidateAfterBlocking,
  invalidateAfterUnblocking,
  invalidateAfterMuting,
  invalidateAfterUnmuting,
  invalidateAfterPreferencesUpdated,
} from './cacheInvalidation'

const BSKY_SERVICE = 'https://bsky.social'
/**
 * App View for unauthenticated reads (guest author feeds, profiles, search).
 * `public.api.bsky.app` often returns 403 on `app.bsky.feed.searchPosts`; `api.bsky.app` matches the main client and allows anonymous search/tag queries.
 */
const PUBLIC_BSKY = 'https://api.bsky.app'
const SESSION_KEY = 'artsky-bsky-session'
const ACCOUNTS_KEY = 'artsky-accounts'
const OAUTH_ACCOUNTS_KEY = 'artsky-oauth-accounts'
const OAUTH_TOKENS_KEY = 'artsky-oauth-tokens'

/** OAuth token data stored for re-authentication without IndexedDB */
interface OAuthTokenData {
  did: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

function getStoredOAuthTokens(): OAuthTokenData | null {
  try {
    const raw = localStorage.getItem(OAUTH_TOKENS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as OAuthTokenData
  } catch {
    return null
  }
}

function saveOAuthTokens(tokens: OAuthTokenData | null): void {
  try {
    if (tokens) {
      localStorage.setItem(OAUTH_TOKENS_KEY, JSON.stringify(tokens))
    } else {
      localStorage.removeItem(OAUTH_TOKENS_KEY)
    }
  } catch {
    // ignore
  }
}

/** Export for session restoration in SessionContext */
export { getStoredOAuthTokens }

/**
 * Build a complete AtpSessionData from stored OAuth tokens.
 * This enables creating a fully authenticated Agent without needing IndexedDB/OAuth library.
 */
export function buildSessionFromStoredTokens(did: string): AtpSessionData | null {
  const tokens = getStoredOAuthTokens()
  if (!tokens || tokens.did !== did) return null

  // Check if tokens are expired
  if (tokens.expiresAt < Date.now()) {
    // Tokens are expired - we should try to refresh, but that's handled by the OAuth library
    // For now, return null so we fall back to OAuth restore
    return null
  }

  const stored = getStoredSession()
  const handle = stored?.handle ?? ''

  // Build a complete AtpSessionData with the OAuth tokens
  return {
    did: tokens.did,
    handle,
    accessJwt: tokens.accessToken,
    refreshJwt: tokens.refreshToken,
    active: true,
  } as AtpSessionData
}

type AccountsStore = { activeDid: string | null; sessions: Record<string, AtpSessionData> }
type OAuthAccountsStore = { activeDid: string | null; dids: string[] }

function getAccounts(): AccountsStore {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (!raw) return { activeDid: null, sessions: {} }
    const parsed = JSON.parse(raw) as AccountsStore
    return { activeDid: parsed.activeDid ?? null, sessions: parsed.sessions ?? {} }
  } catch {
    return { activeDid: null, sessions: {} }
  }
}

function saveAccounts(accounts: AccountsStore) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {
    // ignore
  }
}

function getOAuthAccounts(): OAuthAccountsStore {
  try {
    const raw = localStorage.getItem(OAUTH_ACCOUNTS_KEY)
    if (!raw) return { activeDid: null, dids: [] }
    const parsed = JSON.parse(raw) as OAuthAccountsStore
    return { activeDid: parsed.activeDid ?? null, dids: Array.isArray(parsed.dids) ? parsed.dids : [] }
  } catch {
    return { activeDid: null, dids: [] }
  }
}

function saveOAuthAccounts(store: OAuthAccountsStore) {
  try {
    localStorage.setItem(OAUTH_ACCOUNTS_KEY, JSON.stringify(store))
  } catch {
    // ignore
  }
}

/** Register an OAuth DID (e.g. after callback) and optionally set as active. */
export function addOAuthDid(did: string, setActive = true): void {
  const store = getOAuthAccounts()
  if (!store.dids.includes(did)) store.dids = [...store.dids, did]
  if (setActive) store.activeDid = did
  saveOAuthAccounts(store)
}

/** Set which OAuth account is active (caller must then restore that session). */
export function setActiveOAuthDid(did: string | null): void {
  const store = getOAuthAccounts()
  store.activeDid = did
  saveOAuthAccounts(store)
}

const OAUTH_FAILURE_COUNT_KEY = 'artsky-oauth-failure-counts'
const MAX_OAUTH_FAILURES_BEFORE_REMOVAL = 20

/** Get the failure count for each OAuth DID */
export function getOAuthFailureCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(OAUTH_FAILURE_COUNT_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

/** Save failure counts to localStorage */
function saveOAuthFailureCounts(counts: Record<string, number>): void {
  try {
    localStorage.setItem(OAUTH_FAILURE_COUNT_KEY, JSON.stringify(counts))
  } catch {
    // ignore
  }
}

/** Increment failure count for a DID, return true if should be removed (exceeded max) */
export function incrementOAuthFailure(did: string): boolean {
  const counts = getOAuthFailureCounts()
  counts[did] = (counts[did] || 0) + 1
  saveOAuthFailureCounts(counts)
  return counts[did] >= MAX_OAUTH_FAILURES_BEFORE_REMOVAL
}

/** Reset failure count for a DID (on successful restore) */
export function resetOAuthFailure(did: string): void {
  const counts = getOAuthFailureCounts()
  delete counts[did]
  saveOAuthFailureCounts(counts)
}

/** Remove an OAuth DID from the list. */
export function removeOAuthDid(did: string): void {
  resetOAuthFailure(did)
  const store = getOAuthAccounts()
  store.dids = store.dids.filter((d) => d !== did)
  if (store.activeDid === did) store.activeDid = store.dids[0] ?? null
  saveOAuthAccounts(store)
}

export function getOAuthAccountsSnapshot(): OAuthAccountsStore {
  return getOAuthAccounts()
}

/** Active DID from persistence only (before the live agent is ready). */
export function getPersistedActiveDid(): string | null {
  const oauth = getOAuthAccounts()
  if (oauth.activeDid) return oauth.activeDid
  if (oauth.dids.length > 0) return oauth.dids[0]!
  const accounts = getAccounts()
  if (accounts.activeDid) return accounts.activeDid
  return getStoredSession()?.did ?? null
}

/** True if local persistence suggests a session may exist (OAuth or mirrored session data). Used to avoid guest UI flash before async restore. Must match every path in {@link getPersistedActiveDid} (incl. oauth.activeDid and accounts.activeDid). */
export function hasPersistedLoginHint(): boolean {
  return getPersistedActiveDid() != null
}

export function getStoredSession(): AtpSessionData | null {
  let accounts = getAccounts()
  if (!accounts.activeDid) {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) {
        const session = JSON.parse(raw) as AtpSessionData
        if (session?.did) {
          accounts = { activeDid: session.did, sessions: { [session.did]: session } }
          saveAccounts(accounts)
          return session
        }
        return session
      }
    } catch {
      // ignore
    }
    return null
  }
  return accounts.sessions[accounts.activeDid] ?? null
}

/** All stored sessions (for account switcher). Merges OAuth DIDs with mirrored session rows in localStorage (`artsky-accounts`). */
export function getSessionsList(): AtpSessionData[] {
  const oauth = getOAuthAccounts()
  const accounts = getAccounts()
  const byDid = new Map<string, AtpSessionData>()

  for (const did of oauth.dids) {
    byDid.set(did, { did } as AtpSessionData)
  }
  for (const sess of Object.values(accounts.sessions)) {
    if (sess?.did) {
      byDid.set(sess.did, sess)
    }
  }
  if (byDid.size === 0) {
    const single = getStoredSession()
    if (single) return [single]
    return []
  }
  return [...byDid.values()]
}

/** Switch active account to the given did via OAuth restore. */
export async function switchAccount(did: string): Promise<boolean> {
  const oauthAccounts = getOAuthAccounts()
  if (!oauthAccounts.dids.includes(did)) return false
  const session = await oauth.restoreOAuthSession(did)
  if (!session) {
    // Session can't be restored - remove this DID from the list
    removeOAuthDid(did)
    return false
  }
  try {
    const agent = new Agent(session)
    setOAuthAgent(agent, session)
    setActiveOAuthDid(did)
    invalidateSavedFeedsCache()
    return true
  } catch {
    removeOAuthDid(did)
    return false
  }
}

/**
 * Create a rate-limited fetch handler for a specific agent
 * Uses the new RateLimiter with per-agent tracking and Retry-After support
 */
function createRateLimitedFetch(agentId: string) {
  return async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const limitCheck = rateLimiter.checkRateLimit(agentId)
    if (!limitCheck.allowed) {
      const error = Object.assign(
        new Error(`Rate limited — backing off for ${Math.ceil(limitCheck.backoffMs / 1000)}s`),
        { status: 429 }
      )
      throw error
    }

    const response = await fetch(input, init)

    if (response.status === 429) {
      rateLimiter.handle429Response(agentId, response)
    }

    return response
  }
}

// Create separate fetch handlers for each agent
const credentialAgentFetch = createRateLimitedFetch('credential')

// Separate rate limiter for public requests with conservative limits
// Bluesky's public API (api.bsky.app) has stricter IP-based rate limits for unauthenticated requests
// Using 60 req/min for logged-out users - allows ~30 profile views/min (2 API calls each)
const publicRateLimiter = new RateLimiter({
  maxRequestsPerWindow: 60,
  windowMs: 60_000, // 1 minute
  defaultBackoffMs: 30_000, // 30 seconds
})

function createPublicRateLimitedFetch() {
  return async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const limitCheck = publicRateLimiter.checkRateLimit('public')
    if (!limitCheck.allowed) {
      const error = Object.assign(
        new Error(`Rate limited — backing off for ${Math.ceil(limitCheck.backoffMs / 1000)}s`),
        { status: 429 }
      )
      throw error
    }

    const response = await fetch(input, init)

    if (response.status === 429) {
      publicRateLimiter.handle429Response('public', response)
    }

    return response
  }
}

const publicAgentFetch = createPublicRateLimitedFetch()

/** Rate-limited fetch for authenticated requests. Use when creating OAuth/credential agents so all API calls are throttled. */
export function getCredentialRateLimitedFetch(): typeof credentialAgentFetch {
  return credentialAgentFetch
}

/** Base AtpAgent for the `agent` proxy when no OAuth session is active (guest reads). */
const credentialAgent = new AtpAgent({
  service: BSKY_SERVICE,
  fetch: credentialAgentFetch,
})

let oauthAgentInstance: Agent | null = null
let oauthSessionRef: { signOut(): Promise<void> } | null = null

/** Callback for session updates (e.g., when handle is fetched for external PDS accounts) */
let onSessionUpdatedCallback: (() => void) | null = null

/** Register a callback to be called when session data is updated */
export function onSessionUpdated(callback: (() => void) | null): void {
  onSessionUpdatedCallback = callback
}

/** Fetch handle for a DID using the agent. Needed for accounts on external PDSs. */
async function fetchHandleForDid(agent: Agent, did: string): Promise<string | null> {
  try {
    const profile = await agent.getProfile({ actor: did })
    return profile.data.handle ?? null
  } catch {
    return null
  }
}

/** Set the current OAuth session agent (from initOAuth). Pass null to fall back to the base agent (guest). */
export function setOAuthAgent(
  agent: Agent | null,
  session?: { signOut(): Promise<void>; did: string; accessToken?: string; refreshToken?: string; expiresAt?: number } | null
): void {
  oauthAgentInstance = agent
  oauthSessionRef = session ?? null
  // Mirror OAuth session to localStorage so PWA can restore after reopen when OAuth library storage (e.g. IndexedDB) was cleared
  if (agent) {
    const data = getSession()
    if (data?.did) {
      try {
        const accounts = getAccounts()
        accounts.sessions[data.did] = data
        accounts.activeDid = data.did
        saveAccounts(accounts)
        localStorage.setItem(SESSION_KEY, JSON.stringify(data))
        // Also store OAuth tokens for re-authentication without IndexedDB
        if (session?.accessToken && session?.refreshToken) {
          saveOAuthTokens({
            did: data.did,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAt: session.expiresAt ?? Date.now() + 2 * 60 * 60 * 1000, // Default 2 hours if not provided
          })
        }
        // Fetch handle for external PDS accounts (handle may not be in session data)
        if (!data.handle && agent.did === data.did) {
          void fetchHandleForDid(agent, data.did).then((handle) => {
            if (handle) {
              const updatedData = { ...data, handle } as AtpSessionData
              try {
                accounts.sessions[data.did] = updatedData
                saveAccounts(accounts)
                localStorage.setItem(SESSION_KEY, JSON.stringify(updatedData))
                // Notify React context that session data was updated
                onSessionUpdatedCallback?.()
              } catch {
                // ignore
              }
            }
          })
        }
      } catch {
        // ignore
      }
    }
  }
}

/** Current agent for API calls: OAuth session if set, otherwise the base unauthenticated AtpAgent. */
export function getAgent(): AtpAgent | Agent {
  return oauthAgentInstance ?? credentialAgent
}

/** Single agent reference that always delegates to getAgent() (OAuth vs guest base). */
export const agent = new Proxy(credentialAgent, {
  get(_, prop) {
    return (getAgent() as unknown as Record<string, unknown>)[prop as string]
  },
})

/** Agent for unauthenticated reads (profiles, author feeds). Use when no session. */
export const publicAgent = new AtpAgent({ service: PUBLIC_BSKY, fetch: publicAgentFetch })

/** Handles for the guest feed (from config). Re-exported for convenience. */
export const GUEST_FEED_HANDLES = GUEST_FEED_ACCOUNTS.map((a) => a.handle)

function mergeDedupeSortGuestItems(feedArrays: TimelineItem[][]): TimelineItem[] {
  const all = feedArrays.flat()
  const seen = new Set<string>()
  const deduped = all.filter((item) => {
    if (seen.has(item.post.uri)) return false
    seen.add(item.post.uri)
    return true
  })
  deduped.sort((a, b) => {
    const ta = new Date((a.post.record as { createdAt?: string })?.createdAt ?? 0).getTime()
    const tb = new Date((b.post.record as { createdAt?: string })?.createdAt ?? 0).getTime()
    return tb - ta
  })
  return deduped
}

async function fetchGuestAuthorBatch(
  actors: string[],
  perHandle: number,
): Promise<{ data: { feed: TimelineItem[] } }[]> {
  return Promise.all(
    actors.map((actor) => {
      const cacheKey = `guest:${actor}:${perHandle}`
      const cached = responseCache.get<{ data: { feed: TimelineItem[] } }>(cacheKey)
      if (cached) return cached
      return publicAgent
        .getAuthorFeed({ actor, limit: perHandle })
        .then((res) => {
          responseCache.set(cacheKey, res, 300_000, 300_000)
          return res
        })
        .catch(() => ({ data: { feed: [] } }))
    }),
  )
}

/**
 * Fetch and merge author feeds for guest (no login). Uses public API so it works when logged out.
 * cursor = offset as string.
 * First page (offset 0): fetch half the handles first; if the merged pool is enough, skip the rest so
 * we are not blocked by the slowest of many parallel requests. Deeper pages use one parallel batch.
 */
export async function getGuestFeed(
  limit: number,
  cursor?: string,
): Promise<{ feed: TimelineItem[]; cursor: string | undefined }> {
  const offset = cursor ? parseInt(cursor, 10) || 0 : 0
  const need = offset + limit
  const handles = GUEST_FEED_HANDLES

  let deduped: TimelineItem[]

  if (offset === 0 && handles.length >= 4) {
    const mid = Math.ceil(handles.length / 2)
    const wave1Handles = handles.slice(0, mid)
    const wave2Handles = handles.slice(mid)

    const per1 = Math.ceil(need / wave1Handles.length)
    const r1 = await fetchGuestAuthorBatch(wave1Handles, per1)
    const pool1 = mergeDedupeSortGuestItems(
      r1.map((res) => (res.data.feed || []) as TimelineItem[]),
    )

    if (pool1.length >= need || wave2Handles.length === 0) {
      deduped = pool1
    } else {
      const per2 = Math.ceil(need / wave2Handles.length)
      const r2 = await fetchGuestAuthorBatch(wave2Handles, per2)
      deduped = mergeDedupeSortGuestItems([
        ...r1.map((res) => (res.data.feed || []) as TimelineItem[]),
        ...r2.map((res) => (res.data.feed || []) as TimelineItem[]),
      ])
    }
  } else {
    const perHandle = Math.ceil(need / handles.length)
    const results = await fetchGuestAuthorBatch(handles, perHandle)
    deduped = mergeDedupeSortGuestItems(
      results.map((res) => (res.data.feed || []) as TimelineItem[]),
    )
  }

  const feed = deduped.slice(offset, offset + limit)
  /* Full page ⇒ allow another request with a larger perHandle (we only ever fetch the head of each author feed). Using deduped.length >= offset + limit was wrong: it suppressed pagination whenever the merged pool was short of offset+limit even though the next fetch could grow the pool. */
  const nextCursor = feed.length === limit ? String(offset + limit) : undefined
  return { feed, cursor: nextCursor }
}

/** Remove current account from the list. If another account exists, switch to it. Returns true if still logged in (switched to another). */
export async function logoutCurrentAccount(): Promise<boolean> {
  invalidateSavedFeedsCache()
  if (oauthAgentInstance && oauthSessionRef) {
    const currentDid = oauthAgentInstance.did
    try {
      await oauthSessionRef.signOut()
    } catch {
      // ignore
    }
    setOAuthAgent(null, null)
    if (currentDid) {
      removeOAuthDid(currentDid)
      // Also remove session from artsky-accounts localStorage
      const accounts = getAccounts()
      delete accounts.sessions[currentDid]
      if (accounts.activeDid === currentDid) {
        accounts.activeDid = null
      }
      saveAccounts(accounts)
    }
    const next = getOAuthAccounts()
    if (next.activeDid) {
      const session = await oauth.restoreOAuthSession(next.activeDid)
      if (session) {
        const agent = new Agent(session)
        setOAuthAgent(agent, session)
        return true
      }
    }
    return false
  }
  try {
    localStorage.removeItem(SESSION_KEY)
    saveAccounts({ activeDid: null, sessions: {} })
  } catch {
    // ignore
  }
  return false
}

export async function logout(userInitiated = false): Promise<void> {
  await logoutCurrentAccount(userInitiated)
}

export function getSession(): AtpSessionData | null {
  const a = getAgent()
  const atp = a as AtpAgent
  if (atp.session != null) return atp.session
  if (a.did) return { did: a.did } as AtpSessionData
  return null
}

/**
 * True when the live OAuth agent can call authenticated XRPC.
 * Do not infer this from localStorage — after a deploy or refresh, storage can be ahead of the agent.
 */
export function isAgentAuthenticated(): boolean {
  if (!oauthAgentInstance) return false
  try {
    return Boolean(getAgent().did)
  } catch {
    return false
  }
}

/**
 * Session object for React context: only non-null when the agent is actually authenticated.
 * Merges stored fields (e.g. handle) with the live agent when DIDs match.
 */
export function getSessionStateForReact(): AtpSessionData | null {
  if (!isAgentAuthenticated()) return null
  const live = getSession()
  if (!live?.did) return null
  const stored = getStoredSession()
  if (stored?.did === live.did) {
    return { ...stored, ...live } as AtpSessionData
  }
  return live as AtpSessionData
}

/** DID segment for feed/timeline caches so account switches never reuse another user's cached responses. */
function feedCacheAccountKey(): string {
  return getSession()?.did ?? 'guest'
}

export type TimelineResponse = Awaited<ReturnType<typeof agent.getTimeline>>
export type TimelineItem = TimelineResponse['data']['feed'][number]
export type PostView = TimelineItem['post']

/** NSFW/adult label values (self-labels or from labeler) that we treat as sensitive. */
const NSFW_LABEL_VALS = new Set(['porn', 'sexual', 'nudity', 'graphic-media'])

/**
 * Cache key for getProfileCached. Viewer-specific fields (e.g. viewer.following) must not be shared across accounts.
 */
function profileResponseCacheKey(actor: string, usePublic: boolean): string {
  if (usePublic) return `profile:${actor}:public`
  const sid = getSession()?.did
  if (!sid) return `profile:${actor}:public`
  return `profile:${actor}:${sid}`
}

/**
 * Cached profile fetcher with longer TTL (10 min + 5 min stale-while-revalidate)
 * Profiles rarely change, so we can cache them longer than feeds
 */
export async function getProfileCached(
  actor: string,
  usePublic = false
): Promise<{ handle?: string; displayName?: string; avatar?: string; did?: string; createdAt?: string; indexedAt?: string }> {
  const cacheKey = profileResponseCacheKey(actor, usePublic)
  const client = usePublic ? publicAgent : (getSession() ? agent : publicAgent)

  // Try to get from cache with revalidation support
  const cached = responseCache.get<{ handle?: string; displayName?: string; avatar?: string; did?: string; createdAt?: string; indexedAt?: string }>(
    cacheKey,
    () => client.getProfile({ actor }).then((p) => {
      const data = p.data as { handle?: string; displayName?: string; avatar?: string; did?: string; createdAt?: string; indexedAt?: string }
      return data
    })
  )

  if (cached) return cached

  // Deduplicate concurrent requests to prevent duplicate API calls
  const dedupeKey = `getProfileCached:${cacheKey}`
  return requestDeduplicator.dedupe(dedupeKey, async () => {
    // Double-check cache after getting the dedupe lock (another request may have filled it)
    const doubleCheck = responseCache.get<{ handle?: string; displayName?: string; avatar?: string; did?: string; createdAt?: string; indexedAt?: string }>(cacheKey)
    if (doubleCheck) return doubleCheck

    // Fetch and cache with 10 min TTL + 5 min stale-while-revalidate
    const profile = await client.getProfile({ actor })
    const data = profile.data as { handle?: string; displayName?: string; avatar?: string; did?: string; createdAt?: string; indexedAt?: string }
    responseCache.set(cacheKey, data, 600_000, 300_000)
    return data
  })
}

/**
 * Batch fetch posts using app.bsky.feed.getPosts (up to 25 posts per call)
 * More efficient than calling getPostThread individually for each post
 */
export async function getPostsBatch(uris: string[]): Promise<Map<string, PostView>> {
  if (uris.length === 0) return new Map()
  
  const result = new Map<string, PostView>()
  const client = getSession() ? agent : publicAgent
  
  // Split into batches of 25 (API limit)
  const batches: string[][] = []
  for (let i = 0; i < uris.length; i += 25) {
    batches.push(uris.slice(i, i + 25))
  }
  
  // Fetch all batches
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const res = await client.app.bsky.feed.getPosts({ uris: batch })
        const posts = (res.data.posts || []) as PostView[]
        for (const post of posts) {
          result.set(post.uri, post)
        }
      } catch (error) {
        console.warn('Failed to fetch post batch:', error)
      }
    })
  )
  
  return result
}
const PROFILE_CACHE_TTL_MS = 600_000   // 10 min (match getProfileCached)
const PROFILE_CACHE_STALE_MS = 300_000 // 5 min stale-while-revalidate

/**
 * Batch fetch profiles using app.bsky.actor.getProfiles (up to 25 profiles per call)
 * Uses responseCache so repeated calls for same DIDs (e.g. Layout, PostDetail) don't hit the API.
 *
 * @param actors - Array of actor identifiers (DIDs or handles)
 * @param usePublic - Whether to use public agent (default: false, uses authenticated agent if available)
 * @returns Map of actor identifier to profile data
 *
 * @example
 * const profiles = await getProfilesBatch(['did:plc:abc123', 'did:plc:xyz789'])
 * const profile1 = profiles.get('did:plc:abc123')
 * console.log(profile1?.displayName, profile1?.avatar)
 */
export async function getProfilesBatch(
  actors: string[],
  usePublic = false
): Promise<Map<string, { handle?: string; displayName?: string; avatar?: string; did?: string }>> {
  if (actors.length === 0) return new Map()

  const result = new Map<string, { handle?: string; displayName?: string; avatar?: string; did?: string }>()
  const client = usePublic ? publicAgent : (getSession() ? agent : publicAgent)

  // Fill from cache first to avoid API calls for recently fetched profiles
  const uncached: string[] = []
  for (const actor of actors) {
    const cacheKey = `profile:${actor}`
    const cached = responseCache.get<{ handle?: string; displayName?: string; avatar?: string; did?: string }>(cacheKey)
    if (cached) {
      result.set(actor, cached)
    } else {
      uncached.push(actor)
    }
  }

  if (uncached.length === 0) return result

  // Split uncached into batches of 25 (API limit)
  const batches: string[][] = []
  for (let i = 0; i < uncached.length; i += 25) {
    batches.push(uncached.slice(i, i + 25))
  }

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const res = await client.app.bsky.actor.getProfiles({ actors: batch })
        const profiles = (res.data.profiles || []) as Array<{ handle?: string; displayName?: string; avatar?: string; did?: string }>
        for (const profile of profiles) {
          const key = profile.did || profile.handle || ''
          const data = {
            handle: profile.handle,
            displayName: profile.displayName,
            avatar: profile.avatar,
            did: profile.did
          }
          result.set(key, data)
          responseCache.set(`profile:${key}`, data, PROFILE_CACHE_TTL_MS, PROFILE_CACHE_STALE_MS)
          if (profile.handle && profile.handle !== key) {
            responseCache.set(`profile:${profile.handle}`, data, PROFILE_CACHE_TTL_MS, PROFILE_CACHE_STALE_MS)
          }
        }
      } catch (error) {
        console.warn('Failed to fetch profile batch:', error)
      }
    })
  )

  return result
}

/** True if the post has NSFW/adult content labels (self-labels on record or labels on post view). */
export function isPostNsfw(post: PostView): boolean {
  const record = post.record as { labels?: { values?: { val: string }[] } } | undefined
  const selfLabels = record?.labels?.values
  if (selfLabels?.some((v) => NSFW_LABEL_VALS.has(v.val))) return true
  const viewLabels = (post as { labels?: { val: string }[] }).labels
  return !!viewLabels?.some((l) => NSFW_LABEL_VALS.has(l.val))
}

/** Entry for mixed feed: source identifier and percentage (0–100). */
export type FeedMixEntryInput = { source: { kind: 'timeline' | 'custom'; uri?: string }; percent: number }

/**
 * Fetch from multiple feeds and merge by percentage. Requires session.
 * Returns merged feed (sorted by createdAt desc, deduped) and cursors per feed for load more.
 */
export async function getMixedFeed(
  entries: FeedMixEntryInput[],
  limit: number,
  cursors?: Record<string, string>,
  signal?: AbortSignal
): Promise<{ feed: TimelineItem[]; cursors: Record<string, string> }> {
  const totalPercent = entries.reduce((s, e) => s + e.percent, 0)
  if (entries.length === 0 || totalPercent <= 0) {
    return { feed: [], cursors: {} }
  }
  const fetchLimit = limit

  /** Fetch one mix slice; run all entries in parallel so multi-feed mixes don't wait serially. */
  async function fetchMixEntry(entry: FeedMixEntryInput): Promise<{
    key: string
    feed: TimelineItem[]
    nextCursor: string | undefined
  }> {
    const key = entry.source.kind === 'timeline' ? 'timeline' : (entry.source.uri ?? '')
    const cursor = cursors?.[key]
    try {
      if (signal?.aborted) throw new Error('Request cancelled')

      if (entry.source.kind === 'timeline') {
        if (!getSession()) {
          return { key, feed: [] as TimelineItem[], nextCursor: undefined }
        }
        const cacheKey = `timeline:${feedCacheAccountKey()}:${fetchLimit}:${cursor ?? 'initial'}`
        const normalized = timelineFeedFromCache(responseCache.get<unknown>(cacheKey))
        if (normalized) {
          return { key, feed: normalized.feed, nextCursor: normalized.cursor }
        }
        const res = await requestDeduplicator.dedupe(
          cacheKey,
          () => retryWithBackoff(
            () => agent.getTimeline({ limit: fetchLimit, cursor }),
            { shouldRetry: shouldRetryError }
          )
        )
        const result = { feed: res.data?.feed ?? [], cursor: res.data?.cursor ?? undefined }
        responseCache.set(cacheKey, result, 300_000, 300_000)
        return { key, feed: result.feed, nextCursor: result.cursor }
      }
      if (entry.source.uri) {
        if (!getSession()) {
          return { key, feed: [] as TimelineItem[], nextCursor: undefined }
        }
        const cacheKey = `feed:${feedCacheAccountKey()}:${entry.source.uri}:${fetchLimit}:${cursor ?? 'initial'}`
        const normalized = timelineFeedFromCache(responseCache.get<unknown>(cacheKey))
        if (normalized) {
          return { key, feed: normalized.feed, nextCursor: normalized.cursor }
        }
        const res = await requestDeduplicator.dedupe(
          cacheKey,
          () => retryWithBackoff(
            () => agent.app.bsky.feed.getFeed({ feed: entry.source.uri!, limit: fetchLimit, cursor }),
            { shouldRetry: shouldRetryError }
          )
        )
        const result = { feed: res.data?.feed ?? [], cursor: res.data?.cursor }
        responseCache.set(cacheKey, result, 300_000, 300_000)
        return { key, feed: result.feed, nextCursor: result.cursor }
      }
    } catch (error) {
      console.warn(getApiErrorMessage(error, `load ${key} feed`))
    }
    return { key, feed: [] as TimelineItem[], nextCursor: undefined }
  }

  const results = await Promise.all(entries.map((entry) => fetchMixEntry(entry)))
  const takePerEntry = results.map((_, i) => {
    const pct = entries[i]?.percent ?? 0
    return Math.round((limit * pct) / totalPercent)
  })
  
  // Fetch acceptsInteractions for each feed source in the mix
  const feedAcceptsInfo = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.source.uri) return { uri: entry.source.uri, acceptsInteractions: undefined }
      try {
        const genRes = await getFeedGenerator(entry.source.uri)
        return { 
          uri: entry.source.uri, 
          acceptsInteractions: (genRes.data?.view as { acceptsInteractions?: boolean })?.acceptsInteractions 
        }
      } catch {
        return { uri: entry.source.uri, acceptsInteractions: undefined }
      }
    })
  )
  
  const acceptsMap = new Map(feedAcceptsInfo.map(info => [info.uri, info.acceptsInteractions]))
  
  type FeedSourceTag = { kind: string; label?: string; uri?: string; acceptsInteractions?: boolean }
  const combined: (TimelineItem & { _feedSource?: FeedSourceTag })[] = []
  const seen = new Set<string>()
  results.forEach((r, i) => {
    const take = takePerEntry[i] ?? 0
    const sourceTag = entries[i]?.source as FeedSourceTag | undefined
    const feed = r.feed ?? []
    // Add acceptsInteractions to the source tag
    const enrichedSourceTag = sourceTag && sourceTag.uri 
      ? { ...sourceTag, acceptsInteractions: acceptsMap.get(sourceTag.uri) }
      : sourceTag
    for (let j = 0; j < take && j < feed.length; j++) {
      const item = feed[j]
      if (item?.post?.uri && !seen.has(item.post.uri)) {
        seen.add(item.post.uri)
        combined.push(enrichedSourceTag ? { ...item, _feedSource: enrichedSourceTag } : item)
      }
    }
  })
  combined.sort((a, b) => {
    const ta = new Date((a.post.record as { createdAt?: string })?.createdAt ?? 0).getTime()
    const tb = new Date((b.post.record as { createdAt?: string })?.createdAt ?? 0).getTime()
    return tb - ta
  })
  const nextCursors: Record<string, string> = {}
  results.forEach((r) => {
    if (r.nextCursor) nextCursors[r.key] = r.nextCursor
  })
  return { feed: combined.slice(0, limit), cursors: nextCursors }
}

/** Cached + deduplicated getPostThread for fast repeat opens and low-bandwidth. */
export async function getPostThreadCached(
  uri: string,
  api: { app: { bsky: { feed: { getPostThread: (opts: { uri: string; depth: number; parentHeight?: number }) => Promise<{ data: { thread: unknown } }> } } } },
): Promise<{ data: { thread: unknown } }> {
  const { getCachedThread, setCachedThread, dedupeFetch, getThreadFetchEpoch } = await import('./postCache')
  const MAX_STALE_RETRIES = 6
  for (let attempt = 0; attempt < MAX_STALE_RETRIES; attempt++) {
    const cached = getCachedThread(uri)
    if (cached) {
      return { data: { thread: cached } }
    }
    const epochBefore = getThreadFetchEpoch(uri)
    const res = await dedupeFetch(uri, () =>
      retryWithBackoff(
        () => api.app.bsky.feed.getPostThread({ uri, depth: 10, parentHeight: 10 }),
        { shouldRetry: shouldRetryIncluding429, initialDelay: 3000, maxRetries: 2 },
      ),
    )
    if (getThreadFetchEpoch(uri) !== epochBefore) {
      continue
    }
    setCachedThread(uri, res.data.thread)
    return res
  }
  const res = await retryWithBackoff(
    () => api.app.bsky.feed.getPostThread({ uri, depth: 10, parentHeight: 10 }),
    { shouldRetry: shouldRetryIncluding429, initialDelay: 3000, maxRetries: 2 },
  )
  setCachedThread(uri, res.data.thread)
  return res
}

export type ThreadView = Awaited<ReturnType<typeof agent.getPostThread>>['data']['thread']

export type PostMediaInfo = {
  url: string
  type: 'image' | 'video'
  imageCount?: number
  videoPlaylist?: string
  /** When present, use for initial container aspect to avoid layout shift. */
  aspectRatio?: number
}

/**
 * Controls which image URL Bluesky embeds use.
 * - `full` (default): prefer `fullsize` — use in post detail, galleries, and anywhere you need max quality.
 * - `feed`: prefer `thumb` — smaller CDN assets for feed cards and list previews.
 */
export type PostMediaUrlOptions = {
  imageQuality?: 'feed' | 'full'
}

/** Post detail & thread media: prefer Bluesky `fullsize` URLs (default when `opts` omitted). */
export const POST_MEDIA_FULL: PostMediaUrlOptions = { imageQuality: 'full' }

/** Feed cards, quoted/parent preview cards: prefer `thumb` URLs. */
export const POST_MEDIA_FEED_PREVIEW: PostMediaUrlOptions = { imageQuality: 'feed' }

function embedImageUrl(
  img: { thumb?: string; fullsize?: string },
  opts: PostMediaUrlOptions | undefined,
): string {
  const preferThumb = opts?.imageQuality === 'feed'
  if (preferThumb) {
    return img.thumb ?? img.fullsize ?? ''
  }
  return img.fullsize ?? img.thumb ?? ''
}

/** Returns media info for a post: thumbnail/first image URL, type, and for video the playlist URL. */
export function getPostMediaInfo(post: PostView, opts?: PostMediaUrlOptions): PostMediaInfo | null {
  const embed = post.embed as
    | {
        $type?: string
        images?: { thumb: string; fullsize: string; aspectRatio?: { width: number; height: number } }[]
        thumbnail?: string
        playlist?: string
      }
    | undefined
  if (!embed) return null
  if (embed.$type === 'app.bsky.embed.images#view' && embed.images?.length) {
    const img = embed.images[0]
    const ar = img.aspectRatio && img.aspectRatio.width > 0 && img.aspectRatio.height > 0
      ? img.aspectRatio.width / img.aspectRatio.height
      : undefined
    return {
      url: embedImageUrl(img, opts),
      type: 'image',
      imageCount: embed.images.length,
      aspectRatio: ar,
    }
  }
  if (embed.$type === 'app.bsky.embed.video#view') {
    const thumb = embed.thumbnail ?? ''
    const playlist = embed.playlist ?? ''
    const aspectRatio = (embed as { aspectRatio?: { width: number; height: number } }).aspectRatio
    const ar = aspectRatio && aspectRatio.width > 0 && aspectRatio.height > 0
      ? aspectRatio.width / aspectRatio.height
      : undefined
    return { url: thumb, type: 'video', videoPlaylist: playlist || undefined, aspectRatio: ar }
  }
  // recordWithMedia: media can be in .media
  const media = (embed as {
    media?: {
      $type?: string
      images?: { fullsize?: string; thumb?: string; aspectRatio?: { width: number; height: number } }[]
      thumbnail?: string
      playlist?: string
    }
  }).media
  if (media?.$type === 'app.bsky.embed.images#view' && media.images?.length) {
    const img = media.images[0]
    const ar = img.aspectRatio && img.aspectRatio.width > 0 && img.aspectRatio.height > 0
      ? img.aspectRatio.width / img.aspectRatio.height
      : undefined
    return {
      url: embedImageUrl(img, opts),
      type: 'image',
      imageCount: media.images.length,
      aspectRatio: ar,
    }
  }
  if (media?.$type === 'app.bsky.embed.video#view') {
    const playlist = (media as { playlist?: string }).playlist
    const aspectRatio = (media as { aspectRatio?: { width: number; height: number } }).aspectRatio
    const ar = aspectRatio && aspectRatio.width > 0 && aspectRatio.height > 0
      ? aspectRatio.width / aspectRatio.height
      : undefined
    return {
      url: media.thumbnail ?? '',
      type: 'video',
      videoPlaylist: playlist,
      aspectRatio: ar,
    }
  }
  return null
}

/** Returns all media items in a post (all images + video if any) for gallery view. */
export function getPostAllMedia(
  post: PostView,
  opts?: PostMediaUrlOptions,
): Array<{ url: string; type: 'image' | 'video'; videoPlaylist?: string; aspectRatio?: number }> {
  const out: Array<{ url: string; type: 'image' | 'video'; videoPlaylist?: string; aspectRatio?: number }> = []
  const embed = post.embed as Record<string, unknown> | undefined
  if (!embed) return out
  const e = embed as {
    $type?: string
    images?: { thumb: string; fullsize: string; aspectRatio?: { width: number; height: number } }[]
    thumbnail?: string
    playlist?: string
    media?: { $type?: string; images?: { fullsize?: string; thumb?: string; aspectRatio?: { width: number; height: number } }[]; thumbnail?: string; playlist?: string }
  }
  if (e.$type === 'app.bsky.embed.images#view' && e.images?.length) {
    for (const img of e.images) {
      const ar = img.aspectRatio && img.aspectRatio.width > 0 && img.aspectRatio.height > 0
        ? img.aspectRatio.width / img.aspectRatio.height
        : undefined
      out.push({ url: embedImageUrl(img, opts), type: 'image', aspectRatio: ar })
    }
    return out
  }
  if (e.$type === 'app.bsky.embed.video#view') {
    const aspectRatio = (e as { aspectRatio?: { width: number; height: number } }).aspectRatio
    const ar = aspectRatio && aspectRatio.width > 0 && aspectRatio.height > 0
      ? aspectRatio.width / aspectRatio.height
      : undefined
    out.push({
      url: e.thumbnail ?? '',
      type: 'video',
      videoPlaylist: e.playlist ?? undefined,
      aspectRatio: ar,
    })
    return out
  }
  const media = e.media
  if (media?.$type === 'app.bsky.embed.images#view' && media.images?.length) {
    for (const img of media.images) {
      const ar = img.aspectRatio && img.aspectRatio.width > 0 && img.aspectRatio.height > 0
        ? img.aspectRatio.width / img.aspectRatio.height
        : undefined
      out.push({ url: embedImageUrl(img, opts), type: 'image', aspectRatio: ar })
    }
    return out
  }
  if (media?.$type === 'app.bsky.embed.video#view') {
    const aspectRatio = (media as { aspectRatio?: { width: number; height: number } }).aspectRatio
    const ar = aspectRatio && aspectRatio.width > 0 && aspectRatio.height > 0
      ? aspectRatio.width / aspectRatio.height
      : undefined
    out.push({
      url: media.thumbnail ?? '',
      type: 'video',
      videoPlaylist: media.playlist,
      aspectRatio: ar,
    })
  }
  return out
}

/**
 * Media for display: uses the post's own media, or for quote posts with no outer media, the quoted post's media.
 * Use for profile grid and cards so text-only quote posts show the quoted post's media.
 */
export function getPostMediaInfoForDisplay(post: PostView, opts?: PostMediaUrlOptions): PostMediaInfo | null {
  const info = getPostMediaInfo(post, opts)
  if (info) return info
  const quoted = getQuotedPostView(post)
  return quoted ? getPostMediaInfo(quoted, opts) : null
}

/** All media for display: same fallback as getPostMediaInfoForDisplay (quoted post's media when outer has none). */
export function getPostAllMediaForDisplay(
  post: PostView,
  opts?: PostMediaUrlOptions,
): Array<{ url: string; type: 'image' | 'video'; videoPlaylist?: string; aspectRatio?: number }> {
  const outer = getPostAllMedia(post, opts)
  if (outer.length) return outer
  const quoted = getQuotedPostView(post)
  return quoted ? getPostAllMedia(quoted, opts) : []
}

/** First media URL for display (e.g. thumb); uses quoted post's media when outer has none. */
export function getPostMediaUrlForDisplay(post: PostView, opts?: PostMediaUrlOptions): { url: string; type: 'image' | 'video' } | null {
  const info = getPostMediaInfoForDisplay(post, opts)
  return info ? { url: info.url, type: info.type } : null
}

/** External link from a post (link card). Handles app.bsky.embed.external#view and recordWithMedia with external media. */
export function getPostExternalLink(post: PostView): { uri: string; title: string; description: string; thumb?: string } | null {
  const embed = post.embed as {
    $type?: string
    uri?: string
    title?: string
    description?: string
    thumb?: string
    media?: { $type?: string; uri?: string; title?: string; description?: string; thumb?: string }
  } | undefined
  if (!embed) return null
  let ext: { uri: string; title: string; description: string; thumb?: string } | null = null
  if (embed.$type === 'app.bsky.embed.external#view' && embed.uri) {
    ext = {
      uri: embed.uri,
      title: embed.title?.trim() ?? '',
      description: embed.description ?? '',
      thumb: embed.thumb,
    }
  } else if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media?.$type === 'app.bsky.embed.external#view' && embed.media.uri) {
    const m = embed.media
    ext = {
      uri: m.uri ?? '',
      title: m.title?.trim() ?? '',
      description: m.description ?? '',
      thumb: m.thumb,
    }
  }
  if (!ext) return null
  let title = ext.title
  if (!title) {
    try {
      title = new URL(ext.uri).hostname.replace(/^www\./, '')
    } catch {
      title = ext.uri
    }
  }
  return { ...ext, title }
}

/** Quoted post view when the embed is app.bsky.embed.record#view or recordWithMedia#view; compatible with PostView for rendering. */
export type QuotedPostView = PostView

/**
 * Returns the quoted post from a post's embed when present (quote post).
 * Handles app.bsky.embed.record#view and app.bsky.embed.recordWithMedia#view.
 * Returns null if not a quote, or if the embedded record is blocked/not found.
 */
export function getQuotedPostView(post: PostView): QuotedPostView | null {
  const embed = post.embed as
    | {
        $type?: string
        record?: {
          $type?: string
          uri?: string
          author?: { did?: string; handle?: string; avatar?: string; displayName?: string }
          value?: { text?: string; createdAt?: string; facets?: unknown[] }
          embed?: unknown
        }
      }
    | undefined
  if (!embed) return null
  if (embed.$type !== 'app.bsky.embed.record#view' && embed.$type !== 'app.bsky.embed.recordWithMedia#view')
    return null
  const rec = embed.record as {
    $type?: string
    uri?: string
    cid?: string
    author?: { did?: string; handle?: string; avatar?: string; displayName?: string }
    value?: { text?: string; createdAt?: string; facets?: unknown[] }
    record?: { text?: string; createdAt?: string; facets?: unknown[] }
    embed?: unknown
    embeds?: unknown[]
  }
  if (!rec || !rec.uri || rec.$type === 'app.bsky.embed.record#blocked' || rec.$type === 'app.bsky.embed.record#notFound')
    return null
  const author = rec.author
  if (!author?.did) return null
  const recordContent = rec.value ?? (rec as { record?: { text?: string; createdAt?: string; facets?: unknown[] } }).record ?? { text: '', createdAt: new Date().toISOString() }
  return {
    uri: rec.uri,
    cid: rec.cid ?? '',
    author: { did: author.did, handle: author.handle ?? author.did, avatar: author.avatar, displayName: author.displayName },
    record: recordContent,
    embed: rec.embed ?? (rec.embeds?.[0] as unknown),
  } as QuotedPostView
}

/**
 * Parent post from a timeline/feed item's `reply` ref when the API returned a full PostView
 * (not blocked/not found). Use for reply card previews in grids and feeds.
 */
export function getReplyParentPostView(item: TimelineItem): PostView | null {
  const reply = (item as { reply?: { parent?: unknown } }).reply
  const parent = reply?.parent
  if (!parent || typeof parent !== 'object') return null
  const p = parent as Record<string, unknown>
  if (p.notFound === true || p.blocked === true) return null
  const t = p.$type
  if (t === 'app.bsky.feed.defs#notFoundPost' || t === 'app.bsky.feed.defs#blockedPost') return null
  const author = p.author as { did?: string } | undefined
  if (typeof p.uri !== 'string' || typeof p.cid !== 'string' || !author?.did) return null
  return parent as PostView
}

/** Typeahead search for actors (usernames). Uses public API when not logged in (e.g. login page). */
export async function searchActorsTypeahead(q: string, limit = 10) {
  const term = q.trim()
  if (!term) return { actors: [] }
  const api = getSession() ? agent : publicAgent
  const res = await api.app.bsky.actor.searchActorsTypeahead({ q: term, limit })
  return res.data
}

/** Get posts that quote a given post. Uses public API so it works logged in or out. */
export async function getQuotes(
  postUri: string,
  opts?: { limit?: number; cursor?: string }
): Promise<{ posts: PostView[]; cursor?: string }> {
  try {
    const limit = opts?.limit ?? 30
    const params = new URLSearchParams()
    params.set('uri', postUri)
    params.set('limit', String(limit))
    if (opts?.cursor) params.set('cursor', opts.cursor)
    
    const res = await retryWithBackoff(
      () => fetch(`${PUBLIC_BSKY}/xrpc/app.bsky.feed.getQuotes?${params.toString()}`),
      { shouldRetry: shouldRetryError }
    )
    
    if (!res.ok) {
      throw Object.assign(new Error('Failed to load quotes'), { status: res.status })
    }
    
    const data = (await res.json()) as { posts?: PostView[]; cursor?: string; message?: string }
    return { posts: data.posts ?? [], cursor: data.cursor }
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'load quotes'))
  }
}

/** Get suggested feeds for search dropdown. Uses public API when not logged in. */
export async function getSuggestedFeeds(limit = 8) {
  try {
    const api = getSession() ? agent : publicAgent
    const res = await api.app.bsky.feed.getSuggestedFeeds({ limit })
    return res.data.feeds
  } catch {
    return []
  }
}

/** Get feeds (feed generators) created by an actor. Uses public API so it works logged in or out. */
export type ActorFeedView = {
  uri: string
  displayName: string
  description?: string
  avatar?: string
  likeCount?: number
}

export async function getActorFeeds(actor: string, limit = 50): Promise<ActorFeedView[]> {
  try {
    const params = new URLSearchParams()
    params.set('actor', actor)
    params.set('limit', String(limit))
    
    const res = await retryWithBackoff(
      () => fetch(`${PUBLIC_BSKY}/xrpc/app.bsky.feed.getActorFeeds?${params.toString()}`),
      { shouldRetry: shouldRetryError }
    )
    
    if (!res.ok) {
      throw Object.assign(new Error('Failed to load feeds'), { status: res.status })
    }
    
    const data = (await res.json()) as { feeds?: ActorFeedView[]; message?: string }
    return data.feeds ?? []
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'load feeds'))
  }
}

const TAG_SEARCH_CACHE_TTL_MS = 300_000
const TAG_SEARCH_CACHE_STALE_MS = 300_000

/** Search posts by hashtag (tag without #). Uses agent when logged in (avoids public API CORS/failures), else public App View API. Cached 5 min. */
export async function searchPostsByTag(tag: string, cursor?: string, limit: number = 20) {
  const normalized = tag.replace(/^#/, '').trim()
  if (!normalized) return { posts: [], cursor: undefined as string | undefined }

  const cacheKey = `tagSearch:${normalized}:${cursor ?? ''}:${limit}`
  const cached = responseCache.get<{ posts: AppBskyFeedDefs.PostView[]; cursor: string | undefined }>(cacheKey)
  if (cached) return cached

  if (getSession()) {
    try {
      const res = await retryWithBackoff(
        () => agent.app.bsky.feed.searchPosts({
          q: normalized,
          tag: [normalized],
          limit,
          sort: 'latest',
          cursor,
        }),
        { shouldRetry: shouldRetryError }
      )
      const result = { posts: res.data.posts ?? [], cursor: res.data.cursor }
      responseCache.set(cacheKey, result, TAG_SEARCH_CACHE_TTL_MS, TAG_SEARCH_CACHE_STALE_MS)
      return result
    } catch (error) {
      // Log error but fall through to public App View (same as guests — works logged out)
      console.warn(getApiErrorMessage(error, 'search posts'))
    }
  }

  try {
    const res = await retryWithBackoff(
      () =>
        publicAgent.app.bsky.feed.searchPosts({
          q: normalized,
          tag: [normalized],
          limit,
          sort: 'latest',
          cursor,
        }),
      { shouldRetry: shouldRetryError }
    )
    const result = { posts: res.data.posts ?? [], cursor: res.data.cursor }
    responseCache.set(cacheKey, result, TAG_SEARCH_CACHE_TTL_MS, TAG_SEARCH_CACHE_STALE_MS)
    return result
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'load tag'))
  }
}

/** Search posts by full-text query (no tag filter). Uses agent when logged in (avoids public API CORS/failures), else public App View API. */
export async function searchPostsByQuery(q: string, cursor?: string) {
  const term = q.trim()
  if (!term) return { posts: [] as AppBskyFeedDefs.PostView[], cursor: undefined as string | undefined }

  if (getSession()) {
    try {
      const res = await retryWithBackoff(
        () => agent.app.bsky.feed.searchPosts({
          q: term,
          limit: 30,
          sort: 'latest',
          cursor,
        }),
        { shouldRetry: shouldRetryError }
      )
      return { posts: res.data.posts ?? [], cursor: res.data.cursor }
    } catch (error) {
      console.warn(getApiErrorMessage(error, 'search posts'))
    }
  }

  try {
    const res = await retryWithBackoff(
      () =>
        publicAgent.app.bsky.feed.searchPosts({
          q: term,
          limit: 30,
          sort: 'latest',
          cursor,
        }),
      { shouldRetry: shouldRetryError }
    )
    return { posts: res.data.posts ?? [], cursor: res.data.cursor }
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'search posts'))
  }
}

/** For multi-word phrase "hello world", derive tag variants: helloworld, hello-world. Returns merged, deduped posts (by uri) and cursor from phrase search for pagination. */
export async function searchPostsByPhraseAndTags(phrase: string, cursor?: string): Promise<{
  posts: AppBskyFeedDefs.PostView[]
  cursor: string | undefined
}> {
  const trimmed = phrase.trim()
  if (!trimmed) return { posts: [], cursor: undefined }

  // Only the phrase query is paginated. Tag searches use no cursor; merging them on every page would re-append the same posts.
  if (cursor) {
    return searchPostsByQuery(trimmed, cursor)
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  const tagNoSpace = words.join('').toLowerCase()
  const tagHyphen = words.join('-').toLowerCase()
  const tagSlugs = [...new Set([tagNoSpace, tagHyphen].filter(Boolean))]

  const [phraseResult, ...tagResults] = await Promise.all([
    searchPostsByQuery(trimmed, cursor),
    ...tagSlugs.map((tag) => searchPostsByTag(tag).then((r) => r.posts)),
  ])

  const byUri = new Map<string, AppBskyFeedDefs.PostView>()
  for (const p of phraseResult.posts ?? []) {
    if (p.uri) byUri.set(p.uri, p)
  }
  for (const posts of tagResults) {
    for (const p of posts ?? []) {
      if (p.uri && !byUri.has(p.uri)) byUri.set(p.uri, p)
    }
  }
  const merged = Array.from(byUri.values())
  const sortKey = (p: AppBskyFeedDefs.PostView) =>
    (p.record as { createdAt?: string })?.createdAt ?? p.indexedAt ?? ''
  merged.sort((a, b) => (sortKey(b) > sortKey(a) ? 1 : -1))

  return { posts: merged, cursor: phraseResult.cursor }
}

/** Parse an at:// URI into repo (DID), collection, and rkey. */
export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
  const trimmed = uri.trim()
  if (!trimmed.startsWith('at://')) return null
  const withoutScheme = trimmed.slice('at://'.length)
  const parts = withoutScheme.split('/')
  if (parts.length < 3) return null
  const [did, collection, ...rkeyParts] = parts
  const rkey = rkeyParts.join('/')
  return did && collection && rkey ? { did, collection, rkey } : null
}

/** Delete a feed post. Requires session; only the author can delete. */
export async function deletePost(uri: string): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const parsed = parseAtUri(uri)
  if (!parsed || parsed.collection !== 'app.bsky.feed.post') throw new Error('Invalid post URI')
  if (parsed.did !== session.did) throw new Error('You can only delete your own posts')
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did,
    collection: 'app.bsky.feed.post',
    rkey: parsed.rkey,
  })
}

/** Custom downvote collection: stored in user repo so it syncs across the AT Protocol. */
const DOWNVOTE_COLLECTION = 'app.purplesky.feed.downvote'

/** Create a downvote record for a post. Returns the new record URI. Requires session. */
export async function createDownvote(subjectUri: string, subjectCid: string): Promise<string> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const res = await agent.com.atproto.repo.createRecord({
    repo: session.did,
    collection: DOWNVOTE_COLLECTION,
    record: {
      $type: DOWNVOTE_COLLECTION,
      subject: { uri: subjectUri, cid: subjectCid },
      createdAt: new Date().toISOString(),
    },
  })
  return res.data.uri
}

/** Remove a downvote. Requires session. */
export async function deleteDownvote(downvoteRecordUri: string): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const parsed = parseAtUri(downvoteRecordUri)
  if (!parsed || parsed.collection !== DOWNVOTE_COLLECTION) throw new Error('Invalid downvote URI')
  if (parsed.did !== session.did) throw new Error('You can only remove your own downvotes')
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did,
    collection: DOWNVOTE_COLLECTION,
    rkey: parsed.rkey,
  })
}

/** List current user's downvotes: subject post URI -> downvote record URI. Requires session. */
export async function listMyDownvotes(): Promise<Record<string, string>> {
  const session = getSession()
  if (!session?.did) return {}
  const out: Record<string, string> = {}
  let cursor: string | undefined
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: DOWNVOTE_COLLECTION,
      limit: 100,
      cursor,
    })
    for (const r of res.data.records ?? []) {
      const value = r.value as { subject?: { uri?: string } }
      const subjectUri = value?.subject?.uri
      if (subjectUri && r.uri) out[subjectUri] = r.uri
    }
    cursor = res.data.cursor
  } while (cursor)
  return out
}

/** Block an account by DID. Requires session. Returns the block record URI. */
export async function blockAccount(did: string): Promise<{ uri: string }> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const result = await agent.app.bsky.graph.block.create(
    { repo: session.did },
    { subject: did, createdAt: new Date().toISOString() }
  )
  return { uri: result.uri }
}

/** Unblock an account by the block record URI. Requires session. */
export async function unblockAccount(blockUri: string): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const parsed = parseAtUri(blockUri)
  if (!parsed || parsed.collection !== 'app.bsky.graph.block') throw new Error('Invalid block URI')
  await agent.app.bsky.graph.block.delete({
    repo: session.did,
    rkey: parsed.rkey,
  })
}

/** Report a post (or record). Requires session. reasonType defaults to com.atproto.moderation.defs#reasonOther */
export async function reportPost(uri: string, cid: string, reasonType?: string): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  await agent.com.atproto.moderation.createReport({
    reasonType: reasonType ?? 'com.atproto.moderation.defs#reasonOther',
    subject: { $type: 'com.atproto.repo.strongRef', uri, cid },
  })
}

/** Mute a thread (root post URI). Requires session. */
export async function muteThread(rootUri: string): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  await agent.app.bsky.graph.muteThread({ root: rootUri })
}

/**
 * Send feed interaction feedback (e.g., "Show more like this" or "Show less like this").
 * Requires session. Used for custom feeds like For You that support user feedback.
 */
export async function sendFeedInteractions(
  interactions: Array<{ item: string; event: 'app.bsky.feed.defs#requestMore' | 'app.bsky.feed.defs#requestLess' }>,
  feedUri?: string,
): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  await agent.app.bsky.feed.sendInteractions({ interactions, ...(feedUri && { feed: feedUri }) })
}

/** List accounts the current user has blocked. Returns block record URI and profile info. Requires session. */
export async function listBlockedAccounts(): Promise<{ blockUri: string; did: string; handle?: string; displayName?: string; avatar?: string }[]> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const out: { blockUri: string; did: string; handle?: string; displayName?: string; avatar?: string }[] = []
  let cursor: string | undefined
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: 'app.bsky.graph.block',
      limit: 100,
      cursor,
    })
    for (const r of res.data.records ?? []) {
      const value = r.value as { subject?: string }
      const did = value?.subject
      if (did && r.uri) {
        out.push({ blockUri: r.uri, did })
      }
    }
    cursor = res.data.cursor
  } while (cursor)
  const dids = out.map((o) => o.did)
  const profilesMap = await getProfilesBatch(dids, false)
  out.forEach((o) => {
    const p = profilesMap.get(o.did)
    if (p) {
      o.handle = p.handle
      o.displayName = p.displayName
      o.avatar = p.avatar
    }
  })
  return out
}

/** List accounts the current user has muted. Requires session. */
export async function listMutedAccounts(): Promise<{ did: string; handle: string; displayName?: string; avatar?: string }[]> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const res = await agent.app.bsky.graph.getMutes({ limit: 100 })
  return (res.data.mutes ?? []).map((p) => ({
    did: p.did,
    handle: p.handle,
    displayName: p.displayName,
    avatar: p.avatar,
  }))
}

/** Unmute an account by DID. Requires session. */
export async function unmuteAccount(did: string): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  await agent.app.bsky.graph.unmuteActor({ actor: did })
}

/** Get muted words from preferences. Requires session. */
export async function getMutedWords(): Promise<{ id?: string; value: string; targets: string[]; actorTarget?: string; expiresAt?: string }[]> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const res = await agent.app.bsky.actor.getPreferences({})
  const prefs = res.data.preferences as { $type?: string; items?: { id?: string; value: string; targets?: string[]; actorTarget?: string; expiresAt?: string }[] }[]
  const muted = prefs.find((p) => p.$type === 'app.bsky.actor.defs#mutedWordsPref')
  const items = muted?.items ?? []
  return items.map((w) => ({
    id: w.id,
    value: w.value,
    targets: w.targets ?? [],
    actorTarget: w.actorTarget,
    expiresAt: w.expiresAt,
  }))
}

/** Update muted words in preferences (replace full list). Requires session. */
export async function putMutedWords(
  words: { id?: string; value: string; targets: string[]; actorTarget?: string; expiresAt?: string }[]
): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const res = await agent.app.bsky.actor.getPreferences({})
  const prefs = [...(res.data.preferences as object[])]
  const idx = prefs.findIndex((p) => (p as { $type?: string }).$type === 'app.bsky.actor.defs#mutedWordsPref')
  const newPref = {
    $type: 'app.bsky.actor.defs#mutedWordsPref',
    items: words.map((w) => ({
      ...(w.id ? { id: w.id } : {}),
      value: w.value,
      targets: w.targets?.length ? w.targets : (['content', 'tag'] as const),
      ...(w.actorTarget ? { actorTarget: w.actorTarget } : { actorTarget: 'all' as const }),
      ...(w.expiresAt ? { expiresAt: w.expiresAt } : {}),
    })),
  }
  if (idx >= 0) prefs[idx] = newPref
  else prefs.push(newPref)
  await agent.app.bsky.actor.putPreferences({ preferences: prefs as AppBskyActorDefs.Preferences })
}

/** Get DIDs (and handles) of accounts that the actor follows. */
export async function getFollows(
  client: AtpAgent,
  actor: string,
  opts?: { limit?: number; cursor?: string }
): Promise<{ dids: string[]; handles: Map<string, string>; cursor?: string }> {
  const res = await client.app.bsky.graph.getFollows({
    actor,
    limit: opts?.limit ?? 100,
    cursor: opts?.cursor,
  })
  const dids = (res.data.follows ?? []).map((f: { did: string; handle?: string }) => f.did)
  const handles = new Map<string, string>()
  for (const f of res.data.follows ?? []) {
    const sub = f as { did: string; handle?: string }
    if (sub.handle) handles.set(sub.did, sub.handle)
  }
  return { dids, handles, cursor: res.data.cursor }
}

/** Profile view for list display (followers/following). indexedAt when available (e.g. when they appeared in the list). */
export type ProfileViewBasic = { did: string; handle?: string; displayName?: string; avatar?: string; indexedAt?: string }

/** Get list of accounts that follow the actor (for profile followers modal). */
export async function getFollowers(
  client: AtpAgent,
  actor: string,
  opts?: { limit?: number; cursor?: string }
): Promise<{ list: ProfileViewBasic[]; cursor?: string }> {
  const res = await client.app.bsky.graph.getFollowers({
    actor,
    limit: opts?.limit ?? 50,
    cursor: opts?.cursor,
  })
  const list = (res.data.followers ?? []).map((f: { did: string; handle?: string; displayName?: string; avatar?: string; indexedAt?: string }) => ({
    did: f.did,
    handle: f.handle,
    displayName: f.displayName,
    avatar: f.avatar,
    indexedAt: f.indexedAt,
  }))
  return { list, cursor: res.data.cursor }
}

/** Get list of accounts that the actor follows (for profile following modal). */
export async function getFollowsList(
  client: AtpAgent,
  actor: string,
  opts?: { limit?: number; cursor?: string }
): Promise<{ list: ProfileViewBasic[]; cursor?: string }> {
  const res = await client.app.bsky.graph.getFollows({
    actor,
    limit: opts?.limit ?? 50,
    cursor: opts?.cursor,
  })
  const list = (res.data.follows ?? []).map((f: { did: string; handle?: string; displayName?: string; avatar?: string; indexedAt?: string }) => ({
    did: f.did,
    handle: f.handle,
    displayName: f.displayName,
    avatar: f.avatar,
    indexedAt: f.indexedAt,
  }))
  return { list, cursor: res.data.cursor }
}

/** Suggested accounts to follow (type only; heavy API implementation removed). */
export type SuggestedFollow = {
  did: string
  handle: string
  displayName?: string
  avatar?: string
  count: number
}

/** Detail for a suggested account (type only; heavy API implementation removed). */
export type SuggestedFollowDetail = {
  count: number
  followedBy: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>
  fromMutuals?: boolean
}

const SAVED_FEEDS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
/** In-flight dedupe so parallel callers (e.g. layout + mount) share one getPreferences. */
let savedFeedsPrefInFlight: Promise<{ id: string; type: string; value: string; pinned: boolean }[]> | null = null
let savedFeedsCache: { data: { id: string; type: string; value: string; pinned: boolean }[]; timestamp: number } | null = null

/** Get the current account's saved/pinned feeds from preferences. Returns array of { id, type, value, pinned }. */
export async function getSavedFeedsFromPreferences(): Promise<
  { id: string; type: string; value: string; pinned: boolean }[]
> {
  if (!getSession()?.did) return []

  // Check cache first
  if (savedFeedsCache && Date.now() - savedFeedsCache.timestamp < SAVED_FEEDS_CACHE_TTL) {
    return savedFeedsCache.data
  }

  if (savedFeedsPrefInFlight) return savedFeedsPrefInFlight

  savedFeedsPrefInFlight = (async () => {
    try {
      // Read same format we write: app.bsky.actor.getPreferences returns preferences array; saved feeds are in savedFeedsPrefV2
      const { data } = await agent.app.bsky.actor.getPreferences({})
      const prefs = (data?.preferences ?? []) as { $type?: string; items?: { id: string; type: string; value: string; pinned: boolean }[] }[]
      const v2Type = 'app.bsky.actor.defs#savedFeedsPrefV2'
      const existing = prefs.find((p) => p.$type === v2Type)
      const list = existing?.items ?? []

      savedFeedsCache = { data: list, timestamp: Date.now() }
      return list
    } catch {
      // 401 Unauthorized (logged out / expired) or other error: return empty so UI doesn't fire repeated requests
      savedFeedsCache = null
      return []
    } finally {
      savedFeedsPrefInFlight = null
    }
  })()

  return savedFeedsPrefInFlight
}

/** Parse a bsky.app profile feed URL into handle and feed slug. e.g. https://bsky.app/profile/foo.bsky.social/feed/for-you -> { handle: 'foo.bsky.social', feedSlug: 'for-you' } */
export function parseBskyFeedUrl(url: string): { handle: string; feedSlug: string } | null {
  const trimmed = url.trim()
  const m = trimmed.match(
    /^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/]+)\/feed\/([^/?#]+)/
  )
  if (!m) return null
  return { handle: decodeURIComponent(m[1]), feedSlug: decodeURIComponent(m[2]) }
}

/** Get feed generator info by URI. Returns the full response including acceptsInteractions. */
export async function getFeedGenerator(feedUri: string): Promise<Awaited<ReturnType<typeof agent.app.bsky.feed.getFeedGenerator>>> {
  const a = getSession() ? agent : publicAgent
  return await a.app.bsky.feed.getFeedGenerator({ feed: feedUri })
}

/** Resolve a bsky.app feed URL (or at:// URI) to a feed generator at:// URI. Throws if invalid. */
export async function resolveFeedUri(input: string): Promise<string> {
  const trimmed = input.trim()
  if (trimmed.startsWith('at://')) {
    const res = await agent.app.bsky.feed.getFeedGenerator({ feed: trimmed })
    if (res?.data?.view?.uri) return res.data.view.uri
    throw new Error('Invalid feed URI')
  }
  const parsed = parseBskyFeedUrl(trimmed)
  if (!parsed) throw new Error('Enter a feed URI (at://...) or a bsky.app feed URL')
  const profile = await publicAgent.getProfile({ actor: parsed.handle })
  const did = (profile.data as { did?: string }).did
  if (!did) throw new Error('Could not find that profile')
  const uri = `at://${did}/app.bsky.feed.generator/${parsed.feedSlug}`
  const res = await agent.app.bsky.feed.getFeedGenerator({ feed: uri })
  if (!res?.data?.view?.uri) throw new Error('Could not find that feed')
  return res.data.view.uri
}

/** Add a feed to the account's saved feeds (pinned). Persists via app.bsky.actor preferences. */
export async function addSavedFeed(uri: string): Promise<void> {
  const a = getAgent()
  try {
    if (typeof (a as { addSavedFeeds?: unknown }).addSavedFeeds === 'function') {
      await (a as { addSavedFeeds: (feeds: { type: string; value: string; pinned: boolean }[]) => Promise<unknown> }).addSavedFeeds([
        { type: 'feed', value: uri, pinned: true },
      ])
      invalidateSavedFeedsCache()
      return
    }
  } catch (_) {
    /* fall through to low-level implementation */
  }
  const { data } = await a.app.bsky.actor.getPreferences({})
  const prefs = (data?.preferences ?? []) as { $type?: string; items?: { id: string; type: string; value: string; pinned: boolean }[] }[]
  const v2Type = 'app.bsky.actor.defs#savedFeedsPrefV2'
  const existing = prefs.find((p) => p.$type === v2Type)
  const items = existing?.items ?? []
  if (items.some((f) => f.type === 'feed' && f.value === uri)) return
  const newFeed = {
    id: `artsky-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    type: 'feed' as const,
    value: uri,
    pinned: true,
  }
  const updated = prefs.filter((p) => p.$type !== v2Type)
  updated.push({ $type: v2Type, items: [...items, newFeed].sort((x, y) => (x.pinned === y.pinned ? 0 : x.pinned ? -1 : 1)) })
  await a.app.bsky.actor.putPreferences({ preferences: updated as AppBskyActorDefs.Preferences })
  invalidateSavedFeedsCache()
}

const feedNameCache = new Map<string, string>()

/** Get display names for multiple feed URIs in a single batch operation. */
export async function getFeedDisplayNamesBatch(uris: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const uncached: string[] = []
  
  // Check cache first
  for (const uri of uris) {
    const cached = feedNameCache.get(uri)
    if (cached) {
      result.set(uri, cached)
    } else {
      uncached.push(uri)
    }
  }
  
  // Fetch uncached with limited concurrency to avoid rate limits (batch size 4)
  const BATCH_SIZE = 4
  if (uncached.length > 0) {
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE)
      const fetched = await Promise.all(
        batch.map(async (uri) => {
          try {
            const res = await agent.app.bsky.feed.getFeedGenerator({ feed: uri })
            const name = (res.data?.view as { displayName?: string })?.displayName ?? uri
            feedNameCache.set(uri, name)
            return [uri, name] as const
          } catch {
            return [uri, uri] as const
          }
        })
      )
      fetched.forEach(([uri, name]) => result.set(uri, name))
    }
  }
  
  return result
}

/** Get display name for a feed URI. */
export async function getFeedDisplayName(uri: string): Promise<string> {
  const cached = feedNameCache.get(uri)
  if (cached) return cached
  const res = await agent.app.bsky.feed.getFeedGenerator({ feed: uri })
  const name = (res.data?.view as { displayName?: string })?.displayName ?? uri
  feedNameCache.set(uri, name)
  return name
}

/** Invalidate the saved feeds cache (call after modifying feeds). */
export function invalidateSavedFeedsCache(): void {
  savedFeedsCache = null
}

/** Get a shareable bsky.app URL for a feed (at://...). */
export async function getFeedShareUrl(uri: string): Promise<string> {
  if (!uri.startsWith('at://')) return uri
  const res = await publicAgent.app.bsky.feed.getFeedGenerator({ feed: uri })
  const view = res.data?.view as { creator?: { handle?: string }; uri?: string } | undefined
  const handle = view?.creator?.handle
  const slug = uri.replace(/^at:\/\/[^/]+\/app\.bsky\.feed\.generator\//, '')
  if (handle) return `https://bsky.app/profile/${encodeURIComponent(handle)}/feed/${encodeURIComponent(slug)}`
  return uri
}

/** Remove a feed from the account's saved feeds by its at:// URI. */
export async function removeSavedFeedByUri(uri: string): Promise<void> {
  const a = getAgent()
  const list = await getSavedFeedsFromPreferences()
  const item = list.find((f) => f.type === 'feed' && f.value === uri)
  if (!item) return
  if (typeof (a as { removeSavedFeeds?: unknown }).removeSavedFeeds === 'function') {
    await (a as { removeSavedFeeds: (ids: string[]) => Promise<unknown> }).removeSavedFeeds([item.id])
    invalidateSavedFeedsCache()
    return
  }
  const { data } = await a.app.bsky.actor.getPreferences({})
  const prefs = (data?.preferences ?? []) as { $type?: string; items?: { id: string; type: string; value: string; pinned: boolean }[] }[]
  const v2Type = 'app.bsky.actor.defs#savedFeedsPrefV2'
  const existing = prefs.find((p) => p.$type === v2Type)
  const items = (existing?.items ?? []).filter((f) => !(f.type === 'feed' && f.value === uri))
  const updated = prefs.filter((p) => p.$type !== v2Type)
  updated.push({ $type: v2Type, items })
  await a.app.bsky.actor.putPreferences({ preferences: updated as AppBskyActorDefs.Preferences })
  invalidateSavedFeedsCache()
}

const COMPOSE_IMAGE_MAX = 4
const COMPOSE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

/** Create a new post (no reply). Optional image files (max 4, jpeg/png/gif/webp). Optional alt text per image (max 1000 chars each). Optional labels for content warnings. */
export async function createPost(
  text: string,
  imageFiles?: File[],
  altTexts?: string[],
  mediaSensitive?: boolean,
): Promise<{ uri: string; cid: string }> {
  const t = text.trim()
  const images = (imageFiles ?? []).filter((f) => COMPOSE_IMAGE_TYPES.includes(f.type)).slice(0, COMPOSE_IMAGE_MAX)
  if (!t && images.length === 0) throw new Error('Post text or at least one image is required')
  let embed: { $type: 'app.bsky.embed.images'; images: { image: unknown; alt: string }[] } | undefined
  if (images.length > 0) {
    const alts = (altTexts ?? []).slice(0, images.length).map((a) => (a ?? '').trim().slice(0, 1000))
    const uploaded = await Promise.all(
      images.map(async (file, i) => {
        const { data } = await agent.uploadBlob(file, { encoding: file.type })
        return { image: data.blob, alt: alts[i] ?? '' }
      }),
    )
    embed = { $type: 'app.bsky.embed.images', images: uploaded }
  }
  const rt = new RichText({ text: t || '' })
  await rt.detectFacets(agent)
  const res = await agent.post({
    text: rt.text,
    facets: rt.facets,
    embed,
    createdAt: new Date().toISOString(),
    labels: mediaSensitive ? { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'graphic-media' }] } : undefined,
  })
  return { uri: res.uri, cid: res.cid }
}

/** Create a quote post: embeds the given post (uri/cid) with optional text and images. Optional labels for content warnings. */
export async function createQuotePost(
  quotedUri: string,
  quotedCid: string,
  text: string,
  imageFiles?: File[],
  altTexts?: string[],
  mediaSensitive?: boolean,
): Promise<{ uri: string; cid: string }> {
  const t = text.trim()
  const images = (imageFiles ?? []).filter((f) => COMPOSE_IMAGE_TYPES.includes(f.type)).slice(0, COMPOSE_IMAGE_MAX)
  if (!t && images.length === 0) throw new Error('Quote post needs text or at least one image')
  const recordEmbed = { $type: 'app.bsky.embed.record' as const, record: { uri: quotedUri, cid: quotedCid } }
  let embed: { $type: 'app.bsky.embed.record'; record: { uri: string; cid: string } } | { $type: 'app.bsky.embed.recordWithMedia'; record: { $type: 'app.bsky.embed.record'; record: { uri: string; cid: string } }; media: { $type: 'app.bsky.embed.images'; images: { image: unknown; alt: string }[] } }
  if (images.length > 0) {
    const alts = (altTexts ?? []).slice(0, images.length).map((a) => (a ?? '').trim().slice(0, 1000))
    const uploaded = await Promise.all(
      images.map(async (file, i) => {
        const { data } = await agent.uploadBlob(file, { encoding: file.type })
        return { image: data.blob, alt: alts[i] ?? '' }
      }),
    )
    embed = {
      $type: 'app.bsky.embed.recordWithMedia',
      record: recordEmbed,
      media: { $type: 'app.bsky.embed.images', images: uploaded },
    }
  } else {
    embed = recordEmbed
  }
  const rt = new RichText({ text: t || '' })
  await rt.detectFacets(agent)
  const res = await agent.post({
    text: rt.text,
    facets: rt.facets,
    embed,
    createdAt: new Date().toISOString(),
    labels: mediaSensitive ? { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'graphic-media' }] } : undefined,
  })
  return { uri: res.uri, cid: res.cid }
}

const NOTIFICATIONS_CACHE_TTL_MS = 60_000   // 1 min
const UNREAD_COUNT_CACHE_TTL_MS = 30_000   // 30 s

/** List notifications for the current account. Cached 1 min to avoid rate limits when opening panel repeatedly. */
export async function getNotifications(limit = 30, cursor?: string): Promise<{
  notifications: { uri: string; author: { handle?: string; did: string; avatar?: string; displayName?: string }; reason: string; reasonSubject?: string; isRead: boolean; indexedAt: string; replyPreview?: string }[]
  cursor?: string
}> {
  const cacheKey = `notifications:${limit}:${cursor ?? 'initial'}`
  type NotifResult = { notifications: { uri: string; author: { handle?: string; did: string; avatar?: string; displayName?: string }; reason: string; reasonSubject?: string; isRead: boolean; indexedAt: string; replyPreview?: string }[]; cursor?: string }
  const cached = responseCache.get<NotifResult>(cacheKey)
  if (cached) return cached

  const res = await agent.listNotifications({ limit, cursor })
  const notifications = (res.data.notifications || []).map((n) => {
    const record = (n as { record?: { text?: string } }).record
    const replyPreview = (n.reason === 'reply' || n.reason === 'quote') && record?.text
      ? record.text.slice(0, 120).replace(/\s+/g, ' ').trim() + (record.text.length > 120 ? '…' : '')
      : undefined
    return {
      uri: n.uri,
      author: n.author as { handle?: string; did: string; avatar?: string; displayName?: string },
      reason: n.reason,
      reasonSubject: (n as { reasonSubject?: string }).reasonSubject,
      isRead: n.isRead,
      indexedAt: n.indexedAt,
      replyPreview,
    }
  })
  const data = { notifications, cursor: res.data.cursor }
  responseCache.set(cacheKey, data, NOTIFICATIONS_CACHE_TTL_MS)
  return data
}

/** Get unread notification count. Cached 30 s to avoid rate limits on visibility change + initial load. */
export async function getUnreadNotificationCount(): Promise<number> {
  const cacheKey = 'unreadNotificationCount'
  const cached = responseCache.get<number>(cacheKey)
  if (cached !== null && cached !== undefined) return cached

  const res = await agent.countUnreadNotifications()
  const count = res.data.count ?? 0
  responseCache.set(cacheKey, count, UNREAD_COUNT_CACHE_TTL_MS)
  return count
}

/** Mark notifications as seen (read) up to the given time. Server uses this to clear unread count. Requires session. */
export async function updateSeenNotifications(seenAt?: string): Promise<void> {
  const ts = seenAt ?? new Date().toISOString()
  await agent.app.bsky.notification.updateSeen({ seenAt: ts })
  responseCache.invalidate('unreadNotificationCount')
}

/** List accounts the user receives activity notifications from (posts/replies). Requires session. */
export async function listActivitySubscriptions(): Promise<{ did: string }[]> {
  const res = await agent.app.bsky.notification.listActivitySubscriptions({ limit: 200 })
  const subs = (res.data as { subscriptions?: { did: string }[] }).subscriptions ?? []
  return subs.map((s) => ({ did: s.did }))
}

/** Subscribe or unsubscribe to activity notifications (posts, replies) for an account. Requires session. */
export async function putActivitySubscription(
  subjectDid: string,
  subscribe: boolean
): Promise<void> {
  await agent.app.bsky.notification.putActivitySubscription({
    subject: subjectDid,
    activitySubscription: { post: subscribe, reply: subscribe },
  })
}

/** Post a reply to a post. For top-level reply use same uri/cid for root and parent. Detects links/mentions/hashtags and stores facets so they render as clickable. */
export async function postReply(
  rootUri: string,
  rootCid: string,
  parentUri: string,
  parentCid: string,
  text: string
): Promise<{ uri: string; cid: string }> {
  const t = text.trim()
  if (!t) throw new Error('Comment text is required')
  const rt = new RichText({ text: t })
  await rt.detectFacets(agent)
  const res = await agent.post({
    text: rt.text,
    facets: rt.facets,
    createdAt: new Date().toISOString(),
    reply: {
      root: { uri: rootUri, cid: rootCid },
      parent: { uri: parentUri, cid: parentCid },
    },
  })
  return { uri: res.uri, cid: res.cid }
}


// ============================================================================
// API Request Lifecycle Management - New Functions
// ============================================================================

/**
 * Timeline/custom-feed cache entries may be either:
 * - Full Atp response from apiRequestManager: `{ data: { feed, cursor } }`
 * - Flat shape from getMixedFeed: `{ feed, cursor }`
 * Mis-reading the former as the latter drops feed + cursor on cache hit (empty page, "no more posts").
 */
function timelineFeedFromCache(cached: unknown): { feed: TimelineItem[]; cursor?: string } | null {
  if (cached == null || typeof cached !== 'object') return null
  const c = cached as { data?: { feed?: TimelineItem[]; cursor?: string }; feed?: TimelineItem[]; cursor?: string }
  const feed = c.data?.feed ?? c.feed
  const cursor = c.data?.cursor ?? c.cursor
  if (Array.isArray(feed)) return { feed, cursor }
  return null
}

/**
 * Get timeline feed with full lifecycle management
 */
export async function getTimelineWithLifecycle(
  limit: number = 30,
  cursor?: string
): Promise<Awaited<ReturnType<typeof agent.getTimeline>>> {
  if (!getSession()) {
    return { data: { feed: [], cursor: undefined } } as unknown as Awaited<ReturnType<typeof agent.getTimeline>>
  }
  const cacheKey = `timeline:${feedCacheAccountKey()}:${limit}:${cursor ?? 'initial'}`
  const normalized = timelineFeedFromCache(responseCache.get<unknown>(cacheKey))
  if (normalized) {
    return { data: { feed: normalized.feed, cursor: normalized.cursor } } as unknown as Awaited<
      ReturnType<typeof agent.getTimeline>
    >
  }
  const result = await apiRequestManager.execute(
    `timeline:${feedCacheAccountKey()}:${limit}:${cursor ?? 'initial'}`,
    () => agent.getTimeline({ limit, cursor }),
    { priority: RequestPriority.MEDIUM, ttl: 300_000, staleWhileRevalidate: 300_000, cacheKey, timeout: 30000 }
  )
  return result
}

/**
 * Get custom feed with full lifecycle management
 */
export async function getFeedWithLifecycle(
  feedUri: string,
  limit: number = 30,
  cursor?: string,
  feedSource?: { kind: string; label?: string; uri?: string; acceptsInteractions?: boolean }
): Promise<Awaited<ReturnType<typeof agent.app.bsky.feed.getFeed>>> {
  if (!getSession()) {
    return { data: { feed: [], cursor: undefined } } as unknown as Awaited<ReturnType<typeof agent.app.bsky.feed.getFeed>>
  }
  const cacheKey = `feed:${feedCacheAccountKey()}:${feedUri}:${limit}:${cursor ?? 'initial'}`
  const normalized = timelineFeedFromCache(responseCache.get<unknown>(cacheKey))
  if (normalized) {
    return { data: { feed: normalized.feed, cursor: normalized.cursor } } as unknown as Awaited<
      ReturnType<typeof agent.app.bsky.feed.getFeed>
    >
  }
  const result = await apiRequestManager.execute(
    `feed:${feedCacheAccountKey()}:${feedUri}:${limit}:${cursor ?? 'initial'}`,
    () => agent.app.bsky.feed.getFeed({ feed: feedUri, limit, cursor }),
    { priority: RequestPriority.MEDIUM, ttl: 300_000, staleWhileRevalidate: 300_000, cacheKey, timeout: 30000 }
  )
  // Attach feed source to items for single feed scenarios
  if (feedSource && result.data?.feed) {
    result.data.feed = result.data.feed.map(item => ({ ...item, _feedSource: feedSource }))
  }
  return result
}

/**
 * Get profile with full lifecycle management
 */
export async function getProfileWithLifecycle(
  actor: string
): Promise<Awaited<ReturnType<typeof agent.getProfile>>> {
  const cacheKey = `profile:${actor}`
  const cached = responseCache.get<{ data: any }>(cacheKey)
  if (cached) return cached.data
  const result = await apiRequestManager.execute(
    `profile:${actor}`,
    () => agent.getProfile({ actor }),
    { priority: RequestPriority.MEDIUM, ttl: 600_000, staleWhileRevalidate: 300_000, cacheKey, timeout: 30000 }
  )
  return result
}

/**
 * Get followers list with full lifecycle management
 */
export async function getFollowersWithLifecycle(
  actor: string,
  limit: number = 50,
  cursor?: string
): Promise<Awaited<ReturnType<typeof agent.app.bsky.graph.getFollowers>>> {
  const cacheKey = `followers:${actor}:${limit}:${cursor ?? 'initial'}`
  const cached = responseCache.get<{ followers: any[]; cursor?: string }>(cacheKey)
  if (cached) {
    return { data: { followers: cached.followers, cursor: cached.cursor } } as any
  }
  const result = await apiRequestManager.execute(
    `followers:${actor}:${limit}:${cursor ?? 'initial'}`,
    () => agent.app.bsky.graph.getFollowers({ actor, limit, cursor }),
    { priority: RequestPriority.LOW, ttl: 300_000, cacheKey, timeout: 30000 }
  )
  return result
}

/**
 * Get follows list with full lifecycle management
 */
export async function getFollowsWithLifecycle(
  actor: string,
  limit: number = 50,
  cursor?: string
): Promise<Awaited<ReturnType<typeof agent.app.bsky.graph.getFollows>>> {
  const cacheKey = `follows:${actor}:${limit}:${cursor ?? 'initial'}`
  const cached = responseCache.get<{ follows: any[]; cursor?: string }>(cacheKey)
  if (cached) {
    return { data: { follows: cached.follows, cursor: cached.cursor } } as any
  }
  const result = await apiRequestManager.execute(
    `follows:${actor}:${limit}:${cursor ?? 'initial'}`,
    () => agent.app.bsky.graph.getFollows({ actor, limit, cursor }),
    { priority: RequestPriority.LOW, ttl: 300_000, cacheKey, timeout: 30000 }
  )
  return result
}

/**
 * Get notifications with full lifecycle management
 */
export async function getNotificationsWithLifecycle(
  limit: number = 30,
  cursor?: string
): Promise<Awaited<ReturnType<typeof agent.listNotifications>>> {
  const cacheKey = `notifications:${limit}:${cursor ?? 'initial'}`
  const cached = responseCache.get<{ notifications: any[]; cursor?: string }>(cacheKey)
  if (cached) {
    return { data: { notifications: cached.notifications, cursor: cached.cursor } } as any
  }
  const result = await apiRequestManager.execute(
    `notifications:${limit}:${cursor ?? 'initial'}`,
    () => agent.listNotifications({ limit, cursor }),
    { priority: RequestPriority.HIGH, ttl: 60_000, cacheKey, timeout: 30000 }
  )
  return result
}

// ============================================================================
// WRITE OPERATIONS - With Cache Invalidation
// ============================================================================

/** Drop getPostThread cache for this post so modals refetch viewer state (likes, etc.). */
async function invalidatePostThreadCache(postUri: string): Promise<void> {
  const { invalidateThreadCache } = await import('./postCache')
  invalidateThreadCache(postUri)
}

/**
 * Like a post with cache invalidation. Returns the like record URI for optimistic UI.
 */
export async function likePostWithLifecycle(uri: string, cid: string): Promise<{ uri: string }> {
  const result = await apiRequestManager.execute(`like:${uri}`, () => agent.like(uri, cid), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => {
    invalidateAfterPostLiked()
    invalidatePostThreadCache(uri)
  }, 0)
  return result
}

/**
 * Unlike a post with cache invalidation.
 * @param subjectPostUri — post that was liked (AT URI); required to clear getPostThread cache for that post.
 */
export async function unlikePostWithLifecycle(likeUri: string, subjectPostUri?: string): Promise<void> {
  await apiRequestManager.execute(`unlike:${likeUri}`, () => agent.deleteLike(likeUri), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => {
    invalidateAfterPostUnliked()
    if (subjectPostUri) invalidatePostThreadCache(subjectPostUri)
  }, 0)
}

/**
 * Repost a post with cache invalidation. Returns the repost record URI for optimistic UI.
 */
export async function repostPostWithLifecycle(uri: string, cid: string): Promise<{ uri: string }> {
  const result = await apiRequestManager.execute(`repost:${uri}`, () => agent.repost(uri, cid), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => invalidateAfterPostReposted(), 0)
  return result
}

/**
 * Delete a repost with cache invalidation
 */
export async function deleteRepostWithLifecycle(repostUri: string): Promise<void> {
  await apiRequestManager.execute(`unrepost:${repostUri}`, () => agent.deleteRepost(repostUri), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => invalidateAfterPostReposted(), 0)
}

/**
 * Follow an account with cache invalidation. Returns the follow record URI for optimistic UI.
 */
export async function followAccountWithLifecycle(did: string): Promise<{ uri: string }> {
  const result = await apiRequestManager.execute(`follow:${did}`, () => agent.follow(did), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => invalidateAfterFollowing(), 0)
  return result
}

/**
 * Unfollow an account with cache invalidation
 */
export async function unfollowAccountWithLifecycle(followUri: string): Promise<void> {
  await apiRequestManager.execute(`unfollow:${followUri}`, () => agent.deleteFollow(followUri), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => invalidateAfterUnfollowing(), 0)
}

/**
 * Block an account with cache invalidation
 */
export async function blockAccountWithLifecycle(did: string): Promise<{ uri: string }> {
  const result = await apiRequestManager.execute(`block:${did}`, () => agent.app.bsky.graph.block.create({ repo: agent.did ?? '' }, { subject: did, createdAt: new Date().toISOString() }), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => invalidateAfterBlocking(), 0)
  return result
}

/**
 * Unblock an account with cache invalidation
 */
export async function unblockAccountWithLifecycle(blockUri: string): Promise<void> {
  await apiRequestManager.execute(`unblock:${blockUri}`, () => agent.app.bsky.graph.block.delete({ repo: agent.did ?? '', rkey: blockUri.split('/').pop() ?? '' }), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => invalidateAfterUnblocking(), 0)
}

/**
 * Mute an account with cache invalidation
 */
export async function muteAccountWithLifecycle(did: string): Promise<void> {
  await apiRequestManager.execute(`mute:${did}`, () => agent.app.bsky.graph.muteActor({ actor: did }), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => invalidateAfterMuting(), 0)
}

/**
 * Unmute an account with cache invalidation
 */
export async function unmuteAccountWithLifecycle(did: string): Promise<void> {
  await apiRequestManager.execute(`unmute:${did}`, () => agent.app.bsky.graph.unmuteActor({ actor: did }), { priority: RequestPriority.HIGH, timeout: 30000 })
  // Invalidate cache in background to avoid blocking UI
  setTimeout(() => invalidateAfterUnmuting(), 0)
}

/**
 * Create a post with cache invalidation
 */
export async function createPostWithLifecycle(text: string): Promise<{ uri: string; cid: string }> {
  const result = await apiRequestManager.execute(`createPost`, () => agent.post({ text, createdAt: new Date().toISOString() }), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterPostCreated()
  return result
}

/**
 * Delete a post with cache invalidation
 */
export async function deletePostWithLifecycle(uri: string): Promise<void> {
  const rkey = uri.split('/').pop() ?? ''
  await apiRequestManager.execute(`deletePost:${uri}`, () => agent.com.atproto.repo.deleteRecord({ repo: agent.did ?? '', collection: 'app.bsky.feed.post', rkey }), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterPostDeleted()
}

/**
 * Update muted words with cache invalidation
 */
export async function updateMutedWordsWithLifecycle(words: Array<{ id?: string; value: string; targets?: string[]; actorTarget?: string; expiresAt?: string }>): Promise<void> {
  await apiRequestManager.execute(`updateMutedWords`, () => agent.app.bsky.actor.putPreferences({ preferences: [{ $type: 'app.bsky.actor.defs#mutedWordsPref', items: words.map(w => ({ ...(w.id ? { id: w.id } : {}), value: w.value, targets: w.targets?.length ? w.targets : ['content', 'tag'], ...(w.actorTarget ? { actorTarget: w.actorTarget } : { actorTarget: 'all' }), ...(w.expiresAt ? { expiresAt: w.expiresAt } : {}) })) }] }), { priority: RequestPriority.MEDIUM, timeout: 30000 })
  invalidateAfterPreferencesUpdated()
}

/**
 * Add a saved feed with cache invalidation
 */
export async function addSavedFeedWithLifecycle(uri: string): Promise<void> {
  await apiRequestManager.execute(`addSavedFeed:${uri}`, () => agent.app.bsky.actor.putPreferences({ preferences: [{ $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [{ id: `artsky-${Date.now()}`, type: 'feed' as const, value: uri, pinned: true }] }] }), { priority: RequestPriority.MEDIUM, timeout: 30000 })
  invalidateAfterPreferencesUpdated()
}

/**
 * Remove a saved feed with cache invalidation
 */
export async function removeSavedFeedWithLifecycle(feedId: string): Promise<void> {
  await apiRequestManager.execute(`removeSavedFeed:${feedId}`, () => agent.app.bsky.actor.putPreferences({ preferences: [{ $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [] }] }), { priority: RequestPriority.MEDIUM, timeout: 30000 })
  invalidateAfterPreferencesUpdated()
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Cancel a pending request
 */
export function cancelRequest(key: string): void {
  apiRequestManager.cancel(key)
}

/**
 * Get current request metrics
 */
export function getRequestMetrics() {
  return apiRequestManager.getMetrics()
}

/**
 * Reset request metrics
 */
export function resetRequestMetrics(): void {
  apiRequestManager.resetMetrics()
}

/**
 * Invalidate cache entries matching pattern
 */
export function invalidateCache(pattern: string | RegExp): void {
  apiRequestManager.invalidateCache(pattern)
}
