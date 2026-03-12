/**
 * API Request Lifecycle Management Updates for bsky.ts
 * 
 * This file contains the updated API functions with:
 * - AbortController for cancellation
 * - RequestQueue for prioritization
 * - ResponseCache with proper TTL
 * - Cache invalidation after mutations
 * - Timeout handling
 */

import { AtpAgent } from '@atproto/api'
import { responseCache } from './ResponseCache'
import { RequestPriority } from './RequestQueue'
import { apiRequestManager } from './apiRequestManager'
import {
  invalidateAfterPostLiked,
  invalidateAfterPostUnliked,
  invalidateAfterPostReposted,
  invalidateAfterFollowing,
  invalidateAfterUnfollowing,
  invalidateAfterBlocking,
  invalidateAfterUnblocking,
  invalidateAfterMuting,
  invalidateAfterUnmuting,
  invalidateAfterPostCreated,
  invalidateAfterPostDeleted,
  invalidateAfterPreferencesUpdated,
} from './cacheInvalidation'

// Note: This file requires 'agent' to be passed in or imported from bsky.ts
// For now, these are reference implementations

// ============================================================================
// READ OPERATIONS - With AbortController, RequestQueue, and Caching
// ============================================================================

/**
 * Get timeline feed with full lifecycle management
 */
export async function getTimeline(
  agent: AtpAgent,
  limit: number = 30,
  cursor?: string
) {
  const cacheKey = `timeline:${limit}:${cursor ?? 'initial'}`
  
  // Check cache first
  const cached = responseCache.get<{ feed: any[]; cursor?: string }>(cacheKey)
  if (cached) return { data: { feed: cached.feed, cursor: cached.cursor } }

  // Execute with queue priority and cancellation support
  const result = await apiRequestManager.execute(
    `timeline:${limit}:${cursor ?? 'initial'}`,
    () => agent.getTimeline({ limit, cursor }),
    {
      priority: RequestPriority.MEDIUM,
      ttl: 300_000, // 5 min
      staleWhileRevalidate: 300_000, // 5 min
      cacheKey,
      timeout: 30000, // 30s timeout
    }
  )

  return result
}

/**
 * Get custom feed with full lifecycle management
 */
export async function getFeed(
  agent: AtpAgent,
  feedUri: string,
  limit: number = 30,
  cursor?: string
) {
  const cacheKey = `feed:${feedUri}:${limit}:${cursor ?? 'initial'}`

  const cached = responseCache.get<{ feed: any[]; cursor?: string }>(cacheKey)
  if (cached) return { data: { feed: cached.feed, cursor: cached.cursor } }

  const result = await apiRequestManager.execute(
    `feed:${feedUri}:${limit}:${cursor ?? 'initial'}`,
    () => agent.app.bsky.feed.getFeed({ feed: feedUri, limit, cursor }),
    {
      priority: RequestPriority.MEDIUM,
      ttl: 300_000,
      staleWhileRevalidate: 300_000,
      cacheKey,
      timeout: 30000,
    }
  )

  return result
}

/**
 * Get profile with full lifecycle management
 */
export async function getProfile(
  agent: AtpAgent,
  actor: string
) {
  const cacheKey = `profile:${actor}`

  const cached = responseCache.get<{ data: any }>(cacheKey)
  if (cached) return cached.data

  const result = await apiRequestManager.execute(
    `profile:${actor}`,
    () => agent.getProfile({ actor }),
    {
      priority: RequestPriority.MEDIUM,
      ttl: 600_000, // 10 min
      staleWhileRevalidate: 300_000, // 5 min
      cacheKey,
      timeout: 30000,
    }
  )

  return result
}

/**
 * Get followers list with full lifecycle management
 */
