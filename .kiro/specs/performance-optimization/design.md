# Design Document: Performance Optimization

## Overview

This design addresses critical performance bottlenecks in the ArtSky React/TypeScript PWA application. The application currently suffers from excessive re-renders due to deeply nested context providers, missing memoization in frequently rendered components, inefficient state management patterns, and suboptimal bundle size. The design focuses on measurable improvements through React optimization patterns, code splitting, efficient state management, and modern web performance techniques.

The optimization strategy follows a layered approach:
1. **Render optimization**: Reduce unnecessary component re-renders through memoization and context restructuring
2. **Bundle optimization**: Implement code splitting and lazy loading to reduce initial load time
3. **State optimization**: Consolidate state management and implement efficient update patterns
4. **Asset optimization**: Improve image loading and caching strategies
5. **API optimization**: Implement request deduplication and caching

## Architecture

### Current Architecture Issues

The application uses a deeply nested context provider structure (14+ providers) that causes cascading re-renders. Every state change in a parent context triggers re-renders in all child contexts and their consumers, even when the consuming components don't use the changed values.

```
App
└── ThemeProvider
    └── SessionProvider
        └── ScrollLockProvider
            └── ToastProvider
                └── ViewModeProvider
                    └── ArtOnlyProvider
                        └── MediaOnlyProvider
                            └── FeedMixProvider
                                └── SeenPostsProvider
                                    └── EditProfileProvider
                                        └── ModerationProvider
                                            └── HideRepostsProvider
                                                └── LoginModalProvider
                                                    └── ModalExpandProvider
                                                        └── ProfileModalProvider
                                                            └── AppRoutes
```

### Optimized Architecture

The optimized architecture groups related contexts and implements memoization at each level:

```
App
└── CoreProviders (Theme, Session, ScrollLock, Toast)
    └── FeedProviders (ViewMode, ArtOnly, MediaOnly, FeedMix, SeenPosts, HideReposts)
        └── ModalProviders (LoginModal, ModalExpand, ProfileModal, EditProfile)
            └── ModerationProvider
                └── AppRoutes
```

Each provider group will:
- Memoize context values to prevent referential inequality re-renders
- Use React.memo for provider components
- Implement selective context splitting where appropriate

## Components and Interfaces

### 1. Context Provider Optimization

#### CoreProvidersGroup Component
```typescript
interface CoreProvidersGroupProps {
  children: ReactNode
}

// Combines Theme, Session, ScrollLock, Toast into single component
// Each context value is memoized
const CoreProvidersGroup: React.FC<CoreProvidersGroupProps>
```

#### FeedProvidersGroup Component
```typescript
interface FeedProvidersGroupProps {
  children: ReactNode
}

// Combines ViewMode, ArtOnly, MediaOnly, FeedMix, SeenPosts, HideReposts
// Memoizes all context values
const FeedProvidersGroup: React.FC<FeedProvidersGroupProps>
```

#### ModalProvidersGroup Component
```typescript
interface ModalProvidersGroupProps {
  children: ReactNode
}

// Combines LoginModal, ModalExpand, ProfileModal, EditProfile
// Memoizes all context values
const ModalProvidersGroup: React.FC<ModalProvidersGroupProps>
```

### 2. Component Memoization

#### Memoized PostCard
```typescript
interface PostCardProps {
  item: TimelineItem
  isSelected?: boolean
  cardRef?: React.Ref<HTMLDivElement | null>
  // ... other props
}

// Wrap PostCard with React.memo and custom comparison function
const MemoizedPostCard = React.memo(PostCard, (prevProps, nextProps) => {
  // Custom comparison to prevent re-renders when props haven't meaningfully changed
  return (
    prevProps.item.post.uri === nextProps.item.post.uri &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.likedUriOverride === nextProps.likedUriOverride &&
    prevProps.seen === nextProps.seen &&
    prevProps.nsfwBlurred === nextProps.nsfwBlurred
    // ... other critical props
  )
})
```

#### Memoized Event Handlers
```typescript
// In PostCard component
const handleLikeClick = useCallback(async (e: React.MouseEvent) => {
  // ... like logic
}, [session, effectiveLikedUri, likeLoading, post.uri, post.cid])

const handleFollowClick = useCallback(async (e: React.MouseEvent) => {
  // ... follow logic
}, [followLoading, isOwnPost, session, isFollowingAuthor, post.author.did])
```

