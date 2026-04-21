/**
 * Post collections (app.purplesky.collection) with app-level public/private visibility.
 */

import { agent, getSession, parseAtUri, publicAgent } from './bsky'

export const COLLECTION_LEXICON = 'app.purplesky.collection' as const

export const ACTIVE_COLLECTION_STORAGE_KEY = 'purplesky-active-collection-at-uri'

function activeCollectionStorageKey(did: string): string {
  return `${ACTIVE_COLLECTION_STORAGE_KEY}:${did}`
}

/** Prefer per-account key; fall back to legacy global key. */
export function readStoredActiveCollectionAtUri(did: string): string | null {
  try {
    return (
      localStorage.getItem(activeCollectionStorageKey(did)) ?? localStorage.getItem(ACTIVE_COLLECTION_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

export const MAX_COLLECTION_ITEMS = 2000

/** Max length for `slug` on `app.purplesky.collection` records (URL segment). */
export const MAX_COLLECTION_SLUG_LENGTH = 64

/** In-memory memoization to avoid repeating expensive owner/slug resolution. */
const ownerDidCache = new Map<string, string | null>()
const boardSegmentRkeyCache = new Map<string, string | null>()
const plcPdsBaseCache = new Map<string, string | null>()

/** Persistent cache keys for localStorage */
const OWNER_DID_CACHE_KEY = 'purplesky:owner-did-cache'
const BOARD_SEGMENT_CACHE_KEY = 'purplesky:board-segment-cache'
const OWNER_DID_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const BOARD_SEGMENT_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

interface PersistentCacheEntry<T> {
  value: T
  timestamp: number
}

function loadPersistentCache<T>(key: string): Map<string, PersistentCacheEntry<T>> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Map()
    const entries = JSON.parse(raw) as Array<[string, PersistentCacheEntry<T>]>
    return new Map(entries)
  } catch {
    return new Map()
  }
}

function savePersistentCache<T>(key: string, cache: Map<string, PersistentCacheEntry<T>>): void {
  try {
    const entries = Array.from(cache.entries())
    localStorage.setItem(key, JSON.stringify(entries))
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

function getCachedWithTTL<T>(cache: Map<string, PersistentCacheEntry<T>>, key: string, ttlMs: number): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

function setCachedWithTTL<T>(cache: Map<string, PersistentCacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, timestamp: Date.now() })
}

/** Initialize persistent caches and merge into in-memory caches */
function initPersistentCaches(): void {
  // Load handle→DID cache
  const ownerDidPersistent = loadPersistentCache<string | null>(OWNER_DID_CACHE_KEY)
  for (const [key] of ownerDidPersistent) {
    const cached = getCachedWithTTL(ownerDidPersistent, key, OWNER_DID_CACHE_TTL_MS)
    if (cached !== undefined && !ownerDidCache.has(key)) {
      ownerDidCache.set(key, cached)
    }
  }

  // Load slug→rkey cache
  const boardSegmentPersistent = loadPersistentCache<string | null>(BOARD_SEGMENT_CACHE_KEY)
  for (const [key] of boardSegmentPersistent) {
    const cached = getCachedWithTTL(boardSegmentPersistent, key, BOARD_SEGMENT_CACHE_TTL_MS)
    if (cached !== undefined && !boardSegmentRkeyCache.has(key)) {
      boardSegmentRkeyCache.set(key, cached)
    }
  }
}

/** Save current in-memory caches to localStorage */
function saveOwnerDidCache(): void {
  const persistent = loadPersistentCache<string | null>(OWNER_DID_CACHE_KEY)
  for (const [key, value] of ownerDidCache) {
    setCachedWithTTL(persistent, key, value)
  }
  savePersistentCache(OWNER_DID_CACHE_KEY, persistent)
}

function saveBoardSegmentCache(): void {
  const persistent = loadPersistentCache<string | null>(BOARD_SEGMENT_CACHE_KEY)
  for (const [key, value] of boardSegmentRkeyCache) {
    setCachedWithTTL(persistent, key, value)
  }
  savePersistentCache(BOARD_SEGMENT_CACHE_KEY, persistent)
}

// Initialize caches on module load
initPersistentCaches()

export type CollectionRecordValue = {
  $type: typeof COLLECTION_LEXICON
  title: string
  /** App-level visibility flag; private collections are only readable by their owner in-app. */
  private?: boolean
  /** Share URL segment: `handle/slug` (lowercase letters, digits, hyphens). */
  slug?: string
  items: string[]
  createdAt: string
}

export type CollectionView = {
  uri: string
  cid: string
  did: string
  rkey: string
  title: string
  isPrivate: boolean
  /** When set, share links use `handle/slug` instead of `handle/rkey`. */
  slug: string | null
  items: string[]
  createdAt: string
}

function isFeedPostUri(uri: string): boolean {
  const p = parseAtUri(uri)
  return !!p && p.collection === 'app.bsky.feed.post'
}

/** Undo accidental double-encoding in query/hash params (URLSearchParams only decodes once). */
function normalizeAtUriParam(raw: string): string {
  let s = raw.trim()
  for (let i = 0; i < 3; i++) {
    if (!/%[0-9A-Fa-f]{2}/i.test(s)) break
    try {
      const next = decodeURIComponent(s)
      if (next === s) break
      s = next
    } catch {
      break
    }
  }
  return s
}

/**
 * Compact `handle/{rkey|slug}` or `did:…/{rkey|slug}` (optional leading `@` on handle).
 * Second segment is either the record rkey or the stored `slug`.
 */
function parseSlashSeparatedCollectionRef(ref: string): { owner: string; segment: string } | null {
  const s = ref.trim()
  const i = s.indexOf('/')
  if (i <= 0 || i >= s.length - 1) return null
  const owner = s.slice(0, i).replace(/^@/, '')
  const segment = s.slice(i + 1)
  if (!owner || !segment || owner.includes('/') || segment.includes('/')) return null
  return { owner, segment }
}

async function resolveCollectionOwnerToDid(owner: string): Promise<string | null> {
  if (owner.startsWith('did:')) return owner
  const key = owner.trim().toLowerCase()
  if (ownerDidCache.has(key)) return ownerDidCache.get(key) ?? null
  try {
    const res = await publicAgent.getProfile({ actor: owner })
    const did = res.data.did ?? null
    ownerDidCache.set(key, did)
    saveOwnerDidCache()
    return did
  } catch {
    ownerDidCache.set(key, null)
    saveOwnerDidCache()
    return null
  }
}

function normalizeStoredSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase()
  if (!t || t.length > MAX_COLLECTION_SLUG_LENGTH) return null
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t)) return null
  return t
}

