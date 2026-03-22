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

const hexChar = fc.constantFrom(
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'
)
const postUriArbitrary = fc
  .array(hexChar, { minLength: 10, maxLength: 64 })
  .map((chars) => `at://did:plc:test/app.bsky.feed.post/${chars.join('')}`)

function getCardSurface(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-post-uri] > [role="button"][class*="cardLink"]')
  if (!el) throw new Error('card surface not found')
  return el as HTMLElement
}

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
        
        const surface = getCardSurface(container)

        expect(container.querySelector('[data-post-uri] a[href*="/post/"]')).toBeNull()

        fireEvent.click(surface)
        
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
        
        const surface = getCardSurface(container)
        fireEvent.click(surface)

        expect(onPostClick).toHaveBeenCalledWith(uri, expect.objectContaining({
          initialItem: mockPost
        }))

        expect(container.querySelector('[data-post-uri] a[href*="/post/"]')).toBeNull()
        
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
        
        const surface = getCardSurface(container)
        expect(surface.tagName).toBe('DIV')
        expect(surface.getAttribute('href')).toBeNull()
        expect(container.querySelector('[data-post-uri] a[href*="/post/"]')).toBeNull()
        
        return true
      }),
      { numRuns: 20 }
    )
  })
})
