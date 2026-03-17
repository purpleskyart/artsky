import { Agent, AtpAgent, RichText, type AtpSessionData, type AtpSessionEvent } from '@atproto/api'
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api'
import { GUEST_FEED_ACCOUNTS } from '../config/guestFeed'
import * as oauth from './oauth'
import { requestDeduplicator } from './RequestDeduplicator'
import { responseCache } from './ResponseCache'
import { retryWithBackoff, shouldRetryIncluding429 } from './retryWithBackoff'
import { getApiErrorMessage, shouldRetryError } from './apiErrors'
import { rateLimiter } from './RateLimiter'
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
/** Public AppView for unauthenticated reads (profiles, feeds). */
const PUBLIC_BSKY = 'https://public.api.bsky.app'
const SESSION_KEY = 'artsky-bsky-session'
const ACCOUNTS_KEY = 'artsky-accounts'
const OAUTH_ACCOUNTS_KEY = 'artsky-oauth-accounts'

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

/** Remove an OAuth DID from the list. */
export function removeOAuthDid(did: string): void {
  const store = getOAuthAccounts()
  store.dids = store.dids.filter((d) => d !== did)
  if (store.activeDid === did) store.activeDid = store.dids[0] ?? null
  saveOAuthAccounts(store)
}

/** Set which OAuth account is active (caller must then restore that session). */
export function setActiveOAuthDid(did: string | null): void {
  const store = getOAuthAccounts()
  store.activeDid = did
  saveOAuthAccounts(store)
}

export function getOAuthAccountsSnapshot(): OAuthAccountsStore {
  return getOAuthAccounts()
}

let sessionRetryTimer: ReturnType<typeof setTimeout> | null = null

function persistSession(_evt: AtpSessionEvent, session: AtpSessionData | undefined) {
  const accounts = getAccounts()
  if (session) {
    if (sessionRetryTimer) { clearTimeout(sessionRetryTimer); sessionRetryTimer = null }
    accounts.sessions[session.did] = session
    accounts.activeDid = session.did
    saveAccounts(accounts)
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      // ignore
    }
  } else {
    if (!sessionRetryTimer) {
      sessionRetryTimer = setTimeout(async () => {
        sessionRetryTimer = null
        try { await credentialAgent.resumeSession(getStoredSession()!) } catch { /* will retry via next API call */ }
      }, 30_000)
    }
  }
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

/** All stored sessions (for account switcher). OAuth: all OAuth DIDs. Credential: all app-password sessions. */
export function getSessionsList(): AtpSessionData[] {
  const oauth = getOAuthAccounts()
  if (oauth.dids.length > 0) {
    return oauth.dids.map((did) => ({ did } as AtpSessionData))
  }
  const accounts = getAccounts()
  if (Object.keys(accounts.sessions).length === 0) {
    const single = getStoredSession()
    if (single) return [single]
    return []
  }
  return Object.values(accounts.sessions)
}

/** Switch active account to the given did. OAuth: restore that DID's session (caller may need to use restoreOAuthSession). Credential: resume on agent. Returns false if did is OAuth (caller should restore OAuth session). */
export async function switchAccount(did: string): Promise<boolean> {
  const oauthAccounts = getOAuthAccounts()
  if (oauthAccounts.dids.includes(did)) {
    const session = await oauth.restoreOAuthSession(did)
    if (!session) return false
    try {
      const agent = new Agent(session)
      setOAuthAgent(agent, session)
      setActiveOAuthDid(did)
      return true
    } catch {
      return false
    }
  }
  const accounts = getAccounts()
  const session = accounts.sessions[did]
  if (!session?.accessJwt) return false
  try {
    setOAuthAgent(null, null)
    accounts.activeDid = did
    saveAccounts(accounts)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    await credentialAgent.resumeSession(session)
    return true
  } catch {
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
const publicAgentFetch = createRateLimitedFetch('public')

/** Rate-limited fetch for authenticated requests. Use when creating OAuth/credential agents so all API calls are throttled. */
export function getCredentialRateLimitedFetch(): typeof credentialAgentFetch {
  return credentialAgentFetch
}

const credentialAgent = new AtpAgent({
  service: BSKY_SERVICE,
  persistSession,
  fetch: credentialAgentFetch,
})

let oauthAgentInstance: Agent | null = null
let oauthSessionRef: { signOut(): Promise<void> } | null = null

/** Set the current OAuth session agent (from initOAuth). Pass null to use credential agent only. */
export function setOAuthAgent(agent: Agent | null, session?: { signOut(): Promise<void> } | null): void {
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
      } catch {
        // ignore
      }
    }
  }
}