function normalizePrivateFlag(raw: unknown): boolean {
  return raw === true
}

/** `handle/slug` or `handle/rkey` for query params (pass owner actor + board fields). */
export function collectionShareRef(ownerActor: string, slug: string | null, rkey: string): string {
  const actor = ownerActor.replace(/^@/, '').trim()
  const seg = slug && slug.length > 0 ? slug : rkey
  return `${actor}/${seg}`
}

/** `did/rkey` only — used where slug is unknown without a fetch (e.g. legacy path redirect). */
export function compactCollectionRefFromAtUri(atUri: string): string | null {
  const parsed = parseAtUri(normalizeAtUriParam(atUri))
  if (!parsed || parsed.collection !== COLLECTION_LEXICON) return null
  return `${parsed.did}/${parsed.rkey}`
}

function slugifyCollectionTitle(title: string): string {
  let s = title
    .trim()
    .toLowerCase()
    .replace(/['\u2018\u2019"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_COLLECTION_SLUG_LENGTH)
    .replace(/-+$/g, '')
  if (!s) s = 'board'
  return s
}

type ListedCollectionRow = { rkey: string; uri: string; value: unknown }

function mapListRow(r: { uri?: string; value?: unknown }): ListedCollectionRow | null {
  const uri = r.uri
  if (typeof uri !== 'string') return null
  const p = parseAtUri(uri)
  if (!p || p.collection !== COLLECTION_LEXICON) return null
  return { rkey: p.rkey, uri, value: r.value }
}

/** List collection records for any public repo (App View → PDS → session agent if owner). */
async function listCollectionRecordsLoose(did: string): Promise<ListedCollectionRow[]> {
  try {
    const res = await publicAgent.com.atproto.repo.listRecords({
      repo: did,
      collection: COLLECTION_LEXICON,
      limit: 100,
    })
    return (res.data.records ?? []).map(mapListRow).filter((x): x is ListedCollectionRow => x != null)
  } catch {
    /* AppView may omit custom lexicon — try PDS */
  }

  const pdsBase = await resolvePlcPdsBase(did)
  if (pdsBase) {
    try {
      const url = new URL(`${pdsBase}/xrpc/com.atproto.repo.listRecords`)
      url.searchParams.set('repo', did)
      url.searchParams.set('collection', COLLECTION_LEXICON)
      url.searchParams.set('limit', '100')
      const r = await fetch(url.toString())
      if (r.ok) {
        const body = (await r.json()) as { records?: Array<{ uri?: string; value?: unknown }> }
        return (body.records ?? []).map(mapListRow).filter((x): x is ListedCollectionRow => x != null)
      }
    } catch {
      /* fall through */
    }
  }

  const session = getSession()
  if (session?.did === did) {
    try {
      const res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COLLECTION_LEXICON,
        limit: 100,
      })
      return (res.data.records ?? []).map(mapListRow).filter((x): x is ListedCollectionRow => x != null)
    } catch {
      return []
    }
  }
  return []
}

