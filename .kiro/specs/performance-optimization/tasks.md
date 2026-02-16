# Implementation Plan: Performance Optimization

## Overview

This implementation plan breaks down the performance optimization work into incremental, testable steps. Each task builds on previous work and includes testing to validate improvements. The plan follows a layered approach: context optimization → component memoization → state management → code splitting → image optimization → API optimization → localStorage optimization → monitoring.

## Tasks

- [x] 1. Set up performance testing infrastructure
  - Install fast-check for property-based testing
  - Configure test utilities for measuring re-renders
  - Set up bundle size tracking in CI
  - Create performance benchmarking utilities
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 2. Optimize context provider architecture
  - [x] 2.1 Create CoreProvidersGroup component
    - Group Theme, Session, ScrollLock, Toast providers
    - Memoize all context values
    - Implement React.memo for the group component
    - _Requirements: 1.1, 1.3_
  
  - [x] 2.2 Write property test for context isolation
    - **Property 1: Context Isolation and Memoization**
    - **Validates: Requirements 1.1, 1.3**
  
  - [x] 2.3 Create FeedProvidersGroup component
    - Group ViewMode, ArtOnly, MediaOnly, FeedMix, SeenPosts, HideReposts providers
    - Memoize all context values
    - Implement React.memo for the group component
    - _Requirements: 1.1, 1.3_
  
  - [x] 2.4 Create ModalProvidersGroup component
    - Group LoginModal, ModalExpand, ProfileModal, EditProfile providers
    - Memoize all context values
    - Implement React.memo for the group component
    - _Requirements: 1.1, 1.3_
  
  - [x] 2.5 Update App.tsx to use grouped providers
    - Replace nested providers with grouped providers
    - Verify reduced nesting depth
    - _Requirements: 1.2_
  
  - [x] 2.6 Write unit tests for grouped providers
    - Test that grouped providers render children correctly
    - Test error boundaries catch initialization errors
    - _Requirements: 1.1, 1.3_

- [x] 3. Checkpoint - Verify context optimization
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement component memoization
  - [x] 4.1 Memoize PostCard component
    - Wrap PostCard with React.memo
    - Implement custom comparison function for props
    - Memoize event handlers (handleLikeClick, handleFollowClick, etc.)
    - Memoize derived state (mediaInfo, allMedia, externalLink)
    - _Requirements: 2.1, 2.3, 2.5_
  
  - [x] 4.2 Write property test for PostCard render stability
    - **Property 2: Component Render Stability**
    - **Validates: Requirements 2.1, 2.3**
  
  - [x] 4.3 Memoize other frequently rendered components
    - Memoize ProfileLink component
    - Memoize PostText component
    - Memoize PostActionsMenu component
    - _Requirements: 2.1_
  
  - [x] 4.4 Write unit tests for memoized components
    - Test that components don't re-render with unchanged props
    - Test that event handlers maintain referential equality
    - _Requirements: 2.1, 2.3_

- [ ] 5. Optimize FeedPage state management
  - [x] 5.1 Replace multiple useState with useReducer
    - Create FeedState type and FeedAction union type
    - Implement feedReducer function
    - Replace useState calls with useReducer
    - _Requirements: 3.1_
  
  - [x] 5.2 Implement debounced seen posts tracking
    - Create debounce utility function
    - Wrap seen posts updates with debounce (1000ms)
    - _Requirements: 3.2_
  
  - [x] 5.3 Write property test for state update batching
    - **Property 3: State Update Batching and Debouncing**
    - **Validates: Requirements 3.2, 3.4**
  
  - [x] 5.4 Consolidate like overrides into normalized cache
    - Move likeOverrides from component state to context
    - Implement normalized cache structure
    - _Requirements: 3.3_
  
  - [x] 5.5 Write unit tests for state management
    - Test that reducer handles all action types correctly
    - Test that debouncing batches rapid updates
    - _Requirements: 3.2, 3.4_