#### Memoized Derived State
```typescript
// In PostCard component
const mediaInfo = useMemo(() => getPostMediaInfoForDisplay(post), [post])
const allMedia = useMemo(() => getPostAllMediaForDisplay(post), [post])
const externalLink = useMemo(() => getPostExternalLink(post), [post])
```

### 3. State Management Optimization

#### FeedPage State Consolidation
```typescript
// Replace multiple useState with useReducer
type FeedState = {
  items: TimelineItem[]
  cursor: string | undefined
  loading: boolean
  loadingMore: boolean
  error: string | null
  keyboardFocusIndex: number
  actionsMenuOpenForIndex: number | null
  likeOverrides: Record<string, string | null>
  seenUris: Set<string>
  seenUrisAtReset: Set<string>
}

type FeedAction =
  | { type: 'SET_ITEMS'; items: TimelineItem[]; cursor?: string }
  | { type: 'APPEND_ITEMS'; items: TimelineItem[]; cursor?: string }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_LOADING_MORE'; loadingMore: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_KEYBOARD_FOCUS'; index: number }
  | { type: 'SET_ACTIONS_MENU_OPEN'; index: number | null }
  | { type: 'UPDATE_LIKE_OVERRIDE'; postUri: string; likeUri: string | null }
  | { type: 'MARK_SEEN'; uris: string[] }
  | { type: 'RESET_SEEN_SNAPSHOT' }

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  // ... reducer logic
}

// In FeedPage component
const [feedState, dispatch] = useReducer(feedReducer, initialState)
```

#### Debounced Seen Posts Tracking
```typescript
// Debounce seen posts updates to reduce re-renders and localStorage writes
const debouncedMarkSeen = useMemo(
  () => debounce((uris: string[]) => {
    dispatch({ type: 'MARK_SEEN', uris })
    saveSeenUris(new Set([...feedState.seenUris, ...uris]))
  }, 1000),
  [feedState.seenUris]
)
```

### 4. Code Splitting and Lazy Loading

#### Route-Based Code Splitting
```typescript
// Lazy load route components
const FeedPage = lazy(() => import('./pages/FeedPage'))
const PostDetailPage = lazy(() => import('./pages/PostDetailPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const TagPage = lazy(() => import('./pages/TagPage'))
const CollabPage = lazy(() => import('./pages/CollabPage'))
const ConsensusPage = lazy(() => import('./pages/ConsensusPage'))

// Wrap routes with Suspense
function AppRoutes() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/feed" element={<FeedPage />} />
        {/* ... other routes */}
      </Routes>
    </Suspense>
  )
}
```

#### Dynamic Import for Heavy Dependencies
```typescript
// Lazy load hls.js only when video playback is needed
const loadHls = async () => {
  const { default: Hls } = await import('hls.js')
  return Hls
}

// In PostCard video effect
useEffect(() => {
  if (!isVideo || !media?.videoPlaylist || !videoRef.current) return
  const video = videoRef.current
  const src = media.videoPlaylist
  
  if (isHlsUrl(src)) {
    loadHls().then((Hls) => {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hlsRef.current = hls
        hls.loadSource(src)
        hls.attachMedia(video)
        // ... rest of setup
      }
    })
  }
  // ... rest of effect
}, [isVideo, media?.videoPlaylist])
```

#### Modal Component Lazy Loading
```typescript
// Lazy load modal components
const PostModal = lazy(() => import('./components/PostModal'))
const ProfileModal = lazy(() => import('./components/ProfileModal'))
const LoginModal = lazy(() => import('./components/LoginModal'))
const EditProfileModal = lazy(() => import('./components/EditProfileModal'))
```

### 5. Image Loading Optimization