async function mintUniqueCollectionSlug(did: string, title: string): Promise<string> {
  const base = slugifyCollectionTitle(title)
  const rows = await listCollectionRecordsLoose(did)
  const used = new Set<string>()
  for (const row of rows) {
    const sl = normalizeStoredSlug((row.value as { slug?: string }).slug)
    if (sl) used.add(sl)
  }
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`.slice(0, MAX_COLLECTION_SLUG_LENGTH).replace(/-+$/g, '')
    if (candidate && !used.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, MAX_COLLECTION_SLUG_LENGTH).replace(/-+$/g, '')
}

async function findRkeyBySlug(did: string, slugLower: string): Promise<string | null> {
  const result = await findCollectionBySlug(did, slugLower)
  return result?.rkey ?? null
}

/** Find a collection by slug, returning full data to avoid duplicate API calls. */
async function findCollectionBySlug(did: string, slugLower: string): Promise<CollectionView | null> {
  const cacheKey = `${did}::${slugLower}`
  const cachedRkey = boardSegmentRkeyCache.get(cacheKey)
  if (cachedRkey) {
    // We have the rkey cached, but still need to load the view
    return loadCollectionViewFromDidRkey(did, cachedRkey)
  }
  // List all collections to find by slug - we get full data here
  const rows = await listCollectionRecordsLoose(did)
  for (const row of rows) {
    const sl = normalizeStoredSlug((row.value as { slug?: string }).slug)
    if (sl === slugLower) {
      boardSegmentRkeyCache.set(cacheKey, row.rkey)
      saveBoardSegmentCache()
      // Build CollectionView directly from the row data we already have
      const v = row.value as {
        title?: string
        private?: boolean
        slug?: string
        items?: string[]
        createdAt?: string
      }
      const cid = (row as unknown as { cid?: string }).cid
      if (!cid) {
        // Fallback to fetching if cid is missing
        return loadCollectionViewFromDidRkey(did, row.rkey)
      }
      const title = (v.title ?? 'Collection').trim() || 'Collection'
      const isPrivate = normalizePrivateFlag(v.private)
      const slug = normalizeStoredSlug(v.slug)
      const items = Array.isArray(v.items) ? v.items.filter((u) => typeof u === 'string' && isFeedPostUri(u)) : []
      const createdAt = v.createdAt ?? new Date().toISOString()
      return {
        uri: row.uri,
        cid,
        did,
        rkey: row.rkey,
        title,
        isPrivate,
        slug,
        items,
        createdAt,
      }
    }
  }
  boardSegmentRkeyCache.set(cacheKey, null)
  saveBoardSegmentCache()
  return null
}

/** Resolve URL segment: record rkey (getRecord) or stored `slug` (list + match). */
async function _resolveBoardSegmentToRkey(did: string, segment: string): Promise<string | null> {
  const seg = segment.trim()
  if (!seg) return null
  const cacheKey = `${did}::${seg.toLowerCase()}`
  if (boardSegmentRkeyCache.has(cacheKey)) return boardSegmentRkeyCache.get(cacheKey) ?? null
  const direct = await fetchCollectionRecordLoose(did, seg)
  if (direct?.cid && typeof direct.uri === 'string') {
    const p = parseAtUri(direct.uri)
    const resolved = p?.rkey ?? seg
    boardSegmentRkeyCache.set(cacheKey, resolved)
    saveBoardSegmentCache()
    return resolved
  }
  const resolved = await findRkeyBySlug(did, seg.toLowerCase())
  boardSegmentRkeyCache.set(cacheKey, resolved)
  saveBoardSegmentCache()
  return resolved
}

/** True if the value looks like a collection AT-URI or compact `owner/rkey`. */
export function isLikelyCollectionRefParam(ref: string): boolean {
  const n = normalizeAtUriParam(ref.trim())
  if (!n) return false
  if (n.startsWith('at://')) {
    const p = parseAtUri(n)
    return !!(p && p.collection === COLLECTION_LEXICON)
  }
  return parseSlashSeparatedCollectionRef(n) != null
}

/**
 * Segments for `#/c/:actor/:segment` share links (`segment` = slug when set, else rkey).
 * Pass `boardSlug` when you have the loaded record so AT-URI refs still produce `handle/slug`.
 */
export function collectionRefToShortPathSegments(
  ref: string,
  opts?: { ownerHandle?: string | null; boardSlug?: string | null }
): { actor: string; rkey: string } | null {
  const n = normalizeAtUriParam(ref.trim())
  const ph = opts?.ownerHandle?.replace(/^@/, '') || null
  const slug = normalizeStoredSlug(opts?.boardSlug ?? null)
  if (n.startsWith('at://')) {
    const parsed = parseAtUri(n)
    if (!parsed || parsed.collection !== COLLECTION_LEXICON) return null
    const segment = slug || parsed.rkey
    return { actor: ph || parsed.did, rkey: segment }
  }
  const slash = parseSlashSeparatedCollectionRef(n)
  if (!slash) return null
  return { actor: ph || slash.owner, rkey: slash.segment }
}

type RepoGetRecordData = {
  uri?: string
  cid?: string
  value?: unknown
}

/** PDS URL for did:plc from PLC directory (unauthenticated read). */
async function resolvePlcPdsBase(did: string): Promise<string | null> {
  if (!did.startsWith('did:plc:')) return null
  if (plcPdsBaseCache.has(did)) return plcPdsBaseCache.get(did) ?? null
  try {
    const r = await fetch(`https://plc.directory/${encodeURIComponent(did)}`)
    if (!r.ok) return null
    const doc = (await r.json()) as {
      service?: Array<{ type?: string; serviceEndpoint?: string | string[] }>
    }
    for (const s of doc.service ?? []) {
      if (s.type !== 'AtprotoPersonalDataServer') continue
      const ep = s.serviceEndpoint
      const url = Array.isArray(ep) ? ep[0] : ep
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        const normalized = url.replace(/\/$/, '')
        plcPdsBaseCache.set(did, normalized)
        return normalized
      }
    }
    plcPdsBaseCache.set(did, null)
    return null
  } catch {
    plcPdsBaseCache.set(did, null)
    return null
  }
}

