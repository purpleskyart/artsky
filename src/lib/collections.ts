/**
 * Public post collections (app.artsky.collection) — stored on the user’s PDS, readable by anyone.
 */

import { agent, getSession, parseAtUri, publicAgent } from './bsky'

export const COLLECTION_LEXICON = 'app.artsky.collection' as const

export const ACTIVE_COLLECTION_STORAGE_KEY = 'artsky-active-collection-at-uri'

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

export type CollectionRecordValue = {
  $type: typeof COLLECTION_LEXICON
  title: string
  items: string[]
  createdAt: string
}

export type CollectionView = {
  uri: string
  cid: string
  did: string
  rkey: string
  title: string
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

type RepoGetRecordData = {
  uri?: string
  cid?: string
  value?: unknown
}

/** PDS URL for did:plc from PLC directory (unauthenticated read). */
async function resolvePlcPdsBase(did: string): Promise<string | null> {
  if (!did.startsWith('did:plc:')) return null
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
        return url.replace(/\/$/, '')
      }
    }
    return null
  } catch {
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

/** Read a collection record by full AT-URI (works for any public repo). */
export async function getCollectionByAtUri(atUri: string): Promise<CollectionView | null> {
  const parsed = parseAtUri(normalizeAtUriParam(atUri))
  if (!parsed || parsed.collection !== COLLECTION_LEXICON) return null
  try {
    const data = await fetchCollectionRecordLoose(parsed.did, parsed.rkey)
    if (!data?.cid || typeof data.uri !== 'string') return null
    const cid = data.cid
    const v = data.value as {
      title?: string
      items?: string[]
      createdAt?: string
    }
    const title = (v.title ?? 'Collection').trim() || 'Collection'
    const items = Array.isArray(v.items) ? v.items.filter((u) => typeof u === 'string' && isFeedPostUri(u)) : []
    const createdAt = v.createdAt ?? new Date().toISOString()
    return {
      uri: data.uri,
      cid,
      did: parsed.did,
      rkey: parsed.rkey,
      title,
      items,
      createdAt,
    }
  } catch {
    return null
  }
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
      const v = r.value as { items?: string[] }
      for (const u of v.items ?? []) {
        if (typeof u === 'string' && isFeedPostUri(u)) union.add(u)
      }
    }
    return union
  } catch {
    return new Set()
  }
}

export type CollectionPickerRow = { uri: string; title: string; hasPost: boolean }

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
      const v = r.value as { title?: string; items?: string[] }
      const items = Array.isArray(v.items) ? v.items : []
      const title = (v.title ?? 'Collection').trim() || 'Collection'
      rows.push({ uri, title, hasPost: items.includes(postUri) })
    }
    return rows.reverse()
  } catch {
    return []
  }
}

const COLLECTION_INDEX_PREVIEW_COUNT = 4

export type CollectionSummary = {
  uri: string
  title: string
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
      const v = r.value as { title?: string; items?: string[] }
      const items = Array.isArray(v.items) ? v.items : []
      const title = (v.title ?? 'Collection').trim() || 'Collection'
      rows.push({
        uri,
        title,
        itemCount: items.length,
        previewPostUris: items.slice(0, COLLECTION_INDEX_PREVIEW_COUNT),
      })
    }
    return rows.reverse()
  } catch {
    return []
  }
}

export async function createCollection(title: string): Promise<{ uri: string; cid: string }> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const rkey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const record: CollectionRecordValue = {
    $type: COLLECTION_LEXICON,
    title: title.trim() || 'Saved',
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
  const record: CollectionRecordValue = {
    $type: COLLECTION_LEXICON,
    title: view.title,
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