- [ ] 6. Checkpoint - Verify state optimization
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement code splitting and lazy loading
  - [x] 7.1 Add lazy loading for route components
    - Wrap FeedPage, PostDetailPage, ProfilePage, TagPage, CollabPage, ConsensusPage with React.lazy
    - Add Suspense boundary with loading spinner
    - _Requirements: 4.1_
  
  - [x] 7.2 Implement dynamic import for hls.js
    - Create loadHls async function
    - Update PostCard video effect to lazy load hls.js
    - _Requirements: 4.2, 4.4_
  
  - [x] 7.3 Add lazy loading for modal components
    - Lazy load PostModal, ProfileModal, LoginModal, EditProfileModal
    - Add Suspense boundaries for modals
    - _Requirements: 4.6_
  
  - [x] 7.4 Write property test for lazy loading
    - **Property 4: Lazy Loading of Heavy Dependencies**
    - **Validates: Requirements 4.2, 4.6**
  
  - [x] 7.5 Configure Vite for optimal code splitting
    - Update vite.config.ts with manualChunks configuration
    - Split vendor chunks (react, atproto, video, virtual)
    - Configure terser for minification
    - _Requirements: 4.3, 4.4, 10.1, 10.2, 10.3_
  
  - [x] 7.6 Write unit tests for code splitting
    - Test that route components are not in initial bundle
    - Test that hls.js is in separate chunk
    - Test that main bundle is under 500KB gzipped
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

- [ ] 8. Implement image loading optimization
  - [x] 8.1 Create ProgressiveImage component
    - Implement blur-up placeholder logic
    - Add loading state management
    - Support lazy/eager loading modes
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [x] 8.2 Create ImageLoadQueue class
    - Implement concurrent request limiting (max 6)
    - Add queue management logic
    - _Requirements: 5.6_
  
  - [x] 8.3 Update PostCard to use ProgressiveImage
    - Replace img tags with ProgressiveImage component
    - Add loading="lazy" for below-fold images
    - Add loading="eager" for above-fold images
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [x] 8.4 Implement WebP format preference
    - Update image URLs to prefer WebP
    - Add fallback for browsers without WebP support
    - _Requirements: 5.4_
  
  - [x] 8.5 Add responsive image sizing
    - Generate srcset attributes with multiple sizes
    - Configure sizes attribute based on viewport
    - _Requirements: 5.5_
  
  - [x] 8.6 Write property tests for image loading
    - **Property 5: Off-Screen Image Lazy Loading**
    - **Property 6: Above-Fold Image Eager Loading**
    - **Property 7: Progressive Image Loading**
    - **Property 8: Image Format Optimization**
    - **Property 9: Responsive Image Sizing**
    - **Property 10: Concurrent Image Request Limiting**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
  
  - [x] 8.7 Write unit tests for image components
    - Test ProgressiveImage shows placeholder before load
    - Test ImageLoadQueue limits concurrent requests
    - Test image error handling and retry logic
    - _Requirements: 5.1, 5.2, 5.3, 5.6_

- [ ] 9. Checkpoint - Verify image optimization
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Enhance virtualization implementation
  - [x] 10.1 Add debouncing to masonry layout recalculation
    - Create debounce wrapper for layout recalculation
    - Apply debounce to scroll event handler
    - _Requirements: 6.2_
  
  - [x] 10.2 Optimize off-screen post rendering
    - Implement DOM minimization for off-screen posts
    - Add intersection observer for unmounting
    - _Requirements: 6.3_
  
  - [x] 10.3 Improve scroll position stability
    - Add scroll position tracking
    - Implement scroll restoration after virtualization updates
    - _Requirements: 6.4_
  
  - [x] 10.4 Optimize viewport resize handling
    - Debounce viewport resize recalculations
    - Minimize re-renders on resize
    - _Requirements: 6.5_
  
  - [x] 10.5 Write property tests for virtualization
    - **Property 11: Virtualization Rendering Efficiency**
    - **Property 12: Layout Recalculation Debouncing**
    - **Property 13: Off-Screen DOM Minimization**
    - **Property 14: Scroll Position Stability**
    - **Property 15: Viewport Resize Efficiency**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
  
  - [x] 10.6 Write unit tests for virtualization
    - Test that DOM contains only visible items
    - Test that scroll position remains stable
    - Test that resize triggers efficient recalculation
    - _Requirements: 6.1, 6.4, 6.5_