/**
 * Fetch collection record: AppView proxy, then repo PDS (custom lexicons), then session agent for owner.
 * Order matters after refresh: OAuth session may not exist on first attempt, so PDS read must work logged out.
 */
async function fetchCollectionRecordLoose(did: string, rkey: string): Promise<RepoGetRecordData | null> {
  try {
    const res = await publicAgent.com.atproto.repo.getRecord({
      repo: did,
      collection: COLLECTION_LEXICON,
      rkey,
    })
    return res.data as RepoGetRecordData
  } catch {
    /* AppView may not proxy this lexicon — try PDS */
  }

  const pdsBase = await resolvePlcPdsBase(did)
  if (pdsBase) {
    try {
      const url = new URL(`${pdsBase}/xrpc/com.atproto.repo.getRecord`)
      url.searchParams.set('repo', did)
      url.searchParams.set('collection', COLLECTION_LEXICON)
      url.searchParams.set('rkey', rkey)
      const r = await fetch(url.toString())
      if (r.ok) {
        const body = (await r.json()) as RepoGetRecordData
        if (body.cid && typeof body.uri === 'string') return body
      }
    } catch {
      /* fall through */
    }
  }

  const session = getSession()
  if (session?.did === did) {
    try {
      const res = await agent.com.atproto.repo.getRecord({
        repo: did,
        collection: COLLECTION_LEXICON,
        rkey,
      })
      return res.data as RepoGetRecordData
    } catch {
      return null
    }
  }
  return null
}