/** Current agent for API calls: OAuth session if set, otherwise credential (app password) session. */
export function getAgent(): AtpAgent | Agent {
  return oauthAgentInstance ?? credentialAgent
}

/** Single agent reference that always delegates to getAgent() for OAuth/credential switching. */
export const agent = new Proxy(credentialAgent, {
  get(_, prop) {
    return (getAgent() as unknown as Record<string, unknown>)[prop as string]
  },
})

/** Agent for unauthenticated reads (profiles, author feeds). Use when no session. */
export const publicAgent = new AtpAgent({ service: PUBLIC_BSKY, fetch: publicAgentFetch })

/** Handles for the guest feed (from config). Re-exported for convenience. */
export const GUEST_FEED_HANDLES = GUEST_FEED_ACCOUNTS.map((a) => a.handle)

/** Fetch and merge author feeds for guest (no login). Uses public API so it works when logged out. cursor = offset as string. */
export async function getGuestFeed(
  limit: number,
  cursor?: string,
): Promise<{ feed: TimelineItem[]; cursor: string | undefined }> {
  const offset = cursor ? parseInt(cursor, 10) || 0 : 0
  const need = offset + limit
  // Only fetch as many posts as needed, not extra buffer
  const perHandle = Math.ceil(need / GUEST_FEED_HANDLES.length)
  const results = await Promise.all(
    GUEST_FEED_HANDLES.map((actor) => {
      const cacheKey = `guest:${actor}:${perHandle}`
      const cached = responseCache.get<{ data: { feed: TimelineItem[] } }>(cacheKey)
      if (cached) return cached
      return publicAgent.getAuthorFeed({ actor, limit: perHandle })
        .then((res) => { 
          // Guest feed: 5 min TTL + 5 min stale-while-revalidate
          responseCache.set(cacheKey, res, 300_000, 300_000); 
          return res 
        })
        .catch(() => ({ data: { feed: [] } }))
    }),
  )
  const all = results.flatMap((r) => (r.data.feed || []) as TimelineItem[])
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
  const feed = deduped.slice(offset, offset + limit)
  const nextCursor = deduped.length >= offset + limit ? String(offset + limit) : undefined
  return { feed, cursor: nextCursor }
}

export async function resumeSession(): Promise<boolean> {
  const session = getStoredSession()
  if (!session?.accessJwt) return false
  try {
    await credentialAgent.resumeSession(session)
    return true
  } catch (err) {
    const status = (err as { status?: number; statusCode?: number })?.status
      ?? (err as { status?: number; statusCode?: number })?.statusCode
    if (status === 401 || status === 400) {
      try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
    }
    return false
  }
}

export async function login(identifier: string, password: string) {
  setOAuthAgent(null, null)
  const res = await credentialAgent.login({ identifier, password })
  return res
}

export async function createAccount(opts: {
  email: string
  password: string
  handle: string
}) {
  const res = await credentialAgent.createAccount({
    email: opts.email.trim(),
    password: opts.password,
    handle: opts.handle.trim().toLowerCase().replace(/^@/, ''),
  })
  return res
}

/** Remove current account from the list. If another account exists, switch to it. Returns true if still logged in (switched to another). */
export async function logoutCurrentAccount(): Promise<boolean> {
  if (oauthAgentInstance && oauthSessionRef) {
    const currentDid = oauthAgentInstance.did
    try {
      await oauthSessionRef.signOut()
    } catch {
      // ignore
    }
    setOAuthAgent(null, null)
    if (currentDid) removeOAuthDid(currentDid)
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
  const accounts = getAccounts()
  if (accounts.activeDid) {
    delete accounts.sessions[accounts.activeDid]
    const remaining = Object.keys(accounts.sessions)
    accounts.activeDid = remaining[0] ?? null
    saveAccounts(accounts)
    if (accounts.activeDid) {
      const next = accounts.sessions[accounts.activeDid]
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(next))
        credentialAgent.resumeSession(next)
        return true
      } catch {
        return false
      }
    }
  }
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
  return false
}