- [ ] 11. Implement API request optimization
  - [x] 11.1 Create RequestDeduplicator class
    - Implement request deduplication logic
    - Add pending request tracking
    - _Requirements: 7.1_
  
  - [x] 11.2 Create ResponseCache class
    - Implement cache with TTL support
    - Add cache entry management
    - _Requirements: 7.2_
  
  - [x] 11.3 Update bsky.ts to use deduplication and caching
    - Wrap API calls with RequestDeduplicator
    - Add caching for timeline and feed requests
    - _Requirements: 7.1, 7.2_
  
  - [x] 11.4 Implement optimistic updates for likes and follows
    - Create optimisticLike and optimisticUnlike functions
    - Update UI immediately before API call completes
    - Add revert logic for failed requests
    - _Requirements: 7.3_
  
  - [x] 11.5 Optimize mixed feed parallel requests
    - Ensure mixed feed requests are made in parallel
    - Use Promise.all for concurrent requests
    - _Requirements: 7.4_
  
  - [x] 11.6 Implement request cancellation
    - Add AbortController to API requests
    - Cancel requests on component unmount
    - _Requirements: 7.5_
  
  - [x] 11.7 Add exponential backoff retry logic
    - Create retry utility with exponential backoff
    - Apply to failed API requests
    - _Requirements: 7.6_
  
  - [x] 11.8 Write property tests for API optimization
    - **Property 16: API Request Deduplication**
    - **Property 17: API Response Caching**
    - **Property 18: Optimistic UI Updates**
    - **Property 19: Parallel Feed Request Optimization**
    - **Property 20: Request Cancellation**
    - **Property 21: Exponential Backoff Retry**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**
  
  - [x] 11.9 Write unit tests for API optimization
    - Test that concurrent identical requests are deduplicated
    - Test that cached responses are returned within TTL
    - Test that optimistic updates occur immediately
    - Test that failed requests retry with backoff
    - _Requirements: 7.1, 7.2, 7.3, 7.6_

- [ ] 12. Checkpoint - Verify API optimization
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Optimize localStorage operations
  - [x] 13.1 Create AsyncStorage class
    - Implement async write queue
    - Add debouncing for writes (1000ms)
    - Use requestIdleCallback for async operations
    - _Requirements: 8.1, 8.2_
  
  - [x] 13.2 Implement write batching and deduplication
    - Batch multiple writes into single operations
    - Avoid redundant serialization of unchanged data
    - _Requirements: 8.3, 8.4_
  
  - [x] 13.3 Optimize localStorage reads on mount
    - Move parsing outside render cycle
    - Use lazy initialization for state
    - _Requirements: 8.5_
  
  - [x] 13.4 Update SessionContext and FeedPage to use AsyncStorage
    - Replace direct localStorage calls with AsyncStorage
    - Update seen posts tracking to use debounced writes
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [x] 13.5 Write property tests for localStorage optimization
    - **Property 22: Asynchronous localStorage Operations**
    - **Property 23: localStorage Write Optimization**
    - **Property 24: localStorage Read Optimization**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
  
  - [x] 13.6 Write unit tests for localStorage optimization
    - Test that writes are debounced
    - Test that reads occur outside render cycle
    - Test that quota exceeded triggers cleanup
    - Test that parse errors fall back to defaults
    - _Requirements: 8.1, 8.2, 8.5_

- [ ] 14. Implement performance monitoring
  - [x] 14.1 Add Core Web Vitals tracking
    - Implement FCP measurement
    - Implement LCP measurement
    - Implement TTI measurement
    - _Requirements: 9.2, 9.3, 9.4_
  
  - [x] 14.2 Add bundle size tracking to CI
    - Configure bundle size limits in CI
    - Add bundle size comparison to PR comments
    - _Requirements: 9.5_
  
  - [x] 14.3 Create performance metrics dashboard
    - Display Core Web Vitals
    - Show bundle size trends
    - Track render counts in development
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [x] 14.4 Write unit tests for performance monitoring
    - Test that metrics are collected correctly
    - Test that bundle size limits are enforced
    - _Requirements: 9.2, 9.3, 9.4, 9.5_

- [ ] 15. Implement error handling
  - [x] 15.1 Add error boundaries for code splitting
    - Create ChunkLoadError boundary
    - Add retry button for failed chunk loads
    - _Requirements: 4.1, 4.2_
  
  - [x] 15.2 Add error handling for image loading
    - Implement retry logic for failed images
    - Display placeholder for permanently failed images
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [x] 15.3 Add error handling for API requests
    - Implement exponential backoff for retries
    - Display user-friendly error messages
    - _Requirements: 7.1, 7.2, 7.6_
  
  - [x] 15.4 Add error handling for localStorage
    - Implement quota exceeded cleanup
    - Gracefully degrade when localStorage unavailable
    - _Requirements: 8.1, 8.2_
  
  - [x] 15.5 Write unit tests for error handling
    - Test chunk load failure shows retry UI
    - Test image load failure shows placeholder
    - Test API failure triggers retry with backoff
    - Test localStorage quota exceeded triggers cleanup
    - _Requirements: 4.1, 5.1, 7.6, 8.1_

- [x] 16. Final checkpoint and performance validation
  - Run full test suite
  - Measure and validate Core Web Vitals improvements
  - Verify bundle size is under 500KB gzipped
  - Benchmark render counts and compare to baseline
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Performance benchmarking validates measurable improvements