async function loadCollectionViewFromDidRkey(did: string, rkey: string): Promise<CollectionView | null> {
  try {
    const data = await fetchCollectionRecordLoose(did, rkey)
    if (!data?.cid || typeof data.uri !== 'string') return null
    const cid = data.cid
    const v = data.value as {
      title?: string
      private?: boolean
      slug?: string
      items?: string[]
      createdAt?: string
    }
    const title = (v.title ?? 'Collection').trim() || 'Collection'
    const isPrivate = normalizePrivateFlag(v.private)
    const slug = normalizeStoredSlug(v.slug)
    const items = Array.isArray(v.items) ? v.items.filter((u) => typeof u === 'string' && isFeedPostUri(u)) : []
    const createdAt = v.createdAt ?? new Date().toISOString()
    return {
      uri: data.uri,
      cid,
      did,
      rkey,
      title,
      isPrivate,
      slug,
      items,
      createdAt,
    }
  } catch {
    return null
  }
}

/**
 * Load a collection by full AT-URI or compact `handle/{rkey|slug}`.
 * Private collections are only returned for the signed-in owner.
 */
export async function getCollectionByAtUri(ref: string): Promise<CollectionView | null> {
  const sessionDid = getSession()?.did ?? null
  const n = normalizeAtUriParam(ref.trim())
  if (n.startsWith('at://')) {
    const parsed = parseAtUri(n)
    if (!parsed || parsed.collection !== COLLECTION_LEXICON) return null
    const view = await loadCollectionViewFromDidRkey(parsed.did, parsed.rkey)
    if (view?.isPrivate && sessionDid !== view.did) return null
    return view
  }
  const slash = parseSlashSeparatedCollectionRef(n)
  if (!slash) return null
  const did = await resolveCollectionOwnerToDid(slash.owner)
  if (!did) return null

  // Try to load directly by rkey first (fast path)
  const direct = await fetchCollectionRecordLoose(did, slash.segment)
  if (direct?.cid && typeof direct.uri === 'string') {
    const view = await loadCollectionViewFromDidRkey(did, slash.segment)
    if (view?.isPrivate && sessionDid !== view.did) return null
    return view
  }

  // Segment is a slug - look it up (this lists all collections but returns full data)
  const view = await findCollectionBySlug(did, slash.segment.toLowerCase())
  if (view?.isPrivate && sessionDid !== view.did) return null
  return view
}

/** List this account’s collection records (newest rkeys tend to sort last; we reverse for recency). */
export async function listMyCollectionAtUris(): Promise<string[]> {
  const session = getSession()
  if (!session?.did) return []
  try {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: COLLECTION_LEXICON,
      limit: 100,
    })
    const uris = (res.data.records ?? [])
      .map((r) => r.uri as string | undefined)
      .filter((u): u is string => typeof u === 'string')
    return uris.reverse()
  } catch {
    return []
  }
}

/** All post URIs saved in any of this account’s collections (for bookmark fill state). */
export async function loadUnionSavedPostUris(): Promise<Set<string>> {
  const session = getSession()
  if (!session?.did) return new Set()
  try {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: COLLECTION_LEXICON,
      limit: 100,
    })
    const union = new Set<string>()
    for (const r of res.data.records ?? []) {
      const v = r.value as { private?: boolean; items?: string[] }
      if (normalizePrivateFlag(v.private)) continue
      for (const u of v.items ?? []) {
        if (typeof u === 'string' && isFeedPostUri(u)) union.add(u)
      }
    }
    return union
  } catch {
    return new Set()
  }
}

