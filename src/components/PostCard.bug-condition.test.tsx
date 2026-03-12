import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { render, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import PostCard from './PostCard'
import type { TimelineItem } from '../lib/bsky'

// Mock contexts
vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ session: null }),
}))

vi.mock('../context/LoginModalContext', () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}))

vi.mock('../context/ArtOnlyContext', () => ({
  useArtOnly: () => ({ artOnly: false, minimalist: false }),
}))

vi.mock('../context/MediaOnlyContext', () => ({
  useMediaOnly: () => ({ mediaMode: 'all' }),
}))

vi.mock('../context/ModerationContext', () => ({
  useModeration: () => ({
    unblurredUris: new Set(),
    setUnblurred: vi.fn(),
  }),
}))

vi.mock('../context/ProfileModalContext', () => ({
  useProfileModal: () => ({
    openQuotesModal: vi.fn(),
    isModalOpen: false,
  }),
}))

vi.mock('../lib/loadHls', () => ({
  loadHls: vi.fn(() => {
    const HlsEvents = {
      ERROR: 'hlsError'
    }
    return Promise.resolve({
      default: class Hls {
        static isSupported() {
          return true
        }
        static Events = HlsEvents
        loadSource = vi.fn()
        attachMedia = vi.fn()
        on = vi.fn()
        destroy = vi.fn()
      }
    })
  })
}))

/**
 * Bug Condition Exploration Test for Post Double-Open Fix
 * 
 * **Validates: Requirements 2.1, 2.2**
 * 
 * This test explores the bug condition where clicking a post card on the homepage
 * causes the post to open in a modal AND the page simultaneously navigates to the
 * `/post/:uri` route, causing the post to display twice.
 * 
 * EXPECTED OUTCOME ON UNFIXED CODE: Test FAILS (this proves the bug exists)
 * - Route changes to `/post/:uri` when clicking post card
 * - PostDetailPage renders while modal is also open
 * - Browser history accumulates `/post/:uri` entries
 */

// Mock data generator for posts
const postUriArbitrary = fc.string({ minLength: 10, maxLength: 100 }).map(s => `at://did:plc:test/app.bsky.feed.post/${s}`)

// Mock post item
function createMockPost(uri: string): TimelineItem {
  return {
    post: {
      uri,
      cid: 'mock-cid',
      author: {
        did: 'did:plc:test',
        handle: 'test.bsky.social',
        displayName: 'Test User',
        avatar: undefined,
      },
      record: {
        text: 'Test post',
        createdAt: new Date().toISOString(),
      },
      indexedAt: new Date().toISOString(),
      likeCount: 0,
      replyCount: 0,
      repostCount: 0,
    },
  } as TimelineItem
}

describe('PostCard - Bug Condition Exploration: Post Card Click Opens Modal Only', () => {
  it('should NOT navigate to /post/:uri route when clicking a post card', () => {
    fc.assert(
      fc.property(postUriArbitrary, (uri) => {
        const mockPost = createMockPost(uri)
        const onPostClick = vi.fn()
        
        const { container } = render(
          <BrowserRouter>
            <PostCard
              item={mockPost}
              onPostClick={onPostClick}
              isSelected={false}
            />
          </BrowserRouter>
        )
        
        // Find and click the post card link
        const link = container.querySelector('a[class*="cardLink"]') as HTMLAnchorElement
        expect(link).toBeTruthy()
        
        // Verify the link's href is NOT pointing to /post/:uri
        // BUG: On unfixed code, this will fail because link.href contains /post/:uri
        expect(link.href).not.toContain(`/post/${encodeURIComponent(uri)}`)
        
        // Click the post card
        fireEvent.click(link)
        
        // Verify onPostClick was called (modal should open)
        expect(onPostClick).toHaveBeenCalledWith(uri, expect.any(Object))
        
        return true
      }),
      { numRuns: 20 }
    )
  })

  it('should open modal with correct post without rendering PostDetailPage as full page', () => {
    fc.assert(
      fc.property(postUriArbitrary, (uri) => {
        const mockPost = createMockPost(uri)
        const onPostClick = vi.fn()
        
        const { container } = render(
          <BrowserRouter>
            <PostCard
              item={mockPost}
              onPostClick={onPostClick}
              isSelected={false}
            />
          </BrowserRouter>
        )
        
        // Find and click the post card
        const link = container.querySelector('a[class*="cardLink"]') as HTMLAnchorElement
        fireEvent.click(link)
        
        // Verify onPostClick was called with correct URI
        expect(onPostClick).toHaveBeenCalledWith(uri, expect.objectContaining({
          initialItem: mockPost
        }))
        
        // Verify the Link component's 'to' attribute is NOT pointing to /post/:uri
        // BUG: On unfixed code, link.href will contain /post/:uri
        expect(link.href).not.toContain(`/post/${encodeURIComponent(uri)}`)
        
        return true
      }),
      { numRuns: 20 }
    )
  })

  it('should use # as Link target to prevent route navigation', () => {
    fc.assert(
      fc.property(postUriArbitrary, (uri) => {
        const mockPost = createMockPost(uri)
        const onPostClick = vi.fn()
        
        const { container } = render(
          <BrowserRouter>
            <PostCard
              item={mockPost}
              onPostClick={onPostClick}
              isSelected={false}
            />
          </BrowserRouter>
        )
        
        // Find the post card link
        const link = container.querySelector('a[class*="cardLink"]') as HTMLAnchorElement
        expect(link).toBeTruthy()
        
        // BUG: On unfixed code, the 'to' attribute will be /post/{uri}
        // After fix, it should be # (no-op navigation)
        // We check the href which reflects the 'to' attribute
        const href = link.getAttribute('href')
        
        // The href should be # or not contain /post/
        // BUG: This will fail on unfixed code because href contains /post/{uri}
        expect(href === '#' || !href?.includes('/post/')).toBe(true)
        
        return true
      }),
      { numRuns: 20 }
    )
  })
})