#### Progressive Image Loading Component
```typescript
interface ProgressiveImageProps {
  src: string
  alt: string
  aspectRatio?: number
  loading?: 'lazy' | 'eager'
  className?: string
}

const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  alt,
  aspectRatio,
  loading = 'lazy',
  className
}) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [currentSrc, setCurrentSrc] = useState<string>()
  
  // Generate blur placeholder from thumbnail
  const placeholderSrc = useMemo(() => {
    // Use a tiny version of the image as blur-up placeholder
    return src.includes('cdn.bsky.app') 
      ? src.replace(/\/img\//, '/img/avatar_thumbnail/')
      : undefined
  }, [src])
  
  return (
    <div 
      className={`progressive-image ${isLoaded ? 'loaded' : ''} ${className}`}
      style={{ aspectRatio: aspectRatio ? String(aspectRatio) : undefined }}
    >
      {placeholderSrc && !isLoaded && (
        <img 
          src={placeholderSrc} 
          alt="" 
          className="progressive-image-placeholder"
          aria-hidden
        />
      )}
      <img
        src={src}
        alt={alt}
        loading={loading}
        onLoad={() => setIsLoaded(true)}
        className="progressive-image-full"
      />
    </div>
  )
}
```

#### Image Loading Throttle
```typescript
// Limit concurrent image requests to prevent network congestion
class ImageLoadQueue {
  private queue: Array<() => void> = []
  private active = 0
  private readonly maxConcurrent = 6
  
  enqueue(loadFn: () => void) {
    if (this.active < this.maxConcurrent) {
      this.active++
      loadFn()
      this.dequeue()
    } else {
      this.queue.push(loadFn)
    }
  }
  
  private dequeue() {
    if (this.queue.length > 0 && this.active < this.maxConcurrent) {
      const next = this.queue.shift()
      if (next) {
        this.active++
        next()
        this.dequeue()
      }
    } else if (this.active > 0) {
      this.active--
    }
  }
}

const imageLoadQueue = new ImageLoadQueue()
```

### 6. API Request Optimization

#### Request Deduplication
```typescript
// Deduplicate concurrent identical requests
class RequestDeduplicator {
  private pending = new Map<string, Promise<unknown>>()
  
  async dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key)
    if (existing) {
      return existing as Promise<T>
    }
    
    const promise = fetcher().finally(() => {
      this.pending.delete(key)
    })
    
    this.pending.set(key, promise)
    return promise
  }
}

const requestDeduplicator = new RequestDeduplicator()

// Usage in bsky.ts
export async function getTimeline(params: { limit: number; cursor?: string }) {
  const key = `timeline:${params.limit}:${params.cursor ?? 'initial'}`
  return requestDeduplicator.dedupe(key, () => agent.getTimeline(params))
}
```

#### Response Caching with TTL
```typescript
interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class ResponseCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }
    
    return entry.data
  }
  
  set<T>(key: string, data: T, ttl: number) {
    this.cache.set(key, { data, timestamp: Date.now(), ttl })
  }
  
  clear() {
    this.cache.clear()
  }
}

const responseCache = new ResponseCache()

// Usage
export async function getFeed(uri: string, limit: number, cursor?: string) {
  const key = `feed:${uri}:${limit}:${cursor ?? 'initial'}`
  const cached = responseCache.get<FeedResponse>(key)
  if (cached) return cached
  
  const response = await agent.app.bsky.feed.getFeed({ feed: uri, limit, cursor })
  responseCache.set(key, response.data, 60000) // 1 minute TTL
  return response.data
}
```

#### Optimistic Updates
```typescript
// Optimistic like/unlike
export async function optimisticLike(postUri: string, postCid: string): Promise<string> {
  // Immediately return a pending URI
  const pendingUri = `pending:${postUri}:${Date.now()}`
  
  // Perform actual like in background
  agent.like(postUri, postCid).then((res) => {
    // Update any UI that's tracking the pending URI
    return res.uri
  }).catch((err) => {
    // Revert optimistic update
    throw err
  })
  
  return pendingUri
}

// Optimistic unlike
export async function optimisticUnlike(likeUri: string): Promise<void> {
  // Immediately update UI
  // Perform actual unlike in background
  agent.deleteLike(likeUri).catch((err) => {
    // Revert optimistic update
    throw err
  })
}
```

### 7. localStorage Optimization