export type CollectionPickerRow = { uri: string; title: string; hasPost: boolean; isPrivate: boolean }

function isSavedCollectionTitle(title: string): boolean {
  return title.trim().toLowerCase() === 'saved'
}

function sortSavedFirst<T extends { title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aSaved = isSavedCollectionTitle(a.title)
    const bSaved = isSavedCollectionTitle(b.title)
    if (aSaved && !bSaved) return -1
    if (!aSaved && bSaved) return 1
    return 0
  })
}

/** Boards for the save menu, with whether this post is already in each. */
export async function listCollectionsWithMembership(postUri: string): Promise<CollectionPickerRow[]> {
  const session = getSession()
  if (!session?.did) return []
  try {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: COLLECTION_LEXICON,
      limit: 100,
    })
    const rows: CollectionPickerRow[] = []
    for (const r of res.data.records ?? []) {
      const uri = r.uri as string
      const v = r.value as { title?: string; private?: boolean; items?: string[] }
      const items = Array.isArray(v.items) ? v.items : []
      const title = (v.title ?? 'Collection').trim() || 'Collection'
      rows.push({ uri, title, hasPost: items.includes(postUri), isPrivate: normalizePrivateFlag(v.private) })
    }
    return sortSavedFirst(rows.reverse())
  } catch {
    return []
  }
}

const COLLECTION_INDEX_PREVIEW_COUNT = 4

export type CollectionSummary = {
  uri: string
  title: string
  isPrivate: boolean
  /** Record rkey (always); share URLs prefer `slug` when set. */
  rkey: string
  slug: string | null
  itemCount: number
  /** Up to four post AT-URIs (newest first) for thumbnails on the index page. */
  previewPostUris: string[]
}

/** All of this account’s boards (for the index page). */
export async function listMyCollectionSummaries(): Promise<CollectionSummary[]> {
  const session = getSession()
  if (!session?.did) return []
  try {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: COLLECTION_LEXICON,
      limit: 100,
    })
    const rows: CollectionSummary[] = []
    for (const r of res.data.records ?? []) {
      const uri = r.uri as string
      const p = parseAtUri(uri)
      const v = r.value as { title?: string; private?: boolean; slug?: string; items?: string[] }
      const items = Array.isArray(v.items) ? v.items : []
      const title = (v.title ?? 'Collection').trim() || 'Collection'
      rows.push({
        uri,
        title,
        isPrivate: normalizePrivateFlag(v.private),
        rkey: p?.rkey ?? '',
        slug: normalizeStoredSlug(v.slug),
        itemCount: items.length,
        previewPostUris: items.slice(0, COLLECTION_INDEX_PREVIEW_COUNT),
      })
    }
    return sortSavedFirst(rows.reverse())
  } catch {
    return []
  }
}

export async function createCollection(title: string, opts?: { isPrivate?: boolean }): Promise<{ uri: string; cid: string }> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const rkey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const slug = await mintUniqueCollectionSlug(session.did, title.trim() || 'Saved')
  const record: CollectionRecordValue = {
    $type: COLLECTION_LEXICON,
    title: title.trim() || 'Saved',
    private: opts?.isPrivate === true,
    slug,
    items: [],
    createdAt: new Date().toISOString(),
  }
  const res = await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: COLLECTION_LEXICON,
    rkey,
    record,
    validate: false,
  })
  return { uri: res.data.uri, cid: res.data.cid }
}

async function writeCollectionItems(view: CollectionView, nextItems: string[]): Promise<void> {
  const session = getSession()
  if (!session?.did || session.did !== view.did) throw new Error('Not authorized')
  const capped = nextItems.slice(0, MAX_COLLECTION_ITEMS)
  const slug = view.slug ?? (await mintUniqueCollectionSlug(view.did, view.title))
  const record: CollectionRecordValue = {
    $type: COLLECTION_LEXICON,
    title: view.title,
    private: view.isPrivate,
    slug,
    items: capped,
    createdAt: view.createdAt,
  }
  await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: COLLECTION_LEXICON,
    rkey: view.rkey,
    record,
    validate: false,
  })
}

