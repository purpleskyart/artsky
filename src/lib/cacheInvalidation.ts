/**
 * Cache Invalidation Utilities
 * 
 * Provides cache invalidation patterns for AT Protocol data.
 * Use after mutations to keep caches fresh.
 */

import { responseCache } from './ResponseCache'

// Cache key patterns for common data types
export const CACHE_KEYS = {
  // Timeline feeds
  timeline: (limit: number, cursor?: string) => `timeline:${limit}:${cursor ?? 'initial'}`,
  
  // Custom feeds
  feed: (uri: string, limit: number, cursor?: string) => `feed:${uri}:${limit}:${cursor ?? 'initial'}`,
  
  // Guest feed
  guest: (actor: string, limit: number) => `guest:${actor}:${limit}`,
  
  // Profiles
  profile: (actor: string) => `profile:${actor}`,
  
  // Posts
  post: (uri: string) => `post:${uri}`,
  
  // Thread
  thread: (uri: string) => `thread:${uri}`,
  
  // Quotes
  quotes: (uri: string, limit: number, cursor?: string) => `quotes:${uri}:${limit}:${cursor ?? 'initial'}`,
  
  // Search
  searchPosts: (query: string, tag?: string, cursor?: string) => `search:${query}:${tag ?? ''}:${cursor ?? 'initial'}`,
  
  // Actor feeds
  actorFeeds: (actor: string, limit: number) => `actor-feeds:${actor}:${limit}`,
  
  // Suggested feeds
  suggestedFeeds: (limit: number) => `suggested-feeds:${limit}`,
  
  // Muted words
  mutedWords: () => 'muted-words',
  
  // Preferences
  preferences: () => 'preferences',
  
  // Saved feeds
  savedFeeds: () => 'saved-feeds',
}

// Cache invalidation patterns for mutations
export const INVALIDATION_PATTERNS = {
  // After creating a post
  postCreated: [
    /^timeline:/,
    /^feed:/,
    /^guest:/,
    /^search:/,
  ],
  
  // After deleting a post
  postDeleted: [
    /^timeline:/,
    /^feed:/,
    /^guest:/,
    /^post:/,
    /^thread:/,
  ],
  
  // After liking a post
  postLiked: [
    /^timeline:/,
    /^feed:/,
    /^guest:/,
    /^post:/,
    /^thread:/,
    /^quotes:/,
  ],
  
  // After unliking a post
  postUnliked: [
    /^timeline:/,
    /^feed:/,
    /^guest:/,
    /^post:/,
    /^thread:/,
    /^quotes:/,
  ],
  
  // After reposting
  postReposted: [
    /^timeline:/,
    /^feed:/,
    /^guest:/,
  ],
  
  // After following someone
  followed: [
    /^timeline:/,
    /^profile:/,
  ],
  
  // After unfollowing
  unfollowed: [
    /^timeline:/,
    /^profile:/,
  ],
  
  // After blocking
  blocked: [
    /^timeline:/,
    /^profile:/,
  ],
  
  // After unblocking
  unblocked: [
    /^timeline:/,
    /^profile:/,
  ],
  
  // After muting
  muted: [
    /^timeline:/,
    /^profile:/,
  ],
  
  // After unmuting
  unmuted: [
    /^timeline:/,
    /^profile:/,
  ],
  
  // After updating profile
  profileUpdated: [
    /^profile:/,
    /^timeline:/,
    /^feed:/,
  ],
  
  // After updating preferences
  preferencesUpdated: [
    /^muted-words$/,
    /^preferences$/,
    /^saved-feeds$/,
  ],
  
  // After creating a downvote
  downvoteCreated: [
    /^timeline:/,
    /^feed:/,
    /^guest:/,
  ],
  
  // After deleting a downvote
  downvoteDeleted: [
    /^timeline:/,
    /^feed:/,
    /^guest:/,
  ],
}

/**
 * Invalidate caches after creating a post
 */
export function invalidateAfterPostCreated(): void {
  for (const pattern of INVALIDATION_PATTERNS.postCreated) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after deleting a post
 */
export function invalidateAfterPostDeleted(): void {
  for (const pattern of INVALIDATION_PATTERNS.postDeleted) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after liking a post
 */
export function invalidateAfterPostLiked(): void {
  for (const pattern of INVALIDATION_PATTERNS.postLiked) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after unliking a post
 */
export function invalidateAfterPostUnliked(): void {
  for (const pattern of INVALIDATION_PATTERNS.postUnliked) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after reposting
 */
export function invalidateAfterPostReposted(): void {
  for (const pattern of INVALIDATION_PATTERNS.postReposted) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after following someone
 */
export function invalidateAfterFollowing(): void {
  for (const pattern of INVALIDATION_PATTERNS.followed) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after unfollowing
 */
export function invalidateAfterUnfollowing(): void {
  for (const pattern of INVALIDATION_PATTERNS.unfollowed) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after blocking
 */
export function invalidateAfterBlocking(): void {
  for (const pattern of INVALIDATION_PATTERNS.blocked) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after unblocking
 */
export function invalidateAfterUnblocking(): void {
  for (const pattern of INVALIDATION_PATTERNS.unblocked) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after muting
 */
export function invalidateAfterMuting(): void {
  for (const pattern of INVALIDATION_PATTERNS.muted) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after unmuting
 */
export function invalidateAfterUnmuting(): void {
  for (const pattern of INVALIDATION_PATTERNS.unmuted) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after updating profile
 */
export function invalidateAfterProfileUpdated(): void {
  for (const pattern of INVALIDATION_PATTERNS.profileUpdated) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after updating preferences
 */
export function invalidateAfterPreferencesUpdated(): void {
  for (const pattern of INVALIDATION_PATTERNS.preferencesUpdated) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after creating a downvote
 */
export function invalidateAfterDownvoteCreated(): void {
  for (const pattern of INVALIDATION_PATTERNS.downvoteCreated) {
    responseCache.invalidatePattern(pattern)
  }
}

/**
 * Invalidate caches after deleting a downvote
 */
export function invalidateAfterDownvoteDeleted(): void {
  for (const pattern of INVALIDATION_PATTERNS.downvoteDeleted) {
    responseCache.invalidatePattern(pattern)
  }
}