#### Async localStorage Wrapper
```typescript
// Wrap localStorage operations to run outside render cycle
class AsyncStorage {
  private writeQueue = new Map<string, unknown>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  
  set(key: string, value: unknown, debounceMs = 0) {
    this.writeQueue.set(key, value)
    
    if (debounceMs > 0) {
      if (this.flushTimer) clearTimeout(this.flushTimer)
      this.flushTimer = setTimeout(() => this.flush(), debounceMs)
    } else {
      this.flush()
    }
  }
  
  private flush() {
    requestIdleCallback(() => {
      this.writeQueue.forEach((value, key) => {
        try {
          localStorage.setItem(key, JSON.stringify(value))
        } catch {
          // Handle quota exceeded
        }
      })
      this.writeQueue.clear()
    })
  }
  
  get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : null
    } catch {
      return null
    }
  }
}

const asyncStorage = new AsyncStorage()

// Usage
function saveSeenUris(uris: Set<string>) {
  asyncStorage.set(SEEN_POSTS_KEY, [...uris], 1000) // 1s debounce
}
```

### 8. Build Configuration Optimization

#### Vite Configuration Updates
```typescript
// vite.config.ts
export default defineConfig({
  base,
  plugins: [react(), VitePWA({ /* ... */ })],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor chunks
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'atproto': ['@atproto/api', '@atproto/oauth-client-browser'],
          'video': ['hls.js'],
          'virtual': ['@tanstack/react-virtual'],
        },
      },
    },
    // Enable tree-shaking
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true,
      },
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 500,
  },
  // Enable dependency pre-bundling optimization
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
    exclude: ['hls.js'], // Lazy load this
  },
})
```

## Data Models

### Performance Metrics Model
```typescript
interface PerformanceMetrics {
  // Core Web Vitals
  fcp: number // First Contentful Paint (ms)
  lcp: number // Largest Contentful Paint (ms)
  fid: number // First Input Delay (ms)
  cls: number // Cumulative Layout Shift (score)
  ttfb: number // Time to First Byte (ms)
  tti: number // Time to Interactive (ms)
  
  // Custom metrics
  renderCount: number // Component render count
  bundleSize: number // Main bundle size (bytes)
  chunkCount: number // Number of chunks
  imageLoadTime: number // Average image load time (ms)
  apiResponseTime: number // Average API response time (ms)
}
```

### Cache Entry Model
```typescript
interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
  hits: number
}
```