/** Add a post URI to the front of a collection (deduped). */
export async function addPostToCollection(collectionAtUri: string, postUri: string): Promise<void> {
  if (!isFeedPostUri(postUri)) throw new Error('Only feed posts can be saved')
  const view = await getCollectionByAtUri(collectionAtUri)
  if (!view) throw new Error('Collection not found')
  const session = getSession()
  if (!session?.did || session.did !== view.did) throw new Error('Not authorized')
  const deduped = view.items.filter((u) => u !== postUri)
  const next = [postUri, ...deduped]
  await writeCollectionItems(view, next)
}

/** Remove a post URI from a collection. */
export async function removePostFromCollection(collectionAtUri: string, postUri: string): Promise<void> {
  const view = await getCollectionByAtUri(collectionAtUri)
  if (!view) throw new Error('Collection not found')
  const session = getSession()
  if (!session?.did || session.did !== view.did) throw new Error('Not authorized')
  const next = view.items.filter((u) => u !== postUri)
  await writeCollectionItems(view, next)
}

/** Rename a collection while preserving slug, items, and createdAt. */
export async function renameCollection(collectionAtUri: string, nextTitle: string): Promise<void> {
  const view = await getCollectionByAtUri(collectionAtUri)
  if (!view) throw new Error('Collection not found')
  const session = getSession()
  if (!session?.did || session.did !== view.did) throw new Error('Not authorized')
  const trimmedTitle = nextTitle.trim()
  if (!trimmedTitle) throw new Error('Enter a collection name')
  const record: CollectionRecordValue = {
    $type: COLLECTION_LEXICON,
    title: trimmedTitle,
    private: view.isPrivate,
    slug: view.slug ?? (await mintUniqueCollectionSlug(view.did, trimmedTitle)),
    items: view.items.slice(0, MAX_COLLECTION_ITEMS),
    createdAt: view.createdAt,
  }
  await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: COLLECTION_LEXICON,
    rkey: view.rkey,
    record,
    validate: false,
  })
}

/** Update collection visibility while preserving title, slug, items, and createdAt. */
export async function setCollectionPrivacy(collectionAtUri: string, isPrivate: boolean): Promise<void> {
  const view = await getCollectionByAtUri(collectionAtUri)
  if (!view) throw new Error('Collection not found')
  const session = getSession()
  if (!session?.did || session.did !== view.did) throw new Error('Not authorized')
  const record: CollectionRecordValue = {
    $type: COLLECTION_LEXICON,
    title: view.title,
    private: isPrivate,
    slug: view.slug ?? (await mintUniqueCollectionSlug(view.did, view.title)),
    items: view.items.slice(0, MAX_COLLECTION_ITEMS),
    createdAt: view.createdAt,
  }
  await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: COLLECTION_LEXICON,
    rkey: view.rkey,
    record,
    validate: false,
  })
}

/** Permanently delete one of the logged-in user's collections. */
export async function deleteCollection(collectionAtUri: string): Promise<void> {
  const view = await getCollectionByAtUri(collectionAtUri)
  if (!view) throw new Error('Collection not found')
  const session = getSession()
  if (!session?.did || session.did !== view.did) throw new Error('Not authorized')
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did,
    collection: COLLECTION_LEXICON,
    rkey: view.rkey,
  })
}

/**
 * Resolve which collection receives quick-saves: localStorage if still present, else newest owned record, else null.
 */
export async function resolveActiveCollectionAtUri(did: string): Promise<string | null> {
  const mine = await listMyCollectionAtUris()
  if (mine.length === 0) return null
  try {
    const stored = localStorage.getItem(activeCollectionStorageKey(did))
    if (stored && mine.includes(stored)) return stored
  } catch {
    /* ignore */
  }
  try {
    const legacy = localStorage.getItem(ACTIVE_COLLECTION_STORAGE_KEY)
    if (legacy && mine.includes(legacy)) return legacy
  } catch {
    /* ignore */
  }
  return mine[0] ?? null
}

export function rememberActiveCollectionAtUri(did: string, uri: string): void {
  try {
    localStorage.setItem(activeCollectionStorageKey(did), uri)
  } catch {
    /* ignore */
  }
}