export async function logout(): Promise<void> {
  await logoutCurrentAccount()
}

export function getSession(): AtpSessionData | null {
  const a = getAgent()
  const atp = a as AtpAgent
  if (atp.session != null) return atp.session
  if (a.did) return { did: a.did } as AtpSessionData
  return null
}

export type TimelineResponse = Awaited<ReturnType<typeof agent.getTimeline>>
export type TimelineItem = TimelineResponse['data']['feed'][number]
export type PostView = TimelineItem['post']

/** NSFW/adult label values (self-labels or from labeler) that we treat as sensitive. */
const NSFW_LABEL_VALS = new Set(['porn', 'sexual', 'nudity', 'graphic-media'])

/**
 * Cached profile fetcher with longer TTL (10 min + 5 min stale-while-revalidate)
 * Profiles rarely change, so we can cache them longer than feeds
 */
export async function getProfileCached(
  actor: string,
  usePublic = false
): Promise<{ handle?: string; displayName?: string; avatar?: string; did?: string; createdAt?: string; indexedAt?: string }> {
  const cacheKey = `profile:${actor}`
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
  
  // Fetch and cache with 10 min TTL + 5 min stale-while-revalidate
  const profile = await client.getProfile({ actor })
  const data = profile.data as { handle?: string; displayName?: string; avatar?: string; did?: string; createdAt?: string; indexedAt?: string }
  responseCache.set(cacheKey, data, 600_000, 300_000)
  return data
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
  const results: { key: string; feed: TimelineItem[]; nextCursor: string | undefined }[] = []
  for (const entry of entries) {
    const key = entry.source.kind === 'timeline' ? 'timeline' : (entry.source.uri ?? '')
    const cursor = cursors?.[key]
    try {
      if (signal?.aborted) throw new Error('Request cancelled')

      if (entry.source.kind === 'timeline') {
        if (!getSession()) {
          results.push({ key, feed: [] as TimelineItem[], nextCursor: undefined })
          continue
        }
        const cacheKey = `timeline:${fetchLimit}:${cursor ?? 'initial'}`
        const cached = responseCache.get<{ feed: TimelineItem[]; cursor?: string }>(cacheKey)
        if (cached) {
          results.push({ key, feed: cached.feed ?? [], nextCursor: cached.cursor })
          continue
        }
        const res = await requestDeduplicator.dedupe(
          cacheKey,
          () => retryWithBackoff(
            () => agent.getTimeline({ limit: fetchLimit, cursor }),
            { shouldRetry: shouldRetryError }
          )
        )
        const result = { feed: res.data?.feed ?? [], cursor: res.data?.cursor ?? undefined }
        // Feeds: 5 min TTL + 5 min stale-while-revalidate
        responseCache.set(cacheKey, result, 300_000, 300_000)
        results.push({ key, feed: result.feed, nextCursor: result.cursor })
        continue
      }
      if (entry.source.uri) {
        if (!getSession()) {
          results.push({ key, feed: [] as TimelineItem[], nextCursor: undefined })
          continue
        }
        const cacheKey = `feed:${entry.source.uri}:${fetchLimit}:${cursor ?? 'initial'}`
        const cached = responseCache.get<{ feed: TimelineItem[]; cursor?: string }>(cacheKey)
        if (cached) {
          results.push({ key, feed: cached.feed ?? [], nextCursor: cached.cursor })
          continue
        }
        const res = await requestDeduplicator.dedupe(
          cacheKey,
          () => retryWithBackoff(
            () => agent.app.bsky.feed.getFeed({ feed: entry.source.uri!, limit: fetchLimit, cursor }),
            { shouldRetry: shouldRetryError }
          )
        )
        const result = { feed: res.data?.feed ?? [], cursor: res.data?.cursor }
        // Custom feeds: 5 min TTL + 5 min stale-while-revalidate
        responseCache.set(cacheKey, result, 300_000, 300_000)
        results.push({ key, feed: result.feed, nextCursor: result.cursor })
        continue
      }
    } catch (error) {
      console.warn(getApiErrorMessage(error, `load ${key} feed`))
    }
    results.push({ key, feed: [] as TimelineItem[], nextCursor: undefined })
  }
  const takePerEntry = results.map((_, i) => {
    const pct = entries[i]?.percent ?? 0
    return Math.round((limit * pct) / totalPercent)
  })
  type FeedSourceTag = { kind: string; label?: string; uri?: string }
  const combined: (TimelineItem & { _feedSource?: FeedSourceTag })[] = []
  const seen = new Set<string>()
  results.forEach((r, i) => {
    const take = takePerEntry[i] ?? 0
    const sourceTag = entries[i]?.source as FeedSourceTag | undefined
    const feed = r.feed ?? []
    for (let j = 0; j < take && j < feed.length; j++) {
      const item = feed[j]
      if (item?.post?.uri && !seen.has(item.post.uri)) {
        seen.add(item.post.uri)
        combined.push(sourceTag ? { ...item, _feedSource: sourceTag } : item)
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
  api: { app: { bsky: { feed: { getPostThread: (opts: { uri: string; depth: number }) => Promise<{ data: { thread: unknown } }> } } } },
): Promise<{ data: { thread: unknown } }> {
  const { getCachedThread, setCachedThread, dedupeFetch } = await import('./postCache')
  const cached = getCachedThread(uri)
  if (cached) {
    return { data: { thread: cached } }
  }
  const res = await dedupeFetch(uri, () =>
    retryWithBackoff(
      () => api.app.bsky.feed.getPostThread({ uri, depth: 10 }),
      { shouldRetry: shouldRetryIncluding429, initialDelay: 3000, maxRetries: 2 },
    ),
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

/** Returns media info for a post: thumbnail/first image URL, type, and for video the playlist URL. */
export function getPostMediaInfo(post: PostView): PostMediaInfo | null {
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
      url: img.fullsize ?? img.thumb ?? '',
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
      url: img.fullsize ?? img.thumb ?? '',
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
export function getPostAllMedia(post: PostView): Array<{ url: string; type: 'image' | 'video'; videoPlaylist?: string; aspectRatio?: number }> {
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
      out.push({ url: img.fullsize ?? img.thumb ?? '', type: 'image', aspectRatio: ar })
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
      out.push({ url: img.fullsize ?? img.thumb ?? '', type: 'image', aspectRatio: ar })
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

/** @deprecated Use getPostMediaInfo. Returns first image or video thumbnail for card display. */
export function getPostMediaUrl(post: PostView): { url: string; type: 'image' | 'video' } | null {
  const info = getPostMediaInfo(post)
  return info ? { url: info.url, type: info.type } : null
}

/**
 * Media for display: uses the post's own media, or for quote posts with no outer media, the quoted post's media.
 * Use for profile grid and cards so text-only quote posts show the quoted post's media.
 */
export function getPostMediaInfoForDisplay(post: PostView): PostMediaInfo | null {
  const info = getPostMediaInfo(post)
  if (info) return info
  const quoted = getQuotedPostView(post)
  return quoted ? getPostMediaInfo(quoted) : null
}

/** All media for display: same fallback as getPostMediaInfoForDisplay (quoted post's media when outer has none). */
export function getPostAllMediaForDisplay(post: PostView): Array<{ url: string; type: 'image' | 'video'; videoPlaylist?: string; aspectRatio?: number }> {
  const outer = getPostAllMedia(post)
  if (outer.length) return outer
  const quoted = getQuotedPostView(post)
  return quoted ? getPostAllMedia(quoted) : []
}

/** First media URL for display (e.g. thumb); uses quoted post's media when outer has none. */
export function getPostMediaUrlForDisplay(post: PostView): { url: string; type: 'image' | 'video' } | null {
  const info = getPostMediaInfoForDisplay(post)
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

/** Get suggested feeds for search dropdown. */
export async function getSuggestedFeeds(limit = 8) {
  try {
    const res = await agent.app.bsky.feed.getSuggestedFeeds({ limit })
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
      // Log error but fall through to public API
      console.warn(getApiErrorMessage(error, 'search posts'))
    }
  }

  try {
    const params = new URLSearchParams()
    params.set('q', normalized)
    params.set('tag', normalized)
    params.set('limit', String(limit))
    params.set('sort', 'latest')
    if (cursor) params.set('cursor', cursor)
    
    const res = await retryWithBackoff(
      () => fetch(`${PUBLIC_BSKY}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`),
      { shouldRetry: shouldRetryError }
    )
    
    if (!res.ok) {
      throw Object.assign(new Error('Failed to load tag'), { status: res.status })
    }
    
    const data = (await res.json()) as { posts?: AppBskyFeedDefs.PostView[]; cursor?: string; message?: string }
    const result = { posts: data.posts ?? [], cursor: data.cursor }
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
      // Log error but fall through to public API
      console.warn(getApiErrorMessage(error, 'search posts'))
    }
  }

  try {
    const params = new URLSearchParams()
    params.set('q', term)
    params.set('limit', '30')
    params.set('sort', 'latest')
    if (cursor) params.set('cursor', cursor)
    
    const res = await retryWithBackoff(
      () => fetch(`${PUBLIC_BSKY}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`),
      { shouldRetry: shouldRetryError }
    )
    
    if (!res.ok) {
      throw Object.assign(new Error('Failed to search'), { status: res.status })
    }
    
    const data = (await res.json()) as { posts?: AppBskyFeedDefs.PostView[]; cursor?: string; message?: string }
    return { posts: data.posts ?? [], cursor: data.cursor }
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

/** standard.site lexicon: for blog posts only (postcards on home from blogs you follow, profile Blog tab). Not used for Forums; see app.artsky.forum lexicon. */
export const STANDARD_SITE_DOMAIN = 'standard.site'

/** Standard.site lexicon collection NSIDs (long-form blogs on AT Protocol). */
export const STANDARD_SITE_DOCUMENT_COLLECTION = 'site.standard.document'
export const STANDARD_SITE_PUBLICATION_COLLECTION = 'site.standard.publication'
/** Standard.site comment lexicon (comments on blog documents; interoperable with leaflet.pub etc.). */
export const STANDARD_SITE_COMMENT_COLLECTION = 'site.standard.comment'

/** Blob ref as returned from uploadBlob (CID reference). */
export type StandardSiteDocumentBlobRef = { $link: string }

/** A document record from the standard.site lexicon (metadata about a blog post). */
export type StandardSiteDocumentRecord = {
  path?: string
  title?: string
  body?: string
  createdAt?: string
  /** Optional media: array of { image: BlobRef, mimeType: string } for compatibility with uploadBlob shape. */
  media?: Array<{ image: StandardSiteDocumentBlobRef; mimeType?: string }>
  [k: string]: unknown
}

/** Document list item with author and optional base URL for building canonical link. */
export type StandardSiteDocumentView = {
  uri: string
  cid: string
  did: string
  rkey: string
  path: string
  title?: string
  body?: string
  createdAt?: string
  baseUrl?: string
  authorHandle?: string
  authorAvatar?: string
  /** Resolved media URLs for display (built from blob refs). */
  media?: Array<{ url: string; mimeType?: string }>
  /** Raw media refs from the record (for editing: preserve when saving). */
  mediaRefs?: Array<{ image: StandardSiteDocumentBlobRef; mimeType?: string }>
}

/** List site.standard.document records from a repo. Stubbed: no API requests (standard site documents removed from app). */
export async function listStandardSiteDocuments(
  _client: AtpAgent,
  _repo: string,
  _opts?: { limit?: number; cursor?: string; reverse?: boolean }
): Promise<{ records: { uri: string; cid: string; value: StandardSiteDocumentRecord }[]; cursor?: string }> {
  return { records: [], cursor: undefined }
}

/** Get the base URL of a publication from a repo. Stubbed: no API requests (standard site documents removed from app). */
export async function getStandardSitePublicationBaseUrl(_client: AtpAgent, _repo: string): Promise<string | null> {
  return null
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

/** Fetch a single standard.site document by URI. Stubbed: no API requests (standard site documents removed from app). */
export async function getStandardSiteDocument(_uri: string): Promise<StandardSiteDocumentView | null> {
  return null
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

/** Delete a standard.site document. Stubbed: no API requests (standard site documents removed from app). */
export async function deleteStandardSiteDocument(_uri: string): Promise<void> {
  throw new Error('Standard site documents are not available')
}

/** Custom downvote collection: stored in user repo so it syncs across the AT Protocol. */
const DOWNVOTE_COLLECTION = 'app.artsky.feed.downvote'

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

/** Upload a blob for use in a standard.site document. Stubbed: no API requests (standard site documents removed from app). */
export async function uploadStandardSiteDocumentBlob(_file: File): Promise<{ image: StandardSiteDocumentBlobRef; mimeType: string }> {
  throw new Error('Standard site documents are not available')
}

/** Update a standard.site document. Stubbed: no API requests (standard site documents removed from app). */
export async function updateStandardSiteDocument(
  _uri: string,
  _updates: { title?: string; body?: string; media?: Array<{ image: StandardSiteDocumentBlobRef; mimeType?: string }> }
): Promise<StandardSiteDocumentView> {
  throw new Error('Standard site documents are not available')
}

/** Standard.site comment record (comments on documents; interoperable with leaflet.pub etc.). */
export type StandardSiteCommentRecord = {
  subject: string // AT-URI of the document
  /** Optional AT-URI of the parent comment when this is a reply to a reply. */
  replyTo?: string
  text: string
  createdAt: string
  [k: string]: unknown
}

/** Create a standard.site comment. Stubbed: no API requests (standard site documents removed from app). */
export async function createStandardSiteComment(
  _documentUri: string,
  _text: string,
  _replyToUri?: string
): Promise<{ uri: string; cid: string }> {
  throw new Error('Standard site documents are not available')
}

/** List standard.site comment records. Stubbed: no API requests (standard site documents removed from app). */
export async function listStandardSiteComments(
  _client: AtpAgent,
  _repo: string,
  _opts?: { limit?: number; cursor?: string }
): Promise<{ records: { uri: string; cid: string; value: StandardSiteCommentRecord }[]; cursor?: string }> {
  return { records: [], cursor: undefined }
}

/** Unified reply view for forum post detail (standard.site comment or Bluesky post that links to the doc). */
export type ForumReplyView = {
  uri: string
  cid: string
  /** When set, this reply is a direct reply to another comment (for threading). */
  replyTo?: string
  author: { did: string; handle?: string; avatar?: string; displayName?: string }
  record: { text?: string; createdAt?: string; facets?: unknown[] }
  likeCount?: number
  viewer?: { like?: string }
  isComment?: boolean
}

/** List replies for a standard.site document. Returns empty to avoid N+1 / heavy API usage. */
export async function listStandardSiteRepliesForDocument(
  _documentUri: string,
  _domain: string,
  _documentUrl?: string | null
): Promise<ForumReplyView[]> {
  return []
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

/** Resolve DID from a publication base URL via .well-known/site.standard.publication. Returns null on CORS/network error. */
export async function resolvePublicationDidFromWellKnown(baseUrl: string): Promise<string | null> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/.well-known/site.standard.publication`
    const res = await fetch(url, { method: 'GET', credentials: 'omit' })
    if (!res.ok) return null
    const text = await res.text()
    const atUri = text.trim()
    if (!atUri.startsWith('at://')) return null
    const parts = atUri.slice('at://'.length).split('/')
    if (parts.length < 1) return null
    return parts[0] ?? null
  } catch {
    return null
  }
}

/** Search forum (standard.site) documents by title/body/path/author. For % typeahead in composer. Returns empty to avoid heavy API usage. */
export async function searchForumDocuments(_q: string, _limit = 10): Promise<StandardSiteDocumentView[]> {
  return []
}

/** Build human-readable URL for a standard.site document (for pasting into post). */
export function getStandardSiteDocumentUrl(doc: StandardSiteDocumentView): string {
  if (!doc.baseUrl) return doc.uri
  const base = doc.baseUrl.replace(/\/$/, '')
  const path = (doc.path ?? '').replace(/^\//, '')
  return path ? `${base}/${path}` : base
}

/** List standard.site blog documents for a single author. Stubbed: no API requests (standard site documents removed from app). */
export async function listStandardSiteDocumentsForAuthor(
  _client: AtpAgent,
  _did: string,
  _authorHandle?: string,
  _opts?: { limit?: number; cursor?: string }
): Promise<{ documents: StandardSiteDocumentView[]; cursor?: string }> {
  return { documents: [], cursor: undefined }
}

/** Search posts that link to a domain (e.g. standard.site). Works with publicAgent when logged out. */
export async function searchPostsByDomain(
  domain: string,
  cursor?: string,
  author?: string
): Promise<{ posts: PostView[]; cursor: string | undefined }> {
  const client = getSession() ? agent : publicAgent
  try {
    const res = await client.app.bsky.feed.searchPosts({
      q: domain,
      domain,
      limit: 30,
      cursor,
      sort: 'latest',
      ...(author ? { author } : {}),
    })
    return { posts: res.data.posts ?? [], cursor: res.data.cursor }
  } catch {
    return { posts: [], cursor: undefined }
  }
}

/** Get the current account's saved/pinned feeds from preferences. Returns array of { id, type, value, pinned }. */
export async function getSavedFeedsFromPreferences(): Promise<
  { id: string; type: string; value: string; pinned: boolean }[]
> {
  if (!getSession()?.did) return []

  // Check cache first
  if (savedFeedsCache && Date.now() - savedFeedsCache.timestamp < SAVED_FEEDS_CACHE_TTL) {
    return savedFeedsCache.data
  }

  try {
    // Read same format we write: app.bsky.actor.getPreferences returns preferences array; saved feeds are in savedFeedsPrefV2
    const { data } = await agent.app.bsky.actor.getPreferences({})
    const prefs = (data?.preferences ?? []) as { $type?: string; items?: { id: string; type: string; value: string; pinned: boolean }[] }[]
    const v2Type = 'app.bsky.actor.defs#savedFeedsPrefV2'
    const existing = prefs.find((p) => p.$type === v2Type)
    const list = existing?.items ?? []

    // Cache the result
    savedFeedsCache = { data: list, timestamp: Date.now() }
    return list
  } catch {
    // 401 Unauthorized (logged out / expired) or other error: return empty so UI doesn't fire repeated requests
    savedFeedsCache = null
    return []
  }
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
let savedFeedsCache: { data: { id: string; type: string; value: string; pinned: boolean }[]; timestamp: number } | null = null
const SAVED_FEEDS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

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

/** Create a new post (no reply). Optional image files (max 4, jpeg/png/gif/webp). Optional alt text per image (max 1000 chars each). */
export async function createPost(
  text: string,
  imageFiles?: File[],
  altTexts?: string[],
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
  })
  return { uri: res.uri, cid: res.cid }
}

/** Create a quote post: embeds the given post (uri/cid) with optional text and images. */
export async function createQuotePost(
  quotedUri: string,
  quotedCid: string,
  text: string,
  imageFiles?: File[],
  altTexts?: string[],
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
) {
  const t = text.trim()
  if (!t) throw new Error('Comment text is required')
  const rt = new RichText({ text: t })
  await rt.detectFacets(agent)
  return agent.post({
    text: rt.text,
    facets: rt.facets,
    createdAt: new Date().toISOString(),
    reply: {
      root: { uri: rootUri, cid: rootCid },
      parent: { uri: parentUri, cid: parentCid },
    },
  })
}


// ============================================================================
// API Request Lifecycle Management - New Functions
// ============================================================================

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
  const cacheKey = `timeline:${limit}:${cursor ?? 'initial'}`
  const cached = responseCache.get<{ feed: TimelineItem[]; cursor?: string }>(cacheKey)
  if (cached) {
    return { data: { feed: cached.feed, cursor: cached.cursor } } as any
  }
  const result = await apiRequestManager.execute(
    `timeline:${limit}:${cursor ?? 'initial'}`,
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
  cursor?: string
): Promise<Awaited<ReturnType<typeof agent.app.bsky.feed.getFeed>>> {
  if (!getSession()) {
    return { data: { feed: [], cursor: undefined } } as unknown as Awaited<ReturnType<typeof agent.app.bsky.feed.getFeed>>
  }
  const cacheKey = `feed:${feedUri}:${limit}:${cursor ?? 'initial'}`
  const cached = responseCache.get<{ feed: TimelineItem[]; cursor?: string }>(cacheKey)
  if (cached) {
    return { data: { feed: cached.feed, cursor: cached.cursor } } as any
  }
  const result = await apiRequestManager.execute(
    `feed:${feedUri}:${limit}:${cursor ?? 'initial'}`,
    () => agent.app.bsky.feed.getFeed({ feed: feedUri, limit, cursor }),
    { priority: RequestPriority.MEDIUM, ttl: 300_000, staleWhileRevalidate: 300_000, cacheKey, timeout: 30000 }
  )
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

/**
 * Like a post with cache invalidation. Returns the like record URI for optimistic UI.
 */
export async function likePostWithLifecycle(uri: string, cid: string): Promise<{ uri: string }> {
  const result = await apiRequestManager.execute(`like:${uri}`, () => agent.like(uri, cid), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterPostLiked()
  return result
}

/**
 * Unlike a post with cache invalidation
 */
export async function unlikePostWithLifecycle(likeUri: string): Promise<void> {
  await apiRequestManager.execute(`unlike:${likeUri}`, () => agent.deleteLike(likeUri), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterPostUnliked()
}

/**
 * Repost a post with cache invalidation. Returns the repost record URI for optimistic UI.
 */
export async function repostPostWithLifecycle(uri: string, cid: string): Promise<{ uri: string }> {
  const result = await apiRequestManager.execute(`repost:${uri}`, () => agent.repost(uri, cid), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterPostReposted()
  return result
}

/**
 * Delete a repost with cache invalidation
 */
export async function deleteRepostWithLifecycle(repostUri: string): Promise<void> {
  await apiRequestManager.execute(`unrepost:${repostUri}`, () => agent.deleteRepost(repostUri), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterPostReposted()
}

/**
 * Follow an account with cache invalidation. Returns the follow record URI for optimistic UI.
 */
export async function followAccountWithLifecycle(did: string): Promise<{ uri: string }> {
  const result = await apiRequestManager.execute(`follow:${did}`, () => agent.follow(did), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterFollowing()
  return result
}

/**
 * Unfollow an account with cache invalidation
 */
export async function unfollowAccountWithLifecycle(followUri: string): Promise<void> {
  await apiRequestManager.execute(`unfollow:${followUri}`, () => agent.deleteFollow(followUri), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterUnfollowing()
}

/**
 * Block an account with cache invalidation
 */
export async function blockAccountWithLifecycle(did: string): Promise<{ uri: string }> {
  const result = await apiRequestManager.execute(`block:${did}`, () => agent.app.bsky.graph.block.create({ repo: agent.did ?? '' }, { subject: did, createdAt: new Date().toISOString() }), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterBlocking()
  return result
}

/**
 * Unblock an account with cache invalidation
 */
export async function unblockAccountWithLifecycle(blockUri: string): Promise<void> {
  await apiRequestManager.execute(`unblock:${blockUri}`, () => agent.app.bsky.graph.block.delete({ repo: agent.did ?? '', rkey: blockUri.split('/').pop() ?? '' }), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterUnblocking()
}

/**
 * Mute an account with cache invalidation
 */
export async function muteAccountWithLifecycle(did: string): Promise<void> {
  await apiRequestManager.execute(`mute:${did}`, () => agent.app.bsky.graph.muteActor({ actor: did }), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterMuting()
}

/**
 * Unmute an account with cache invalidation
 */
export async function unmuteAccountWithLifecycle(did: string): Promise<void> {
  await apiRequestManager.execute(`unmute:${did}`, () => agent.app.bsky.graph.unmuteActor({ actor: did }), { priority: RequestPriority.HIGH, timeout: 30000 })
  invalidateAfterUnmuting()
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