### Request Queue Model
```typescript
interface QueuedRequest {
  key: string
  fetcher: () => Promise<unknown>
  priority: number
  timestamp: number
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Context Isolation and Memoization
*For any* context provider, when its state changes, only components that consume that specific context should re-render, and context values containing object or array references should maintain referential equality when their content hasn't changed.

**Validates: Requirements 1.1, 1.3**

### Property 2: Component Render Stability
*For any* memoized component (PostCard, etc.), when props remain unchanged (deep equality), the component should not re-render, and event handlers should maintain referential equality across parent re-renders.

**Validates: Requirements 2.1, 2.3**

### Property 3: State Update Batching and Debouncing
*For any* rapid sequence of state updates (seen posts, multiple related state changes), the application should batch or debounce them to result in a single re-render and a single side effect (e.g., localStorage write).

**Validates: Requirements 3.2, 3.4**

### Property 4: Lazy Loading of Heavy Dependencies
*For any* heavy dependency (hls.js, modal components, etc.), the dependency should not be included in the initial bundle and should only be loaded when the feature requiring it is accessed.

**Validates: Requirements 4.2, 4.6**

### Property 5: Off-Screen Image Lazy Loading
*For any* image element that is initially below the viewport fold, the image should have the loading="lazy" attribute to defer loading until the image approaches the viewport.

**Validates: Requirements 5.1**

### Property 6: Above-Fold Image Eager Loading
*For any* image element that is initially within the viewport, the image should have the loading="eager" attribute or no loading attribute to ensure immediate loading.

**Validates: Requirements 5.2**

### Property 7: Progressive Image Loading
*For any* image element, before the full-resolution image loads, a blur-up placeholder should be displayed to provide visual feedback and prevent layout shift.

**Validates: Requirements 5.3**

### Property 8: Image Format Optimization
*For any* image served by the application, the image source should prefer WebP format with appropriate fallbacks for browsers that don't support WebP.

**Validates: Requirements 5.4**

### Property 9: Responsive Image Sizing
*For any* image element, the image should include srcset attributes with multiple size variants to allow the browser to select the most appropriate size for the viewport.

**Validates: Requirements 5.5**

### Property 10: Concurrent Image Request Limiting
*For any* set of images loading simultaneously, the application should limit concurrent image requests to a maximum threshold (e.g., 6 concurrent requests) to prevent network congestion.

**Validates: Requirements 5.6**

### Property 11: Virtualization Rendering Efficiency
*For any* long list of posts in FeedPage, the DOM should contain only visible items plus a buffer, not all items in the list, to minimize DOM size and improve rendering performance.

**Validates: Requirements 6.1**

### Property 12: Layout Recalculation Debouncing
*For any* rapid sequence of scroll events, masonry layout recalculations should be debounced to prevent excessive computation during scrolling.

**Validates: Requirements 6.2**

### Property 13: Off-Screen DOM Minimization
*For any* post that is scrolled off-screen, the post should be unmounted or have its DOM presence minimized to reduce memory usage and improve performance.

**Validates: Requirements 6.3**

### Property 14: Scroll Position Stability
*For any* virtualization update (items added or removed), the scroll position should remain stable without unexpected jumps or shifts.

**Validates: Requirements 6.4**

### Property 15: Viewport Resize Efficiency
*For any* viewport size change, the application should recalculate visible items efficiently without triggering excessive re-renders of unaffected components.

**Validates: Requirements 6.5**

### Property 16: API Request Deduplication
*For any* set of identical API requests made concurrently (same endpoint, same parameters), the application should deduplicate them into a single network request and share the response.

**Validates: Requirements 7.1**

### Property 17: API Response Caching
*For any* API response, when the same request is made within the TTL window, the application should return the cached response without making a new network request.

**Validates: Requirements 7.2**

### Property 18: Optimistic UI Updates
*For any* user interaction with like or follow buttons, the UI should update immediately (optimistically) before the API call completes, and revert if the API call fails.

**Validates: Requirements 7.3**

### Property 19: Parallel Feed Request Optimization
*For any* mixed feed fetch operation, individual feed requests should be made in parallel rather than sequentially to minimize total load time.

**Validates: Requirements 7.4**

### Property 20: Request Cancellation
*For any* in-flight API request, when the user navigates away or the component unmounts, the request should be cancelled to prevent unnecessary network usage and state updates.

**Validates: Requirements 7.5**

### Property 21: Exponential Backoff Retry
*For any* failed API request, the application should retry with exponentially increasing delays (e.g., 1s, 2s, 4s, 8s) up to a maximum number of retries.

**Validates: Requirements 7.6**

### Property 22: Asynchronous localStorage Operations
*For any* localStorage write operation, the operation should be performed asynchronously (e.g., in requestIdleCallback) to avoid blocking the render path and degrading UI responsiveness.

**Validates: Requirements 8.1**

### Property 23: localStorage Write Optimization
*For any* sequence of localStorage writes (seen posts, session data, etc.), the application should debounce writes (minimum 1000ms), avoid redundant serialization of unchanged data, and batch multiple writes where possible.

**Validates: Requirements 8.2, 8.3, 8.4**

### Property 24: localStorage Read Optimization
*For any* localStorage read operation on component mount, the parsing should occur outside the render cycle to prevent blocking initial render.

**Validates: Requirements 8.5**

## Error Handling

### Context Provider Errors
- If a context provider fails to initialize, the application should render an error boundary with a user-friendly message
- Context state updates that fail should not crash the application; errors should be logged and the previous state maintained

### Component Memoization Errors
- If a memoized component's comparison function throws an error, React should fall back to default shallow comparison
- Memoization failures should not prevent the component from rendering

### Code Splitting Errors
- If a lazy-loaded chunk fails to load, display a retry button with exponential backoff
- Provide a fallback UI for failed lazy loads (e.g., "Failed to load component. Click to retry.")
- Log chunk loading errors to monitoring service

### Image Loading Errors
- If an image fails to load, display a placeholder with an error icon
- Implement retry logic for failed image loads (up to 3 retries with exponential backoff)
- Gracefully degrade to alt text if all retries fail

### API Request Errors
- Network errors should trigger exponential backoff retry (up to 3 retries)
- 4xx errors (client errors) should not retry automatically
- 5xx errors (server errors) should retry with backoff
- Display user-friendly error messages for failed requests
- Implement request timeout (30 seconds) to prevent hanging requests

### localStorage Errors
- Quota exceeded errors should trigger cache cleanup (remove oldest entries)
- Parse errors should fall back to default values
- Write errors should be logged but not crash the application
- Implement graceful degradation when localStorage is unavailable (e.g., private browsing)

### Virtualization Errors
- If virtualization calculations fail, fall back to rendering all items (with warning)
- Scroll position errors should reset to top of list
- Layout calculation errors should trigger recalculation on next frame

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests** focus on:
- Specific examples of optimization techniques (e.g., "PostCard doesn't re-render when props are unchanged")
- Edge cases (e.g., "localStorage quota exceeded triggers cleanup")
- Error conditions (e.g., "failed chunk load displays retry button")
- Integration points (e.g., "context providers initialize in correct order")

**Property-Based Tests** focus on:
- Universal properties across all inputs (e.g., "for any context state change, only consuming components re-render")
- Comprehensive input coverage through randomization (e.g., "for any set of concurrent API requests, deduplication works correctly")
- Performance invariants (e.g., "for any list length, virtualization keeps DOM size bounded")

Together, unit tests catch concrete bugs in specific scenarios, while property tests verify general correctness across the entire input space.

### Property-Based Testing Configuration

**Library Selection**: Use `fast-check` for TypeScript/JavaScript property-based testing

**Test Configuration**:
- Minimum 100 iterations per property test (due to randomization)
- Each property test must reference its design document property
- Tag format: `// Feature: performance-optimization, Property N: [property text]`