export async function getFollowers(
  agent: AtpAgent,
  actor: string,
  limit: number = 50,
  cursor?: string
) {
  const cacheKey = `followers:${actor}:${limit}:${cursor ?? 'initial'}`

  const cached = responseCache.get<{ followers: any[]; cursor?: string }>(cacheKey)
  if (cached) return { data: { followers: cached.followers, cursor: cached.cursor } }

  const result = await apiRequestManager.execute(
    `followers:${actor}:${limit}:${cursor ?? 'initial'}`,
    () => agent.app.bsky.graph.getFollowers({ actor, limit, cursor }),
    {
      priority: RequestPriority.LOW,
      ttl: 300_000,
      cacheKey,
      timeout: 30000,
    }
  )

  return result
}

/**
 * Get follows list with full lifecycle management
 */
export async function getFollows(
  agent: AtpAgent,
  actor: string,
  limit: number = 50,
  cursor?: string
) {
  const cacheKey = `follows:${actor}:${limit}:${cursor ?? 'initial'}`

  const cached = responseCache.get<{ follows: any[]; cursor?: string }>(cacheKey)
  if (cached) return { data: { follows: cached.follows, cursor: cached.cursor } }

  const result = await apiRequestManager.execute(
    `follows:${actor}:${limit}:${cursor ?? 'initial'}`,
    () => agent.app.bsky.graph.getFollows({ actor, limit, cursor }),
    {
      priority: RequestPriority.LOW,
      ttl: 300_000,
      cacheKey,
      timeout: 30000,
    }
  )

  return result
}

/**
 * Get notifications with full lifecycle management
 */
export async function getNotifications(
  agent: AtpAgent,
  limit: number = 30,
  cursor?: string
) {
  const cacheKey = `notifications:${limit}:${cursor ?? 'initial'}`

  const cached = responseCache.get<{ notifications: any[]; cursor?: string }>(cacheKey)
  if (cached) return { data: { notifications: cached.notifications, cursor: cached.cursor } }

  const result = await apiRequestManager.execute(
    `notifications:${limit}:${cursor ?? 'initial'}`,
    () => agent.listNotifications({ limit, cursor }),
    {
      priority: RequestPriority.HIGH,
      ttl: 60_000, // 1 min (notifications change frequently)
      cacheKey,
      timeout: 30000,
    }
  )

  return result
}

// ============================================================================
// WRITE OPERATIONS - With Cache Invalidation
// ============================================================================

/**
 * Like a post with cache invalidation
 */