**Example Property Test Structure**:
```typescript
import fc from 'fast-check'

// Feature: performance-optimization, Property 1: Context Isolation and Memoization
test('context state changes only trigger re-renders in consuming components', () => {
  fc.assert(
    fc.property(
      fc.record({
        contextValue: fc.anything(),
        consumingComponents: fc.array(fc.string()),
        nonConsumingComponents: fc.array(fc.string()),
      }),
      ({ contextValue, consumingComponents, nonConsumingComponents }) => {
        // Test that only consumingComponents re-render when contextValue changes
        // ... test implementation
      }
    ),
    { numRuns: 100 }
  )
})
```

### Unit Testing Strategy

**Context Provider Tests**:
- Test that grouped providers render children correctly
- Test that context values are memoized (referential equality)
- Test error boundaries catch provider initialization errors

**Component Memoization Tests**:
- Test PostCard doesn't re-render with unchanged props
- Test event handlers maintain referential equality
- Test derived state is computed only when dependencies change

**Code Splitting Tests**:
- Test that route components are lazy loaded
- Test that heavy dependencies are in separate chunks
- Test that main bundle is under 500KB gzipped
- Test that lazy load failures show retry UI

**Image Loading Tests**:
- Test that below-fold images have loading="lazy"
- Test that above-fold images have loading="eager"
- Test that progressive loading shows placeholders
- Test that concurrent image requests are limited

**API Request Tests**:
- Test that concurrent identical requests are deduplicated
- Test that cached responses are returned within TTL
- Test that optimistic updates occur immediately
- Test that failed requests retry with exponential backoff

**localStorage Tests**:
- Test that writes are debounced
- Test that reads occur outside render cycle
- Test that quota exceeded triggers cleanup
- Test that parse errors fall back to defaults

**Virtualization Tests**:
- Test that DOM contains only visible items
- Test that scroll position remains stable
- Test that viewport resize recalculates efficiently

### Performance Benchmarking

**Metrics to Track**:
- Component render count (should decrease after optimization)
- Bundle size (main bundle should be < 500KB gzipped)
- Time to Interactive (should be < 3s on 3G)
- First Contentful Paint (should be < 1.5s)
- Largest Contentful Paint (should be < 2.5s)
- API response time (should be < 500ms for cached requests)
- localStorage operation time (should be < 10ms)

**Benchmarking Tools**:
- Lighthouse for Core Web Vitals
- React DevTools Profiler for render counts
- Webpack Bundle Analyzer for bundle size
- Chrome DevTools Performance tab for detailed profiling

**Regression Testing**:
- Run benchmarks on every PR
- Fail CI if bundle size increases by > 10%
- Fail CI if TTI increases by > 20%
- Track metrics over time in monitoring dashboard