export async function likePost(
  agent: AtpAgent,
  uri: string,
  cid: string
) {
  const result = await apiRequestManager.execute(
    `like:${uri}`,
    () => agent.like(uri, cid),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPostLiked()

  return result
}

/**
 * Unlike a post with cache invalidation
 */
export async function unlikePost(
  agent: AtpAgent,
  likeUri: string
) {
  const result = await apiRequestManager.execute(
    `unlike:${likeUri}`,
    () => agent.deleteLike(likeUri),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPostUnliked()

  return result
}

/**
 * Repost a post with cache invalidation
 */
export async function repostPost(
  agent: AtpAgent,
  uri: string,
  cid: string
) {
  const result = await apiRequestManager.execute(
    `repost:${uri}`,
    () => agent.repost(uri, cid),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPostReposted()

  return result
}

/**
 * Delete a repost with cache invalidation
 */
export async function deleteRepost(
  agent: AtpAgent,
  repostUri: string
) {
  const result = await apiRequestManager.execute(
    `unrepost:${repostUri}`,
    () => agent.deleteRepost(repostUri),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPostReposted()

  return result
}

/**
 * Follow an account with cache invalidation
 */
export async function followAccount(
  agent: AtpAgent,
  did: string
) {
  const result = await apiRequestManager.execute(
    `follow:${did}`,
    () => agent.follow(did),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterFollowing()

  return result
}

/**
 * Unfollow an account with cache invalidation
 */
export async function unfollowAccount(
  agent: AtpAgent,
  followUri: string
) {
  const result = await apiRequestManager.execute(
    `unfollow:${followUri}`,
    () => agent.deleteFollow(followUri),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterUnfollowing()

  return result
}

/**
 * Block an account with cache invalidation
 */
export async function blockAccount(
  agent: AtpAgent,
  did: string
) {
  const result = await apiRequestManager.execute(
    `block:${did}`,
    () => agent.app.bsky.graph.block.create(
      { repo: agent.did ?? '' },
      { subject: did, createdAt: new Date().toISOString() }
    ),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterBlocking()

  return result
}

/**
 * Unblock an account with cache invalidation
 */
export async function unblockAccount(
  agent: AtpAgent,
  blockUri: string
) {
  const result = await apiRequestManager.execute(
    `unblock:${blockUri}`,
    () => agent.app.bsky.graph.block.delete({
      repo: agent.did ?? '',
      rkey: blockUri.split('/').pop() ?? '',
    }),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterUnblocking()

  return result
}

/**
 * Mute an account with cache invalidation
 */
export async function muteAccount(
  agent: AtpAgent,
  did: string
) {
  const result = await apiRequestManager.execute(
    `mute:${did}`,
    () => agent.app.bsky.graph.muteActor({ actor: did }),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterMuting()

  return result
}

/**
 * Unmute an account with cache invalidation
 */
export async function unmuteAccount(
  agent: AtpAgent,
  did: string
) {
  const result = await apiRequestManager.execute(
    `unmute:${did}`,
    () => agent.app.bsky.graph.unmuteActor({ actor: did }),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterUnmuting()

  return result
}

/**
 * Create a post with cache invalidation
 */
export async function createPost(
  agent: AtpAgent,
  text: string
) {
  const result = await apiRequestManager.execute(
    `createPost`,
    () => agent.post({
      text,
      createdAt: new Date().toISOString(),
    }),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPostCreated()

  return result
}

/**
 * Delete a post with cache invalidation
 */
export async function deletePost(
  agent: AtpAgent,
  uri: string
) {
  const parsed = uri.split('/')
  const rkey = parsed.pop() ?? ''

  const result = await apiRequestManager.execute(
    `deletePost:${uri}`,
    () => agent.com.atproto.repo.deleteRecord({
      repo: agent.did ?? '',
      collection: 'app.bsky.feed.post',
      rkey,
    }),
    {
      priority: RequestPriority.HIGH,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPostDeleted()

  return result
}

/**
 * Update muted words with cache invalidation
 */
export async function updateMutedWords(
  agent: AtpAgent,
  words: Array<{ id?: string; value: string; targets?: string[]; actorTarget?: string; expiresAt?: string }>
) {
  const result = await apiRequestManager.execute(
    `updateMutedWords`,
    () => agent.app.bsky.actor.putPreferences({
      preferences: [{
        $type: 'app.bsky.actor.defs#mutedWordsPref',
        items: words.map(w => ({
          ...(w.id ? { id: w.id } : {}),
          value: w.value,
          targets: w.targets?.length ? w.targets : ['content', 'tag'],
          ...(w.actorTarget ? { actorTarget: w.actorTarget } : { actorTarget: 'all' }),
          ...(w.expiresAt ? { expiresAt: w.expiresAt } : {}),
        })),
      }],
    }),
    {
      priority: RequestPriority.MEDIUM,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPreferencesUpdated()

  return result
}

/**
 * Add a saved feed with cache invalidation
 */
export async function addSavedFeed(
  agent: AtpAgent,
  uri: string
) {
  const result = await apiRequestManager.execute(
    `addSavedFeed:${uri}`,
    () => agent.app.bsky.actor.putPreferences({
      preferences: [{
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: [{
          id: `artsky-${Date.now()}`,
          type: 'feed' as const,
          value: uri,
          pinned: true,
        }],
      }],
    }),
    {
      priority: RequestPriority.MEDIUM,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPreferencesUpdated()

  return result
}

/**
 * Remove a saved feed with cache invalidation
 */
export async function removeSavedFeed(
  agent: AtpAgent,
  feedId: string
) {
  const result = await apiRequestManager.execute(
    `removeSavedFeed:${feedId}`,
    () => agent.app.bsky.actor.putPreferences({
      preferences: [{
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: [],
      }],
    }),
    {
      priority: RequestPriority.MEDIUM,
      timeout: 30000,
    }
  )

  // Invalidate related caches
  invalidateAfterPreferencesUpdated()

  return result
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
